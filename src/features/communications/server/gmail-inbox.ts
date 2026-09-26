import 'server-only';

/**
 * Reading the office mailbox from Google, over plain fetch.
 *
 * Chosen over receiving mail at a provider because it needs NO DNS change at
 * all: the MX records stay exactly as Google Workspace set them, operations@
 * keeps working untouched, and nothing depends on a forwarding rule somebody
 * might later delete. See 20260926270000 for the routing alternative that was
 * built and not wired up.
 *
 * No googleapis SDK: this codebase already talks to Resend with fetch, and
 * what is needed here is two GETs and a token refresh. One dependency fewer on
 * the path that reads a mailbox.
 *
 * Authenticated as operations@ ITSELF, with one stored refresh token, rather
 * than through a service account with domain-wide delegation. Delegation would
 * hand this application a key that can read every mailbox in the company in
 * order to read one, which is not a trade worth making.
 *
 * Parsing lives here as pure functions because it is the part that can quietly
 * be wrong: a body pulled from the wrong MIME part looks like a working
 * integration right up until somebody reads a reply that says nothing.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 15_000;

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** One message, in the shape app.inbound_email_record expects. */
export interface InboundMessage {
  provider_message_id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  headers: Record<string, string>;
  attachment_count: number;
  received_at: string;
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id?: string;
  internalDate?: string;
  payload?: GmailPart;
};

/** Gmail encodes every body as base64url, which atob does not accept. */
export function decodeBase64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
}

/**
 * The first body of a given type, depth first.
 *
 * A real message nests: multipart/mixed wrapping multipart/alternative
 * wrapping the text and the HTML. Taking payload.parts[0] would return the
 * wrapper and the body would come back empty.
 */
export function findBody(
  part: GmailPart | undefined,
  mimeType: string
): string | null {
  if (!part) return null;
  // An attachment can be text/plain too; it is not the message.
  const isAttachment = !!part.filename && part.filename.length > 0;
  if (part.mimeType === mimeType && !isAttachment && part.body?.data)
    return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

/** Anything with a filename is a file somebody attached, at any depth. */
export function countAttachments(part: GmailPart | undefined): number {
  if (!part) return 0;
  const self = part.filename && part.filename.length > 0 ? 1 : 0;
  return self + (part.parts ?? []).reduce((n, p) => n + countAttachments(p), 0);
}

/** "Dan Smith <dan@x.co.uk>" and a bare address are both valid. */
export function parseAddress(raw: string): {
  name: string | null;
  email: string;
} {
  const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled)
    return {
      name: angled[1].replace(/^"|"$/g, '').trim() || null,
      email: angled[2].trim().toLowerCase()
    };
  return { name: null, email: raw.trim().toLowerCase() };
}

export function headerMap(part: GmailPart | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of part?.headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

/** One Gmail message to the record shape. Null when it has no usable sender. */
export function toInboundMessage(message: GmailMessage): InboundMessage | null {
  const id = message.id;
  if (!id) return null;
  const headers = headerMap(message.payload);
  const from = parseAddress(headers.from ?? '');
  if (!from.email || !from.email.includes('@')) return null;

  return {
    provider_message_id: id,
    from_address: from.email,
    from_name: from.name,
    to_addresses: (headers.to ?? '')
      .split(',')
      .map((a) => parseAddress(a).email)
      .filter((a) => a.includes('@')),
    subject: headers.subject ?? null,
    text_body: findBody(message.payload, 'text/plain'),
    html_body: findBody(message.payload, 'text/html'),
    headers,
    attachment_count: countAttachments(message.payload),
    received_at: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString()
  };
}

async function accessToken(creds: GmailCredentials): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok)
    throw new Error(
      `Google refused the refresh token (${response.status}). Re-authorise the office mailbox.`
    );
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google returned no access token');
  return body.access_token;
}

/**
 * Messages that have ARRIVED in the last `days`, newest first.
 *
 * `in:inbox` rather than a date cursor: a stored historyId expires and then
 * returns 404 for ever, which fails silently and is the hardest kind of fault
 * to find. Re-reading a bounded window is cheap, and recording is idempotent
 * on the message id, so a message already seen is a no-op rather than a
 * duplicate. That also means a poll that was missed for a day catches up by
 * itself.
 */
export async function fetchInbox({
  credentials,
  days = 3,
  limit = 50,
  excludeFrom
}: {
  credentials: GmailCredentials;
  days?: number;
  limit?: number;
  /** The office's own address: mail it sent is not mail it received. */
  excludeFrom?: string | null;
}): Promise<InboundMessage[]> {
  const token = await accessToken(credentials);
  const auth = { Authorization: `Bearer ${token}` };

  // in:inbox excludes SENT by construction; the from: clause also drops a copy
  // of our own message that a reply-all would put back in the inbox.
  const query = [
    'in:inbox',
    `newer_than:${days}d`,
    excludeFrom ? `-from:${excludeFrom}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  const list = await fetch(
    `${GMAIL}/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`,
    { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) }
  );
  if (!list.ok) throw new Error(`Gmail list failed (${list.status})`);
  const { messages = [] } = (await list.json()) as {
    messages?: { id: string }[];
  };

  const out: InboundMessage[] = [];
  for (const { id } of messages) {
    const response = await fetch(`${GMAIL}/messages/${id}?format=full`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    // One unreadable message must not lose the whole batch.
    if (!response.ok) continue;
    const parsed = toInboundMessage((await response.json()) as GmailMessage);
    if (parsed) out.push(parsed);
  }
  return out;
}

import 'server-only';

import { createHash, createHmac } from 'node:crypto';

/**
 * Recipient link tokens.
 *
 * A token is HMAC-SHA256(FORMS_LINK_SECRET, "form-invitation:" + invitation id),
 * base64url (43 characters, 256 bits). It is never stored: the database keeps
 * only its SHA-256, and staff who may send forms can re-derive the link at any
 * time. Revoking a link is a database change; rotating the secret invalidates
 * every existing link at once.
 *
 * FORMS_LINK_SECRET is server-only (never NEXT_PUBLIC_*), at least 32
 * characters, and has no fallback: without it links cannot be created.
 */
export class FormsLinkSecretMissing extends Error {
  constructor() {
    super('FORMS_LINK_SECRET is not configured on the server.');
    this.name = 'FormsLinkSecretMissing';
  }
}

function secret(env: Record<string, string | undefined> = process.env): string {
  const value = env.FORMS_LINK_SECRET?.trim();
  if (!value || value.length < 32) throw new FormsLinkSecretMissing();
  return value;
}

export const linksConfigured = (
  env: Record<string, string | undefined> = process.env
) => {
  try {
    secret(env);
    return true;
  } catch {
    return false;
  }
};

export function linkToken(
  invitationId: string,
  env?: Record<string, string | undefined>
): string {
  return createHmac('sha256', secret(env))
    .update(`form-invitation:${invitationId}`)
    .digest('base64url');
}

/** What the database stores and looks links up by. */
export const tokenHash = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

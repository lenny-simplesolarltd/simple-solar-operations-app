import 'server-only';

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import type { PendingActionView } from '../protocol';
import type { ActionPreview } from './registry';

/**
 * Pending actions: how a proposed mutation waits for a human.
 *
 * When the model asks for a mutation, nothing runs. The server validates the
 * request, builds a preview, and issues a PENDING ACTION - a payload signed
 * with a server-only key. The browser holds it as an opaque token and can only
 * hand it back. On confirmation the server trusts the signed payload, never
 * arguments re-sent by the browser. The payload pins:
 *
 *   tampering        tool + canonical arguments (and their hash) are inside the MAC
 *   another user     the proposing person's id; must equal the session's actor
 *   stale data       the row version seen at proposal time (expected_version)
 *   expiry           a short TTL
 *   replay/duplicate the action id is single-use in the store below AND is the
 *                    command_id handed to the domain command, so the existing
 *                    `commands` idempotency is the durable guarantee
 *
 * The store is an interface because single-use state should live in the
 * database once mutations ship to a multi-instance deployment. That needs a
 * table this workstream must not create - see docs/assistant/BACKEND_DEPENDENCIES.md
 * (BD-07). Until then the in-memory store fails CLOSED: an action id this
 * process did not issue is rejected, never executed.
 */

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

export interface PendingActionPayload {
  v: 1;
  /** Also the command_id passed to the domain command. */
  id: string;
  tool: string;
  args: unknown;
  argsHash: string;
  actorPersonId: string;
  threadId: string;
  expectedVersion: number | null;
  issuedAt: number;
  expiresAt: number;
}

export type ConsumeOutcome = 'ok' | 'already_used' | 'unknown';

export interface PendingActionStore {
  register(id: string, expiresAt: number): Promise<void>;
  /** Atomically claims the action. Exactly one caller ever gets 'ok'. */
  consume(id: string): Promise<ConsumeOutcome>;
  /** Hands a claim back after a transport failure, so the (idempotent) command can be retried. */
  release(id: string): Promise<void>;
}

export class MemoryPendingActionStore implements PendingActionStore {
  private readonly actions = new Map<
    string,
    { expiresAt: number; used: boolean }
  >();

  async register(id: string, expiresAt: number) {
    this.sweep();
    this.actions.set(id, { expiresAt, used: false });
  }

  async consume(id: string): Promise<ConsumeOutcome> {
    const entry = this.actions.get(id);
    if (!entry) return 'unknown';
    if (entry.used) return 'already_used';
    entry.used = true;
    return 'ok';
  }

  async release(id: string) {
    const entry = this.actions.get(id);
    if (entry) entry.used = false;
  }

  private sweep() {
    const now = Date.now();
    // Keep used entries until expiry so a replay is reported as a replay.
    this.actions.forEach((entry, id) => {
      if (entry.expiresAt < now) this.actions.delete(id);
    });
  }
}

/** Stable JSON: object keys sorted, so equal arguments always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const hashArgs = (args: unknown) =>
  createHash('sha256').update(canonicalJson(args)).digest('hex');

const b64 = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

export type VerifyFailure =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'UNSUPPORTED_VERSION';

export class PendingActionSigner {
  private readonly key: Buffer;

  constructor(secret: string | Buffer) {
    const key =
      typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
    if (key.length < 32) {
      throw new Error(
        'Pending-action signing secret must be at least 32 bytes'
      );
    }
    this.key = key;
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.key).update(body).digest();
  }

  sign(payload: PendingActionPayload): string {
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(this.mac(body))}`;
  }

  verify(
    token: string,
    now = Date.now()
  ):
    | { ok: true; payload: PendingActionPayload }
    | { ok: false; reason: VerifyFailure } {
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'MALFORMED' };
    const [body, signature] = parts;

    const expected = this.mac(body);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'BAD_SIGNATURE' };
    }

    let payload: PendingActionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }
    if (payload?.v !== 1) return { ok: false, reason: 'UNSUPPORTED_VERSION' };
    if (hashArgs(payload.args) !== payload.argsHash) {
      return { ok: false, reason: 'MALFORMED' };
    }
    if (payload.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
    return { ok: true, payload };
  }
}

export interface PendingActionService {
  signer: PendingActionSigner;
  store: PendingActionStore;
}

/** Issues a pending action for a validated mutation proposal. Nothing is executed. */
export async function issuePendingAction(
  service: PendingActionService,
  input: {
    tool: string;
    args: unknown;
    actorPersonId: string;
    threadId: string;
    preview: ActionPreview;
  },
  now = Date.now()
): Promise<PendingActionView> {
  const { expectedVersion, ...view } = input.preview;
  const payload: PendingActionPayload = {
    v: 1,
    id: randomUUID(),
    tool: input.tool,
    args: input.args,
    argsHash: hashArgs(input.args),
    actorPersonId: input.actorPersonId,
    threadId: input.threadId,
    expectedVersion,
    issuedAt: now,
    expiresAt: now + PENDING_ACTION_TTL_MS
  };
  await service.store.register(payload.id, payload.expiresAt);
  return {
    ...view,
    token: service.signer.sign(payload),
    actionId: payload.id,
    tool: input.tool,
    expiresAt: new Date(payload.expiresAt).toISOString()
  };
}

// -- Process-wide default ------------------------------------------------------

const globalState = globalThis as typeof globalThis & {
  __assistantPendingActions?: PendingActionService;
};

/**
 * The signing key comes from ASSISTANT_ACTION_SECRET (server-only). Outside
 * production a missing key falls back to a random per-process key: proposals
 * then simply stop verifying after a restart. In production a missing key
 * disables proposals rather than inventing one.
 */
export function getPendingActionService(): PendingActionService | null {
  if (globalState.__assistantPendingActions) {
    return globalState.__assistantPendingActions;
  }
  const secret = process.env.ASSISTANT_ACTION_SECRET;
  let signer: PendingActionSigner;
  if (secret && secret.length >= 32) {
    signer = new PendingActionSigner(secret);
  } else if (process.env.NODE_ENV !== 'production') {
    signer = new PendingActionSigner(randomBytes(32));
  } else {
    return null;
  }
  globalState.__assistantPendingActions = {
    signer,
    store: new MemoryPendingActionStore()
  };
  return globalState.__assistantPendingActions;
}

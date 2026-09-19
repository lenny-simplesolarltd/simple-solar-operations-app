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
 * The store is the source of truth (BD-07). The database store keeps each
 * proposal in public.assistant_pending_actions with its validated arguments;
 * confirming claims it atomically, as the proposer only, once, before expiry,
 * and executes the STORED arguments - the signed token is only a reference
 * whose hash must match. The in-memory store (development and tests) keeps the
 * same contract within one process and fails CLOSED for ids it did not issue.
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

export type PendingActionDecision = 'confirm' | 'cancel';

/** What the store hands back when a confirmation wins the claim. */
export interface ClaimedAction {
  tool: string;
  args: unknown;
  argsHash: string;
  expectedVersion: number | null;
  threadId: string;
}

export type ClaimResult =
  | { outcome: 'ok'; action: ClaimedAction }
  | { outcome: 'already_used' | 'expired' | 'unknown' };

export interface PendingActionStore {
  /** 'memory' | 'database' - shown in development diagnostics. */
  readonly kind: string;
  /**
   * True when single-use state survives restarts and is shared by every server
   * instance. Mutations may only be proposed in production through a durable store.
   */
  readonly durable: boolean;
  /** Records a validated proposal, with what the staff member is shown. */
  register(action: PendingActionPayload, preview: unknown): Promise<void>;
  /**
   * Atomically confirms or cancels. Exactly one caller ever gets 'ok', only
   * the proposer, only before expiry; a won confirm returns the STORED action.
   */
  claim(id: string, decision: PendingActionDecision): Promise<ClaimResult>;
  /** Hands a claim back after a transport failure, so the (idempotent) command can be retried. */
  release(id: string): Promise<void>;
  /** Records the terminal outcome of a claimed action. */
  complete(id: string, succeeded: boolean, code?: string): Promise<void>;
}

export class MemoryPendingActionStore implements PendingActionStore {
  readonly kind = 'memory';
  readonly durable = false;
  private readonly actions = new Map<
    string,
    { payload: PendingActionPayload; used: boolean; done: boolean }
  >();

  async register(payload: PendingActionPayload) {
    this.sweep();
    this.actions.set(payload.id, {
      payload: structuredClone(payload),
      used: false,
      done: false
    });
  }

  async claim(id: string): Promise<ClaimResult> {
    const entry = this.actions.get(id);
    if (!entry) return { outcome: 'unknown' };
    if (entry.used) return { outcome: 'already_used' };
    if (entry.payload.expiresAt <= Date.now()) return { outcome: 'expired' };
    entry.used = true;
    const { tool, args, argsHash, expectedVersion, threadId } = entry.payload;
    return {
      outcome: 'ok',
      action: {
        tool,
        args: structuredClone(args),
        argsHash,
        expectedVersion,
        threadId
      }
    };
  }

  async release(id: string) {
    const entry = this.actions.get(id);
    if (entry && !entry.done) entry.used = false;
  }

  async complete(id: string) {
    const entry = this.actions.get(id);
    if (entry) entry.done = true;
  }

  private sweep() {
    const now = Date.now();
    // Keep used entries until expiry so a replay is reported as a replay.
    this.actions.forEach((entry, id) => {
      if (entry.payload.expiresAt < now) this.actions.delete(id);
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
  await service.store.register(payload, view);
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
export function getPendingActionService(
  storeFactory?: () => PendingActionStore
): PendingActionService | null {
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
    store: storeFactory?.() ?? new MemoryPendingActionStore()
  };
  return globalState.__assistantPendingActions;
}

/**
 * Production never proposes or confirms a change through a store that is not
 * durable: an in-memory store is per-process, so on a multi-instance deployment
 * it cannot guarantee single use. Fails closed.
 */
export function canHandleMutations(
  service: PendingActionService | null,
  env: Record<string, string | undefined> = process.env
): service is PendingActionService {
  if (!service) return false;
  return service.store.durable || env.NODE_ENV !== 'production';
}

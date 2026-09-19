import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';
import type { ConversationListItem, TranscriptMessage } from '../../protocol';
import type { StoredUi } from '../../lib/history';
import type { ToolActor } from '../registry';
import type { StoredMessage } from './context-window';

/**
 * SimpleBot conversation storage.
 *
 * Every call runs as the signed-in staff member (their session client, never
 * the service role), so the database's owner-only RLS decides what exists:
 * someone else's conversation is simply not found. No method takes a person
 * id - ownership is always the session's.
 */

export interface ConversationRecord extends ConversationListItem {
  summary: string | null;
  sourceConversationId: string | null;
  estimatedTokens: number;
  titleSource: 'none' | 'auto' | 'manual';
  version: number;
}

export interface StoredMessageRow extends StoredMessage {
  id: string;
  ui: StoredUi | null;
}

export interface NewMessage {
  content: TranscriptMessage;
  ui?: StoredUi | null;
  pageContext?: unknown;
  status?: 'complete' | 'stopped';
  estimatedTokens: number;
}

export interface AppendResult {
  appended: boolean;
  messageCount: number;
  estimatedTokens: number;
  title: string | null;
}

export interface ConversationStore {
  list(options?: { archived?: boolean }): Promise<ConversationListItem[]>;
  get(id: string): Promise<ConversationRecord | null>;
  messages(id: string): Promise<StoredMessageRow[]>;
  /** Creates the conversation if it does not exist yet. Null when the id is not the caller's. */
  ensure(id: string): Promise<ConversationRecord | null>;
  append(input: {
    conversationId: string;
    runId: string;
    messages: NewMessage[];
    provider?: string;
    model?: string;
    title?: string | null;
    jobId?: string | null;
    promptTokens?: number | null;
  }): Promise<AppendResult>;
  update(
    id: string,
    change: { title?: string; archived?: boolean }
  ): Promise<ConversationRecord | null>;
  remove(id: string): Promise<boolean>;
  /** A new conversation that links back to `sourceId`, carries `summary` and the source's job. */
  createHandoff(input: {
    sourceId: string;
    summary: string | null;
  }): Promise<ConversationRecord>;
}

export class ConversationStoreError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'UNAVAILABLE' | 'FAILED',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ConversationStoreError';
  }
}

const COLUMNS =
  'id, title, title_source, summary, source_conversation_id, job_id, message_count, estimated_tokens, last_message_at, archived_at, created_at, version';

type Row = {
  id: string;
  title: string | null;
  title_source: string;
  summary: string | null;
  source_conversation_id: string | null;
  job_id: string | null;
  message_count: number;
  estimated_tokens: number;
  last_message_at: string | null;
  archived_at: string | null;
  created_at: string;
  version: number;
};

const toRecord = (row: Row): ConversationRecord => ({
  id: row.id,
  title: row.title,
  titleSource: row.title_source as ConversationRecord['titleSource'],
  summary: row.summary,
  sourceConversationId: row.source_conversation_id,
  jobId: row.job_id,
  messageCount: row.message_count,
  estimatedTokens: row.estimated_tokens,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
  archived: row.archived_at !== null,
  version: row.version
});

const toListItem = (row: Row): ConversationListItem => ({
  id: row.id,
  title: row.title,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
  archived: row.archived_at !== null,
  messageCount: row.message_count,
  jobId: row.job_id
});

// PostgREST / Postgres codes for "this environment has no conversation tables".
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
const isMissing = (error: { code?: string } | null) =>
  !!error?.code && MISSING.has(error.code);

const fail = (what: string, error: { code?: string; message: string }) =>
  new ConversationStoreError(
    isMissing(error) ? 'UNAVAILABLE' : 'FAILED',
    `Conversation ${what} failed`,
    { cause: new Error(`${error.code ?? ''} ${error.message}`.trim()) }
  );

type Client = Awaited<ReturnType<typeof createClient>>;

export class SupabaseConversationStore implements ConversationStore {
  constructor(private readonly client: Client) {}

  async list({ archived = false } = {}) {
    let query = this.client
      .from('assistant_conversations')
      .select(COLUMNS)
      // Pressing New stores nothing; a handoff counts once it carries a summary.
      .or('message_count.gt.0,summary.not.is.null')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(100);
    query = archived
      ? query.not('archived_at', 'is', null)
      : query.is('archived_at', null);
    const { data, error } = await query;
    if (error) throw fail('list', error);
    return (data as Row[]).map(toListItem);
  }

  async get(id: string) {
    const { data, error } = await this.client
      .from('assistant_conversations')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw fail('read', error);
    return data ? toRecord(data as Row) : null;
  }

  async messages(id: string) {
    const { data, error } = await this.client
      .from('assistant_messages')
      .select(
        'id, seq, run_id, content, ui, status, created_at, estimated_tokens'
      )
      .eq('conversation_id', id)
      .order('seq', { ascending: true })
      .limit(5_000);
    if (error) throw fail('read', error);
    return data.map(
      (row): StoredMessageRow => ({
        id: row.id,
        seq: row.seq,
        runId: row.run_id,
        content: row.content as unknown as TranscriptMessage,
        ui: (row.ui as StoredUi | null) ?? null,
        status: row.status === 'stopped' ? 'stopped' : 'complete',
        createdAt: row.created_at,
        estimatedTokens: row.estimated_tokens
      })
    );
  }

  async ensure(id: string) {
    // Owner and audit columns are set by the database from the session.
    const { error } = await this.client
      .from('assistant_conversations')
      .upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw fail('create', error);
    // An existing id that belongs to someone else stays invisible here.
    return this.get(id);
  }

  async append(input: Parameters<ConversationStore['append']>[0]) {
    const { data, error } = await this.client.rpc('assistant_append_turn', {
      p_conversation_id: input.conversationId,
      p_run_id: input.runId,
      p_messages: input.messages.map((m) => ({
        role: m.content.role,
        content: m.content,
        ui: m.ui ?? null,
        page_context: m.pageContext ?? null,
        status: m.status ?? 'complete',
        estimated_tokens: m.estimatedTokens
      })) as unknown as Json,
      p_provider: input.provider,
      p_model: input.model,
      p_title: input.title ?? undefined,
      p_job_id: input.jobId ?? undefined,
      p_prompt_tokens: input.promptTokens ?? undefined
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) {
        throw new ConversationStoreError('NOT_FOUND', 'Conversation not found');
      }
      throw fail('save', error);
    }
    const row = data?.[0];
    return {
      appended: row?.appended ?? false,
      messageCount: row?.message_count ?? 0,
      estimatedTokens: row?.estimated_tokens ?? 0,
      title: row?.title ?? null
    };
  }

  async update(id: string, change: { title?: string; archived?: boolean }) {
    // Only these two columns are writable directly; the database marks a
    // renamed title as manual itself.
    const patch: { title?: string; archived_at?: string | null } = {};
    if (change.title !== undefined) patch.title = change.title;
    if (change.archived !== undefined) {
      patch.archived_at = change.archived ? new Date().toISOString() : null;
    }
    const { data, error } = await this.client
      .from('assistant_conversations')
      .update(patch)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw fail('update', error);
    return data ? toRecord(data as Row) : null;
  }

  async remove(id: string) {
    const { data, error } = await this.client
      .from('assistant_conversations')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw fail('delete', error);
    return data.length > 0;
  }

  async createHandoff(input: { sourceId: string; summary: string | null }) {
    // The database checks the source is the caller's and copies its job.
    const { data: id, error } = await this.client.rpc(
      'assistant_start_handoff',
      {
        p_source_id: input.sourceId,
        p_summary: input.summary ?? undefined
      }
    );
    if (error) {
      if (/NOT_FOUND/.test(error.message)) {
        throw new ConversationStoreError('NOT_FOUND', 'Conversation not found');
      }
      throw fail('create', error);
    }
    const created = await this.get(id as string);
    if (!created)
      throw new ConversationStoreError('FAILED', 'Handoff not readable');
    return created;
  }
}

// Whether this database has the conversation tables. Remembered once known to
// be there; re-checked now and then while it is not (a migration may land).
let knownAvailable = false;
let lastMissingAt = 0;
const RECHECK_MS = 60_000;

/**
 * The store for this request, or null when conversations cannot be stored:
 * in development "View as user" preview (read-only, and a developer must not
 * see another person's private history), or when the database has no
 * conversation tables yet. Callers then fall back to session-only chat.
 */
export async function openConversationStore(
  actor: ToolActor
): Promise<ConversationStore | null> {
  if (actor.previewing) return null;
  if (!knownAvailable && Date.now() - lastMissingAt < RECHECK_MS) return null;

  const client = await createClient();
  if (!knownAvailable) {
    // A GET, not HEAD: PostgREST answers HEAD for a missing table with an
    // empty 204, which would look like "available".
    const { error } = await client
      .from('assistant_conversations')
      .select('id')
      .limit(1);
    if (error) {
      if (isMissing(error)) {
        lastMissingAt = Date.now();
        return null;
      }
      throw fail('check', error);
    }
    knownAvailable = true;
  }
  return new SupabaseConversationStore(client);
}

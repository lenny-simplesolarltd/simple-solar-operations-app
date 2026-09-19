import type {
  AppendResult,
  ConversationRecord,
  ConversationStore,
  NewMessage,
  StoredMessageRow
} from '../conversations/store';

/**
 * An in-memory ConversationStore with the database's ownership rules: each
 * instance acts as ONE signed-in person; rows owned by anyone else behave as
 * if they did not exist, and appends are idempotent per run. The real rules
 * are enforced by RLS and tested against the local stack in
 * tests/assistant-conversations.test.mjs.
 */
export class MemoryConversationStore implements ConversationStore {
  constructor(
    readonly personId: string,
    readonly db: {
      conversations: Map<string, ConversationRecord & { personId: string }>;
      messages: Map<string, StoredMessageRow[]>;
    } = { conversations: new Map(), messages: new Map() }
  ) {}

  /** Another person's view of the same database. */
  as(personId: string) {
    return new MemoryConversationStore(personId, this.db);
  }

  appendCalls = 0;
  failNextAppend = false;

  private own(id: string) {
    const row = this.db.conversations.get(id);
    return row && row.personId === this.personId ? row : null;
  }

  async list({ archived = false } = {}) {
    return Array.from(this.db.conversations.values())
      .filter(
        (c) =>
          c.personId === this.personId &&
          c.archived === archived &&
          (c.messageCount > 0 || c.summary)
      )
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(
          a.lastMessageAt ?? a.createdAt
        )
      );
  }

  async get(id: string) {
    const row = this.own(id);
    return row ? { ...row } : null;
  }

  async messages(id: string) {
    return this.own(id) ? [...(this.db.messages.get(id) ?? [])] : [];
  }

  async ensure(id: string) {
    if (!this.db.conversations.has(id)) {
      this.db.conversations.set(id, {
        id,
        personId: this.personId,
        title: null,
        titleSource: 'none',
        summary: null,
        sourceConversationId: null,
        jobId: null,
        messageCount: 0,
        estimatedTokens: 0,
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
        archived: false,
        version: 1
      });
    }
    return this.get(id);
  }

  async append(input: {
    conversationId: string;
    runId: string;
    messages: NewMessage[];
    title?: string | null;
    jobId?: string | null;
  }): Promise<AppendResult> {
    this.appendCalls++;
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error('database unavailable');
    }
    await this.ensure(input.conversationId);
    const row = this.own(input.conversationId);
    if (!row) throw new Error('NOT_FOUND');
    const list = this.db.messages.get(input.conversationId) ?? [];
    if (
      list.some((m) => m.runId === input.runId && m.content.role === 'user')
    ) {
      return {
        appended: false,
        messageCount: row.messageCount,
        estimatedTokens: row.estimatedTokens,
        title: row.title
      };
    }
    const at = new Date(Date.now() + list.length).toISOString();
    input.messages.forEach((m) =>
      list.push({
        id: `${input.conversationId}:${list.length + 1}`,
        seq: list.length + 1,
        runId: input.runId,
        content: m.content,
        ui: m.ui ?? null,
        status: m.status ?? 'complete',
        createdAt: at,
        estimatedTokens: m.estimatedTokens
      })
    );
    this.db.messages.set(input.conversationId, list);
    row.messageCount += input.messages.length;
    row.estimatedTokens += input.messages.reduce(
      (n, m) => n + m.estimatedTokens,
      0
    );
    row.lastMessageAt = at;
    row.archived = false;
    if (!row.title && input.title) {
      row.title = input.title;
      row.titleSource = 'auto';
    }
    row.jobId = row.jobId ?? input.jobId ?? null;
    return {
      appended: true,
      messageCount: row.messageCount,
      estimatedTokens: row.estimatedTokens,
      title: row.title
    };
  }

  async update(id: string, change: { title?: string; archived?: boolean }) {
    const row = this.own(id);
    if (!row) return null;
    if (change.title !== undefined) {
      row.title = change.title;
      row.titleSource = 'manual';
    }
    if (change.archived !== undefined) row.archived = change.archived;
    return { ...row };
  }

  async remove(id: string) {
    if (!this.own(id)) return false;
    this.db.conversations.delete(id);
    this.db.messages.delete(id);
    return true;
  }

  async createHandoff(input: { sourceId: string; summary: string | null }) {
    const source = this.own(input.sourceId);
    if (!source) throw new Error('NOT_FOUND');
    const id = crypto.randomUUID();
    await this.ensure(id);
    const row = this.own(id)!;
    row.summary = input.summary;
    row.sourceConversationId = input.sourceId;
    row.jobId = source.jobId;
    return { ...row };
  }
}

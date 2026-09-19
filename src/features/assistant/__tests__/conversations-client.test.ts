import { describe, expect, it } from 'vitest';
import {
  conversationsReducer,
  initialConversations,
  type ConversationsState
} from '../lib/conversations';
import type { ConversationDetail } from '../protocol';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const send = (state: ConversationsState, id: string, text: string) =>
  conversationsReducer(state, {
    type: 'conversation',
    conversationId: id,
    action: { type: 'send', id: `u-${text}`, text, runId: `run-${text}` }
  });

const delta = (state: ConversationsState, id: string, text: string) =>
  conversationsReducer(state, {
    type: 'conversation',
    conversationId: id,
    action: {
      type: 'event',
      id: `e-${text}`,
      event: { type: 'text_delta', text }
    }
  });

const end = (
  state: ConversationsState,
  id: string,
  title: string | null = null
) =>
  conversationsReducer(state, {
    type: 'conversation',
    conversationId: id,
    action: {
      type: 'event',
      id: 'end',
      event: {
        type: 'turn_end',
        stopReason: 'complete',
        transcript: [],
        conversation: {
          id,
          title,
          contextState: { estimatedTokens: 70_000, level: 'long' }
        }
      }
    }
  });

const detail = (
  id: string,
  overrides: Partial<ConversationDetail> = {}
): ConversationDetail => ({
  id,
  title: 'Stored title',
  lastMessageAt: '2026-09-19T09:00:00Z',
  createdAt: '2026-09-19T08:00:00Z',
  archived: false,
  messageCount: 2,
  jobId: null,
  summary: null,
  sourceConversationId: null,
  contextState: { estimatedTokens: 100, level: 'ok' },
  items: [{ id: 'm1', kind: 'user', text: 'Stored question' }],
  ...overrides
});

describe('several conversations', () => {
  it('streams each reply into the conversation it was asked in', () => {
    let s = initialConversations(A);
    s = send(s, A, 'question A');
    // Switch to a new conversation B while A is still answering.
    s = conversationsReducer(s, { type: 'new', conversationId: B });
    expect(s.activeId).toBe(B);
    s = send(s, B, 'question B');
    // A's reply arrives while B is on screen; B's arrives too.
    s = delta(s, A, 'answer A');
    s = delta(s, B, 'answer B');
    s = end(s, A, 'Question A');

    const a = s.byId[A];
    const b = s.byId[B];
    expect(
      a.items.map((i) =>
        i.kind === 'user' || i.kind === 'assistant' ? i.text : i.kind
      )
    ).toEqual(['question A', 'answer A']);
    expect(a.status).toBe('idle');
    expect(a.title).toBe('Question A');
    expect(
      b.items.map((i) =>
        i.kind === 'user' || i.kind === 'assistant' ? i.text : i.kind
      )
    ).toEqual(['question B', 'answer B']);
    expect(b.status).toBe('working');

    // Back to A: intact.
    s = conversationsReducer(s, {
      type: 'open',
      conversationId: A,
      loading: false
    });
    expect(s.activeId).toBe(A);
    expect(s.byId[A]).toBe(a);
  });

  it('drops events for a conversation that has been deleted', () => {
    let s = send(initialConversations(A), A, 'q');
    s = conversationsReducer(s, {
      type: 'forget',
      conversationId: A,
      replacementId: C
    });
    const after = delta(s, A, 'late reply');
    expect(after).toBe(s);
    expect(after.activeId).toBe(C);
    expect(after.byId[A]).toBeUndefined();
  });

  it('does not pile up blank conversations when New is pressed repeatedly', () => {
    let s = initialConversations(A);
    s = conversationsReducer(s, { type: 'new', conversationId: B });
    s = conversationsReducer(s, { type: 'new', conversationId: C });
    expect(s.activeId).toBe(A);
    expect(Object.keys(s.byId)).toEqual([A]);

    s = send(s, A, 'first');
    s = conversationsReducer(s, { type: 'new', conversationId: B });
    expect(s.activeId).toBe(B);
    expect(s.byId[A].items).toHaveLength(1);
  });

  it('opens a stored conversation: loading, then its history', () => {
    let s = conversationsReducer(initialConversations(A), {
      type: 'open',
      conversationId: B,
      loading: true
    });
    expect(s.byId[B].load).toBe('loading');
    s = conversationsReducer(s, { type: 'loaded', detail: detail(B) });
    expect(s.byId[B]).toMatchObject({ load: 'ready', title: 'Stored title' });
    expect(s.byId[B].items).toHaveLength(1);
  });

  it('never replaces a conversation that is answering with an older stored copy', () => {
    let s = send(initialConversations(A), A, 'live question');
    s = conversationsReducer(s, { type: 'loaded', detail: detail(A) });
    expect(s.byId[A].items[0]).toMatchObject({ text: 'live question' });
  });

  it('marks a failed open, and retries loading when opened again', () => {
    let s = conversationsReducer(initialConversations(A), {
      type: 'open',
      conversationId: B,
      loading: true
    });
    s = conversationsReducer(s, { type: 'load_failed', conversationId: B });
    expect(s.byId[B].load).toBe('error');
    s = conversationsReducer(s, {
      type: 'open',
      conversationId: B,
      loading: true
    });
    expect(s.byId[B].load).toBe('loading');
  });

  it('keeps the long-conversation state per conversation until dismissed', () => {
    let s = send(initialConversations(A), A, 'q');
    s = end(s, A);
    expect(s.byId[A].contextState?.level).toBe('long');
    s = conversationsReducer(s, { type: 'dismiss_long', conversationId: A });
    expect(s.byId[A].longDismissed).toBe(true);
    s = conversationsReducer(s, { type: 'new', conversationId: B });
    expect(s.byId[B].longDismissed).toBe(false);
  });

  it('keeps the run id after a failure so Retry cannot store a turn twice', () => {
    let s = send(initialConversations(A), A, 'q');
    s = conversationsReducer(s, {
      type: 'conversation',
      conversationId: A,
      action: {
        type: 'request_failed',
        id: 'err',
        error: { code: 'NETWORK', message: 'x', retryable: true }
      }
    });
    expect(s.byId[A].pendingRunId).toBe('run-q');
    s = end(s, A);
    expect(s.byId[A].pendingRunId).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { assistantContextSchema, describeContext } from '../context';
import {
  conversationReducer,
  initialConversation,
  trimTranscript,
  type ConversationState
} from '../lib/conversation';
import {
  chatRequestSchema,
  type AssistantStreamEvent,
  type PendingActionView,
  type TranscriptMessage
} from '../protocol';
import { suggestionsFor } from '../suggestions';
import { searchTerms } from '@/features/jobs/server/search';

const JOB_ID = '9b2f6c1e-0d54-4c8e-a3f7-2f6d1b0c9e77';
const THREAD = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';

describe('page context', () => {
  const job = {
    kind: 'job' as const,
    jobId: JOB_ID,
    jobRef: 'SS-TEST-0001',
    customerName: 'Pat Parton',
    workflowStage: 'Presale'
  };

  it('accepts what pages publish', () => {
    expect(
      assistantContextSchema.safeParse({
        route: `/dashboard/jobs/${JOB_ID}`,
        page: job
      }).success
    ).toBe(true);
    expect(describeContext(job)).toEqual({
      label: 'SS-TEST-0001',
      detail: 'Pat Parton · Presale'
    });
  });

  it('rejects identity-shaped keys rather than ignoring them', () => {
    for (const extra of [
      { role: 'Admin' },
      { person_id: JOB_ID },
      { permissions: ['*'] },
      { actor_id: JOB_ID }
    ]) {
      expect(
        assistantContextSchema.safeParse({
          route: '/x',
          page: { ...job, ...extra }
        }).success
      ).toBe(false);
      expect(
        assistantContextSchema.safeParse({ route: '/x', page: job, ...extra })
          .success
      ).toBe(false);
    }
  });

  it('bounds free text', () => {
    expect(
      assistantContextSchema.safeParse({
        route: '/x',
        page: { ...job, customerName: 'x'.repeat(500) }
      }).success
    ).toBe(false);
  });

  it('chat requests carry no identity', () => {
    const base = { threadId: THREAD, message: 'hi', transcript: [] };
    expect(chatRequestSchema.safeParse(base).success).toBe(true);
    expect(
      chatRequestSchema.safeParse({ ...base, submitted_by: JOB_ID }).success
    ).toBe(false);
  });
});

describe('suggestions', () => {
  it('shows only what this staff member’s tools can do', () => {
    const labels = (tools: string[]) =>
      suggestionsFor('job', tools).map((s) => s.label);
    expect(labels(['get_job', 'get_job_tasks', 'find_job'])).toEqual([
      'Summarise this job',
      'Show open tasks',
      'Which tasks are blocked?',
      'Find a job'
    ]);
    expect(labels(['get_job'])).toEqual(['Summarise this job']);
    expect(labels([])).toEqual([]);
  });

  it('hides quote history until the quote tools exist', () => {
    const all = [
      'get_job',
      'get_job_tasks',
      'find_job',
      'get_my_tasks',
      'get_team_tasks',
      'get_presale_workflow'
    ];
    expect(suggestionsFor('job', all).map((s) => s.label)).not.toContain(
      'Show quote history'
    );
  });

  it('hides team suggestions from staff without the team tool', () => {
    expect(
      suggestionsFor('tasks', ['get_my_tasks']).map((s) => s.label)
    ).not.toContain('Show the team’s overdue tasks');
  });
});

describe('job search terms', () => {
  it('drops honorifics and anything that could be filter syntax', () => {
    expect(searchTerms('Miss Parton')).toEqual(['Parton']);
    expect(searchTerms("O'Brien-Smith LS1 1AA")).toEqual([
      "O'Brien-Smith",
      'LS1',
      '1AA'
    ]);
    expect(searchTerms('smith,id.not.is.null) or (1.eq.1')).toEqual([
      'smithidnotisnull',
      'or',
      '1eq1'
    ]);
    expect(searchTerms('  %%  ')).toEqual([]);
  });
});

describe('conversation reducer', () => {
  let n = 0;
  const id = () => `i${n++}`;
  const apply = (state: ConversationState, ...events: AssistantStreamEvent[]) =>
    events.reduce(
      (s, event) => conversationReducer(s, { type: 'event', id: id(), event }),
      state
    );
  const started = () =>
    conversationReducer(initialConversation(THREAD), {
      type: 'send',
      id: id(),
      text: 'Find Parton',
      runId: 'run-1'
    });

  const action: PendingActionView = {
    token: 'body.sig',
    actionId: 'a1',
    tool: 'complete_task',
    title: 'Mark PRE02 complete',
    summary: '',
    changes: [],
    warnings: [],
    confirmLabel: 'Confirm',
    expiresAt: new Date().toISOString()
  };

  it('streams text, shows tool progress, then commits the transcript only when the turn ends', () => {
    const turn: TranscriptMessage[] = [
      { role: 'user', text: 'Find Parton' },
      { role: 'assistant', text: 'Found it.', toolCalls: [] }
    ];
    let state = apply(
      started(),
      {
        type: 'tool_start',
        callId: 'c1',
        tool: 'find_job',
        label: 'Searching jobs'
      },
      {
        type: 'tool_result',
        callId: 'c1',
        tool: 'find_job',
        ok: true,
        display: { kind: 'job_list', jobs: [], total: 0, query: 'Parton' }
      },
      { type: 'text_delta', text: 'Found ' },
      { type: 'text_delta', text: 'it.' }
    );
    expect(state.status).toBe('working');
    expect(state.transcript).toEqual([]);
    expect(state.items.map((i) => i.kind)).toEqual([
      'user',
      'tool',
      'assistant'
    ]);

    state = apply(state, {
      type: 'turn_end',
      stopReason: 'complete',
      transcript: turn
    });
    expect(state.status).toBe('idle');
    expect(state.transcript).toEqual(turn);
    expect(state.items.at(-1)).toMatchObject({
      kind: 'assistant',
      text: 'Found it.',
      streaming: false
    });
  });

  it('a failed turn leaves nothing in the transcript and can be retried without repeating the message', () => {
    let state = apply(started(), {
      type: 'error',
      code: 'OVERLOADED',
      message: 'Try again.',
      retryable: true
    });
    expect(state.transcript).toEqual([]);
    const error = state.items.at(-1);
    expect(error).toMatchObject({ kind: 'error', retryText: 'Find Parton' });

    state = conversationReducer(state, {
      type: 'retry',
      errorId: error!.id,
      text: 'Find Parton'
    });
    expect(state.items.map((i) => i.kind)).toEqual(['user']);
    expect(state.status).toBe('working');
  });

  it('stopping settles anything in flight', () => {
    let state = apply(started(), {
      type: 'tool_start',
      callId: 'c1',
      tool: 'find_job',
      label: 'Searching jobs'
    });
    state = conversationReducer(state, { type: 'stopped', id: id() });
    expect(state.status).toBe('idle');
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'tool', 'stopped']);
    expect(state.items[1]).toMatchObject({ state: 'error' });
  });

  it('a proposal replaces its progress row and records the staff decision for the next turn', () => {
    let state = apply(
      started(),
      {
        type: 'tool_start',
        callId: 'c1',
        tool: 'complete_task',
        label: 'Working'
      },
      { type: 'proposal', callId: 'c1', action }
    );
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'proposal']);

    state = conversationReducer(state, {
      type: 'proposal_state',
      actionId: 'a1',
      state: 'cancelled',
      message: 'Cancelled. Nothing was changed.',
      transcript: [{ role: 'event', text: 'CANCELLED a1' }]
    });
    expect(state.items[1]).toMatchObject({
      kind: 'proposal',
      state: 'cancelled'
    });
    expect(state.transcript).toEqual([{ role: 'event', text: 'CANCELLED a1' }]);
  });

  it('trims long transcripts at a staff message so tool results stay paired', () => {
    const long: TranscriptMessage[] = [];
    for (let i = 0; i < 30; i++) {
      long.push(
        { role: 'user', text: `q${i}` },
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: `t${i}`, name: 'find_job', args: {} }]
        },
        {
          role: 'tool',
          results: [
            { callId: `t${i}`, name: 'find_job', ok: true, content: '{}' }
          ]
        },
        { role: 'assistant', text: `a${i}`, toolCalls: [] }
      );
    }
    const trimmed = trimTranscript(long, 60);
    expect(trimmed.length).toBeLessThanOrEqual(60);
    expect(trimmed[0].role).toBe('user');
  });
});

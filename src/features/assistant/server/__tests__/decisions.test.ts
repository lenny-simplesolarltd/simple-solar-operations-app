import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const store = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../conversations/store', () => ({
  openConversationStore: vi.fn(async () => store.current)
}));

import { itemsFromHistory } from '../../lib/history';
import { recordDecision } from '../conversations/decisions';
import { MemoryConversationStore } from './conversation-helpers';
import { makeActor, THREAD } from './helpers';

const ME = '11111111-1111-4111-8111-111111111111';
const ACTION = '9a9a9a9a-1111-4111-8111-111111111111';

describe('confirmed proposals are recorded in the stored conversation', () => {
  it('stores the outcome once, and redraws it as a note with its card', async () => {
    const memory = new MemoryConversationStore(ME);
    await memory.append({
      conversationId: THREAD,
      runId: '00000000-0000-4000-8000-000000000001',
      messages: [
        {
          content: { role: 'user', text: 'Create a feedback form' },
          estimatedTokens: 5
        }
      ]
    });
    store.current = memory;
    const result = {
      ok: true as const,
      decision: 'confirm' as const,
      commandId: ACTION,
      message: 'Done.',
      threadId: THREAD,
      tool: 'create_form',
      display: {
        kind: 'form' as const,
        form: {
          id: 'f1',
          kind: 'form' as const,
          title: 'Feedback',
          status: 'draft',
          revision: 0,
          questionCount: 3,
          hasUnpublishedChanges: true,
          jobRef: null
        }
      },
      transcript: [
        {
          role: 'event' as const,
          text: 'The staff member CONFIRMED action ...'
        }
      ]
    };
    await recordDecision(makeActor({ id: ME }), result);
    await recordDecision(makeActor({ id: ME }), result); // a repeat is not recorded twice

    const saved = await memory.messages(THREAD);
    expect(saved.map((m) => m.content.role)).toEqual(['user', 'user', 'event']);
    const items = itemsFromHistory(saved);
    expect(items.map((i) => i.kind)).toEqual(['user', 'note', 'tool']);
    expect(items[2]).toMatchObject({ kind: 'tool', display: { kind: 'form' } });
  });

  it("never writes into someone else's conversation", async () => {
    const theirs = new MemoryConversationStore(
      '22222222-2222-4222-8222-222222222222'
    );
    await theirs.ensure(THREAD);
    store.current = theirs.as(ME);
    await recordDecision(makeActor({ id: ME }), {
      ok: true,
      decision: 'cancel',
      commandId: ACTION,
      message: 'Cancelled.',
      threadId: THREAD,
      tool: 'create_form',
      transcript: []
    });
    expect(await theirs.messages(THREAD)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const select = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: (...args: unknown[]) => select(...args) })
  })
}));

import { makeActor } from './helpers';

beforeEach(() => {
  vi.resetModules();
  select.mockReset();
});

const answer = (error: unknown) =>
  select.mockImplementation(() => ({
    limit: async () => ({ data: [], error })
  }));

describe('opening the conversation store', () => {
  it('falls back to session-only chat where the tables do not exist (e.g. hosted before the migration)', async () => {
    answer({
      code: 'PGRST205',
      message: "Could not find the table 'public.assistant_conversations'"
    });
    const { openConversationStore } = await import('../conversations/store');
    expect(await openConversationStore(makeActor())).toBeNull();
    // Checked with a GET: PostgREST answers HEAD for a missing table with an empty 204.
    expect(select).toHaveBeenCalledWith('id');
    // Remembered for a while instead of asking on every request.
    expect(await openConversationStore(makeActor())).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('is available when the table answers', async () => {
    answer(null);
    const { openConversationStore } = await import('../conversations/store');
    expect(await openConversationStore(makeActor())).not.toBeNull();
  });

  it("is never used in development preview: no reads or writes of anyone's history", async () => {
    answer(null);
    const { openConversationStore } = await import('../conversations/store');
    const actor = { ...makeActor(), previewing: true };
    expect(await openConversationStore(actor)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('reports other failures instead of silently switching modes', async () => {
    answer({ code: '42501', message: 'permission denied' });
    const { openConversationStore } = await import('../conversations/store');
    await expect(openConversationStore(makeActor())).rejects.toThrow(
      /check failed/
    );
  });
});

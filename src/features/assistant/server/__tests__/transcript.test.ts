import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { conversationTranscript } from '../conversations/transcript';
import type { ConversationStore } from '../conversations/store';

/**
 * A transcript is a thing people paste elsewhere. What it must NOT carry is as
 * much the point as what it must: a tool result can hold rows of a job or a
 * property register that the reply itself never quoted, and those stay behind
 * the permissions that decided who could see them.
 */
const store = (messages: unknown[]) =>
  ({
    get: async () => ({
      id: 'c0ffee00-0000-4000-8000-000000000001',
      title: 'Meter at 14 King Street',
      createdAt: '2026-09-25T09:00:00.000Z',
      lastMessageAt: null,
      archived: false,
      messageCount: messages.length,
      jobId: null
    }),
    messages: async () => messages
  }) as unknown as ConversationStore;

const turn = (content: unknown) => ({
  seq: 1,
  runId: 'r',
  status: 'complete',
  createdAt: '2026-09-25T09:00:00.000Z',
  estimatedTokens: 1,
  id: 'm',
  ui: null,
  content
});

describe('a conversation taken out of the drawer', () => {
  it('reads as the conversation, with both sides named', async () => {
    const t = await conversationTranscript(
      store([
        turn({
          role: 'user',
          text: 'What meter is expected at 14 King Street?'
        }),
        turn({
          role: 'assistant',
          text: 'EML1409032559, per the PCH register.'
        })
      ]),
      'c0ffee00-0000-4000-8000-000000000001'
    );
    expect(t).not.toBeNull();
    expect(t!.markdown).toContain('# Meter at 14 King Street');
    expect(t!.markdown).toContain('**You:** What meter is expected');
    expect(t!.markdown).toContain('**SimpleBot:** EML1409032559');
    expect(t!.lines).toBe(2);
  });

  it('names a tool without carrying what it returned', async () => {
    const t = await conversationTranscript(
      store([
        turn({
          role: 'tool',
          name: 'search_programme_properties',
          text: JSON.stringify({
            properties: [
              { address: '14 King Street', iccid: '8944502106211700645' }
            ]
          })
        })
      ]),
      'c0ffee00-0000-4000-8000-000000000001'
    );
    expect(t!.markdown).toContain('search_programme_properties');
    // The result's contents, not the title's words: the conversation is called
    // "Meter at 14 King Street", so the address is legitimately in the heading.
    expect(t!.markdown).not.toContain('8944502106211700645');
    expect(t!.markdown).not.toContain('iccid');
    expect(t!.markdown).not.toContain('{');
  });

  it('says plainly that SimpleBot can be wrong', async () => {
    const t = await conversationTranscript(
      store([turn({ role: 'assistant', text: 'Done.' })]),
      'c0ffee00-0000-4000-8000-000000000001'
    );
    expect(t!.markdown).toMatch(/can be wrong/i);
  });

  it('is nothing at all for a conversation that is not the caller’s', async () => {
    const missing = {
      get: async () => null,
      messages: async () => []
    } as unknown as ConversationStore;
    expect(await conversationTranscript(missing, 'x')).toBeNull();
  });
});

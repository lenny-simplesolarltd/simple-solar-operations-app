import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const resolveAssistantActor = vi.fn();
vi.mock('../actor', () => ({
  resolveAssistantActor: () => resolveAssistantActor()
}));
const previewWriteBlock = vi.fn(async (): Promise<string | null> => null);
vi.mock('@/lib/preview/guard', () => ({
  previewWriteBlock: () => previewWriteBlock()
}));
let currentStore: MemoryConversationStore | null = null;
vi.mock('../conversations/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversations/store')>()),
  openConversationStore: vi.fn(async () => currentStore)
}));

import {
  DELETE as remove,
  GET as getOne,
  PATCH as patch
} from '@/app/api/assistant/conversations/[id]/route';
import { POST as handoff } from '@/app/api/assistant/conversations/[id]/handoff/route';
import { GET as list } from '@/app/api/assistant/conversations/route';
import { GET as capabilities } from '@/app/api/assistant/capabilities/route';
import { MemoryConversationStore } from './conversation-helpers';
import { makeActor } from './helpers';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const MINE = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';
const THEIRS = '4e1d2c3b-7a53-4a52-9d53-6f1f0e0b8a22';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/assistant/conversations/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

async function seed() {
  const mine = new MemoryConversationStore(ME);
  for (const [store, id, text] of [
    [mine, MINE, 'My question'],
    [mine.as(THEM), THEIRS, 'Their private question']
  ] as const) {
    await store.append({
      conversationId: id,
      runId: crypto.randomUUID(),
      messages: [
        { content: { role: 'user', text }, estimatedTokens: 5 },
        {
          content: { role: 'assistant', text: 'Answer', toolCalls: [] },
          estimatedTokens: 5
        }
      ],
      title: text
    });
  }
  return mine;
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  resolveAssistantActor.mockReset();
  resolveAssistantActor.mockResolvedValue(makeActor({ id: ME }));
  previewWriteBlock.mockResolvedValue(null);
  currentStore = await seed();
});

describe('conversation routes', () => {
  it('require a signed-in staff member', async () => {
    resolveAssistantActor.mockResolvedValue(null);
    expect((await list(req('GET'))).status).toBe(401);
    expect((await getOne(req('GET'), params(MINE))).status).toBe(401);
    expect(
      (await patch(req('PATCH', { title: 'x' }), params(MINE))).status
    ).toBe(401);
    expect((await remove(req('DELETE'), params(MINE))).status).toBe(401);
    expect(
      (await handoff(req('POST', { withSummary: false }), params(MINE))).status
    ).toBe(401);
  });

  it("list only the staff member's own conversations", async () => {
    const body = await (await list(req('GET'))).json();
    expect(body.conversations.map((c: { id: string }) => c.id)).toEqual([MINE]);
    expect(JSON.stringify(body)).not.toContain('Their private question');
  });

  it("treat another person's conversation as not found - for every operation", async () => {
    expect((await getOne(req('GET'), params(THEIRS))).status).toBe(404);
    expect(
      (await patch(req('PATCH', { title: 'Mine now' }), params(THEIRS))).status
    ).toBe(404);
    expect((await remove(req('DELETE'), params(THEIRS))).status).toBe(404);
    expect(
      (await handoff(req('POST', { withSummary: true }), params(THEIRS))).status
    ).toBe(404);
    const theirs = await currentStore!.as(THEM).get(THEIRS);
    expect(theirs?.title).toBe('Their private question');
  });

  it('redraw a conversation from its stored messages', async () => {
    const body = await (await getOne(req('GET'), params(MINE))).json();
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual([
      'user',
      'assistant'
    ]);
    expect(body.contextState.level).toBe('ok');
  });

  it('reject a forged owner, person or role in the body', async () => {
    for (const forged of [
      { title: 'x', person_id: THEM },
      { title: 'x', personId: THEM },
      { title: 'x', owner: THEM },
      { title: 'x', roles: ['Admin'] }
    ]) {
      expect((await patch(req('PATCH', forged), params(MINE))).status).toBe(
        400
      );
    }
    expect(
      (
        await handoff(
          req('POST', { withSummary: true, person_id: THEM }),
          params(MINE)
        )
      ).status
    ).toBe(400);
  });

  it('reject malformed ids and empty changes', async () => {
    expect((await getOne(req('GET'), params('not-a-uuid'))).status).toBe(404);
    expect((await patch(req('PATCH', {}), params(MINE))).status).toBe(400);
    expect(
      (await patch(req('PATCH', { title: '   ' }), params(MINE))).status
    ).toBe(400);
  });

  it('rename, archive, restore and delete', async () => {
    const renamed = await (
      await patch(req('PATCH', { title: 'Planning' }), params(MINE))
    ).json();
    expect(renamed.title).toBe('Planning');
    expect((await currentStore!.get(MINE))?.titleSource).toBe('manual');

    await patch(req('PATCH', { archived: true }), params(MINE));
    expect((await (await list(req('GET'))).json()).conversations).toEqual([]);
    const archived = await (
      await list(
        new Request('http://localhost/api/assistant/conversations?archived=1')
      )
    ).json();
    expect(archived.conversations.map((c: { id: string }) => c.id)).toEqual([
      MINE
    ]);

    await patch(req('PATCH', { archived: false }), params(MINE));
    expect((await (await list(req('GET'))).json()).conversations).toHaveLength(
      1
    );

    expect((await remove(req('DELETE'), params(MINE))).status).toBe(200);
    expect(await currentStore!.get(MINE)).toBeNull();
    expect(await currentStore!.messages(MINE)).toEqual([]);
  });

  it('start a new conversation from an old one, with or without a summary', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', 'dev-router');
    const withSummary = await handoff(
      req('POST', { withSummary: true }),
      params(MINE)
    );
    expect(withSummary.status).toBe(201);
    const created = await withSummary.json();
    const record = await currentStore!.get(created.id);
    expect(record?.sourceConversationId).toBe(MINE);
    expect(record?.summary).toContain('My question');
    // The original is untouched and still listed.
    expect(await currentStore!.messages(MINE)).toHaveLength(2);

    const plain = await (
      await handoff(req('POST', { withSummary: false }), params(MINE))
    ).json();
    expect((await currentStore!.get(plain.id))?.summary).toBeNull();
  });

  it('are read-only in development preview', async () => {
    previewWriteBlock.mockResolvedValue('Preview mode is read-only.');
    expect(
      (await patch(req('PATCH', { title: 'x' }), params(MINE))).status
    ).toBe(403);
    expect((await remove(req('DELETE'), params(MINE))).status).toBe(403);
    expect(
      (await handoff(req('POST', { withSummary: false }), params(MINE))).status
    ).toBe(403);
    expect((await currentStore!.get(MINE))?.title).toBe('My question');
  });

  it('say so plainly when conversations are not stored here', async () => {
    currentStore = null;
    const response = await list(req('GET'));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('NOT_STORED');
    const caps = await (await capabilities()).json();
    expect(caps.conversations).toBe('ephemeral');
  });

  it('report persistent conversations in capabilities', async () => {
    const caps = await (await capabilities()).json();
    expect(caps.conversations).toBe('persistent');
  });
});

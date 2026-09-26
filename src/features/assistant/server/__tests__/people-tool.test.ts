import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const listChatPeople = vi.fn();
vi.mock('@/features/chat/queries', () => ({
  listChatPeople: (q?: string) => listChatPeople(q)
}));

import { listPeopleTool } from '../tools/people';
import { makeActor, THREAD } from './helpers';

const run = (input: { role?: string; query?: string }) =>
  listPeopleTool.execute(input as never, {
    actor: makeActor(),
    threadId: THREAD
  });

const person = (displayName: string, roles: string[]) => ({
  personId: crypto.randomUUID(),
  displayName,
  roles
});

beforeEach(() => listChatPeople.mockReset());

describe('listing colleagues', () => {
  it('answers "list surveyors" with the surveyors', async () => {
    // This question used to return the nine-step Presale workflow, because
    // there was no tool for looking up a person at all.
    listChatPeople.mockResolvedValue({
      ok: true,
      data: [
        person('Dave Gorman', ['Surveyor']),
        person('Lucy Ross', ['Office']),
        person('Mike Bater', ['Surveyor'])
      ]
    });

    const result = await run({ role: 'Surveyor' });
    expect(result).toMatchObject({ ok: true });
    const data = (result as { data: { total: number; people: unknown[] } })
      .data;
    expect(data.total).toBe(2);
    expect(JSON.stringify(data)).toContain('Dave Gorman');
    expect(JSON.stringify(data)).not.toContain('Lucy Ross');
  });

  it('never hands the model an address or a phone number', async () => {
    listChatPeople.mockResolvedValue({
      ok: true,
      data: [person('Dan Barnes', ['Director'])]
    });
    const text = JSON.stringify((await run({})) as unknown);
    expect(text).not.toMatch(/@|\b07\d{9}\b/);
  });

  it('distinguishes "nobody holds that role" from "you cannot see anybody"', async () => {
    // The same empty list, two different facts. Saying which one saves a
    // wrong conclusion about the company.
    listChatPeople.mockResolvedValue({
      ok: true,
      data: [person('Lucy Ross', ['Office'])]
    });
    expect(
      JSON.stringify((await run({ role: 'Scaffolder' })) as unknown)
    ).toMatch(/Nobody active holds the Scaffolder role/);

    listChatPeople.mockResolvedValue({ ok: true, data: [] });
    expect(
      JSON.stringify((await run({ role: 'Scaffolder' })) as unknown)
    ).toMatch(/No colleagues are visible to this staff member at all/);
  });

  it('says so rather than guessing when the directory cannot be read', async () => {
    listChatPeople.mockResolvedValue({
      ok: false,
      error: { message: 'R1A_ROLE_DENIED' }
    });
    expect(await run({})).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('messaging a colleague', () => {
  it('proposes the exact words, to one resolved person', async () => {
    // "josh email" used to search JOBS for Josh. Knowing who somebody is and
    // being able to reach them were two different things.
    const { messageColleagueTool } = await import('../tools/chat');
    listChatPeople.mockResolvedValue({
      ok: true,
      data: [person('Josh Lewis', ['Installer'])]
    });

    const proposed = await messageColleagueTool.prepare(
      { person: 'Josh Lewis', message: 'The meter serial did not match.' },
      { actor: makeActor(), threadId: THREAD }
    );
    expect(proposed).toMatchObject({ ok: true });
    const preview = (proposed as { preview: { changes: unknown[] } }).preview;
    // The person confirming is agreeing to these words going out under their
    // own name, so the card shows them in full.
    expect(JSON.stringify(preview.changes)).toContain(
      'The meter serial did not match.'
    );
    expect(JSON.stringify(preview.changes)).toContain('Josh Lewis');
  });

  it('asks which one rather than guessing between two people', async () => {
    const { messageColleagueTool } = await import('../tools/chat');
    listChatPeople.mockResolvedValue({
      ok: true,
      data: [
        person('Dan Barnes', ['Director']),
        person('Dan Anderson', ['Installer'])
      ]
    });
    expect(
      await messageColleagueTool.prepare(
        { person: 'Dan', message: 'hello' },
        { actor: makeActor(), threadId: THREAD }
      )
    ).toMatchObject({ ok: false, code: 'AMBIGUOUS' });
  });

  it('refuses a name nobody has, rather than sending to the nearest match', async () => {
    const { messageColleagueTool } = await import('../tools/chat');
    listChatPeople.mockResolvedValue({ ok: true, data: [] });
    expect(
      await messageColleagueTool.prepare(
        { person: 'Nobody At All', message: 'hello' },
        { actor: makeActor(), threadId: THREAD }
      )
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

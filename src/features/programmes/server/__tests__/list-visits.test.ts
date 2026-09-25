import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The visit list at programme scale.
 *
 * `listVisits` used to take the first 500 rows and hand them back as a plain
 * array. Nothing said 500; the screens simply reported what they had been
 * given, so a programme of 1,400 properties displayed a confident "500 visits"
 * and the postcode filter was applied in JavaScript AFTER the truncation — so
 * filtering a large programme searched only the arbitrary first slice of it.
 *
 * These assertions pin down the three things that made that possible:
 *   - a count comes back from the database, separate from the page;
 *   - the page is a range, so rows past 500 are reachable;
 *   - every filter, property columns included, is sent to the database.
 */

interface Call {
  [key: string]: unknown;
  table?: string;
  select?: [string, unknown];
  eq: [string, unknown][];
  like: [string, unknown][];
  ilike: [string, unknown][];
  range?: [number, number];
  order?: [string, unknown];
}

let call: Call;

function builder() {
  const self: Record<string, unknown> = {};
  const chain =
    (name: keyof Call) =>
    (...args: unknown[]) => {
      const bucket = call[name];
      if (Array.isArray(bucket) && Array.isArray(bucket[0] ?? []))
        (bucket as unknown[][]).push(args);
      else (call as Record<string, unknown>)[name] = args;
      return self;
    };
  for (const name of [
    'select',
    'eq',
    'neq',
    'gte',
    'lte',
    'like',
    'ilike',
    'order'
  ])
    self[name] = chain(name as keyof Call);
  self.range = (...args: unknown[]) => {
    call.range = args as [number, number];
    // 2 rows returned out of a stated 1,427: the shape the bug made impossible.
    return Promise.resolve({ data: [], count: 1427, error: null });
  };
  return self;
}

vi.mock('../db', () => ({
  programmeDb: async () => ({
    from: (table: string) => {
      call.table = table;
      return builder();
    }
  })
}));

vi.mock('@/features/presale/server/queries', () => ({
  getPermissions: async () => new Set<string>()
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => null }));

import { listVisits } from '../queries';

const fresh = (): Call => ({ eq: [], like: [], ilike: [] });
const PROGRAMME = '11111111-1111-1111-1111-111111111111';

describe('listVisits', () => {
  it('returns the database count, not the size of the page', async () => {
    call = fresh();
    const page = await listVisits(PROGRAMME, { limit: 100 });

    expect(page.total).toBe(1427);
    expect(page.visits).toHaveLength(0);
    // An exact count is the only honest way to say "of 1,427".
    expect(call.select?.[1]).toEqual({ count: 'exact' });
  });

  it('pages by range, so rows past 500 are reachable', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { limit: 100, offset: 900 });
    expect(call.range).toEqual([900, 999]);

    call = fresh();
    const page = await listVisits(PROGRAMME, { limit: 100, offset: 1400 });
    expect(call.range).toEqual([1400, 1499]);
    expect(page.offset).toBe(1400);
  });

  it('never asks for an unbounded page', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { limit: 1_000_000 });
    const [from, to] = call.range as [number, number];
    expect(to - from + 1).toBeLessThanOrEqual(500);
  });

  it('sends the postcode filter to the database, not to the returned rows', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { postcode: 'ex1 2' });
    expect(call.like).toEqual([['property.postcode_norm', 'EX12%']]);
  });

  it('searches address, reference and serials as ONE condition', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { query: 'MTR-1001' });
    // One condition, not two. Two OR groups - one for the visit's columns, one
    // for the property's - are ANDed by PostgREST, which would demand that the
    // address AND the serial both matched and so find nothing.
    expect(call.ilike).toEqual([['search_text', '%mtr-1001%']]);
  });

  it('does not let a wildcard typed into the search box widen the search', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { query: '100%_x' });
    expect(call.ilike[0][1]).toBe('%100 x%');
  });

  it('composes every filter in one query', async () => {
    call = fresh();
    await listVisits(PROGRAMME, {
      disposition: 'ActionRequired',
      review_status: 'AwaitingReview',
      outcome: 'SimChangedPortalNotWorking',
      portal_verification: 'NotLive',
      signal_classification: 'Bad',
      installer_id: '22222222-2222-2222-2222-222222222222'
    });
    const columns = call.eq.map(([c]) => c);
    expect(columns).toEqual(
      expect.arrayContaining([
        'programme_id',
        'disposition',
        'review_status',
        'outcome',
        'portal_verification',
        'signal_classification',
        'installer_id'
      ])
    );
  });

  it('works the review queue oldest first, and everything else newest first', async () => {
    call = fresh();
    await listVisits(PROGRAMME, { order: 'oldest' });
    expect(call.order?.[1]).toMatchObject({ ascending: true });

    call = fresh();
    await listVisits(PROGRAMME, {});
    expect(call.order?.[1]).toMatchObject({ ascending: false });
  });
});

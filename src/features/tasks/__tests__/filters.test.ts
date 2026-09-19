import { describe, expect, it } from 'vitest';
import { hasActiveFilters, parseTaskFilters } from '../filters';

describe('parseTaskFilters', () => {
  it('defaults to my open tasks', () => {
    const f = parseTaskFilters({});
    expect(f).toEqual({
      scope: 'my',
      status: 'open',
      due: 'any',
      queue: null,
      owner: null,
      q: ''
    });
    expect(hasActiveFilters(f)).toBe(false);
  });

  it('keeps only values the TASKS read accepts', () => {
    const f = parseTaskFilters({
      scope: 'all',
      status: 'Complete',
      due: 'yesterday',
      queue: 'drop table',
      owner: 'not-a-uuid'
    });
    expect(f).toMatchObject({
      scope: 'my',
      status: 'open',
      due: 'any',
      queue: null,
      owner: null
    });
  });

  it('reads a filtered team view from the URL', () => {
    const owner = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';
    const f = parseTaskFilters({
      scope: 'team',
      status: 'closed',
      due: 'overdue',
      queue: 'booking',
      owner,
      q: ['  SS-AB-001 ', 'ignored']
    });
    expect(f).toEqual({
      scope: 'team',
      status: 'closed',
      due: 'overdue',
      queue: 'booking',
      owner,
      q: 'SS-AB-001'
    });
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('caps the search text', () => {
    expect(parseTaskFilters({ q: 'x'.repeat(500) }).q).toHaveLength(120);
  });
});

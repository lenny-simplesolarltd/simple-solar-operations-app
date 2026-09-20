import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ConversationItem } from '../../lib/conversation';
import { groupSources } from '../assistant-panel';

/**
 * Several Help Centre lookups in a row are one piece of information - here is
 * what I read - so they are shown once rather than as a stack of cards that
 * pushes the answer off the screen.
 */

const article = (title: string, category?: string) => ({
  title,
  summary: `About ${title}`,
  href: `/dashboard/help/${title.toLowerCase().replace(/\s+/g, '-')}`,
  switchedOn: true,
  ...(category ? { category } : {})
});

const searchItem = (id: string, titles: string[]): ConversationItem =>
  ({
    id,
    kind: 'tool',
    callId: id,
    tool: 'search_help_articles',
    label: 'Searching guides',
    state: 'done',
    display: {
      kind: 'help_articles',
      title: 'Help Center guides',
      articles: titles.map((t) => article(t))
    }
  }) as ConversationItem;

const assistant = (id: string, text: string): ConversationItem =>
  ({ id, kind: 'assistant', text }) as ConversationItem;

describe('groupSources', () => {
  it('folds consecutive guide results into one row', () => {
    const grouped = groupSources([
      searchItem('a', ['Using the Planner']),
      searchItem('b', ['How to book a job']),
      searchItem('c', ['Job stages explained'])
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('sources');
    if (grouped[0].kind !== 'sources') return;
    expect(grouped[0].articles.map((a) => a.title)).toEqual([
      'Using the Planner',
      'How to book a job',
      'Job stages explained'
    ]);
  });

  it('keeps the answer separate, and in order', () => {
    const grouped = groupSources([
      searchItem('a', ['Using the Planner']),
      assistant('b', 'A job appears once it is booked.')
    ]);
    expect(grouped.map((g) => g.kind)).toEqual(['sources', 'item']);
  });

  it('does not weld together lookups that are separated by an answer', () => {
    // Two rounds of reading means two rounds of sources, not one merged pile.
    const grouped = groupSources([
      searchItem('a', ['Using the Planner']),
      assistant('b', 'Partly.'),
      searchItem('c', ['How to book a job'])
    ]);
    expect(grouped.map((g) => g.kind)).toEqual(['sources', 'item', 'sources']);
  });

  it('leaves everything that is not a guide alone', () => {
    const job = {
      id: 'j',
      kind: 'tool',
      callId: 'j',
      tool: 'find_job',
      label: 'Searching jobs',
      state: 'done',
      display: { kind: 'job_list', query: 'x', total: 0, jobs: [] }
    } as unknown as ConversationItem;
    const grouped = groupSources([job]);
    expect(grouped).toEqual([{ kind: 'item', item: job }]);
  });

  it('carries a running tool through untouched, so "Working…" still shows', () => {
    const running = {
      id: 'r',
      kind: 'tool',
      callId: 'r',
      tool: 'search_help_articles',
      label: 'Searching guides',
      state: 'running'
    } as unknown as ConversationItem;
    expect(groupSources([running])).toEqual([{ kind: 'item', item: running }]);
  });
});

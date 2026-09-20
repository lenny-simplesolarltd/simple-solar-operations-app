import { describe, expect, it } from 'vitest';
import {
  describeUnread,
  escapeFrom,
  formatUnread,
  totalUnread
} from '../unread';

describe('the launcher badge', () => {
  it('says nothing when there is nothing unread', () => {
    expect(formatUnread(0)).toBeNull();
    expect(formatUnread(-3)).toBeNull();
    expect(formatUnread(Number.NaN)).toBeNull();
  });

  it('shows the count', () => {
    expect(formatUnread(1)).toBe('1');
    expect(formatUnread(42)).toBe('42');
    expect(formatUnread(99)).toBe('99');
  });

  // A busy week must not turn a small round button into a wide one.
  it('caps at 99+', () => {
    expect(formatUnread(100)).toBe('99+');
    expect(formatUnread(5000)).toBe('99+');
  });
});

describe('what a screen reader hears', () => {
  it('is a sentence, not a bare number', () => {
    expect(describeUnread(0)).toBe('Team chat, no unread messages');
    expect(describeUnread(1)).toBe('Team chat, 1 unread message');
    expect(describeUnread(4)).toBe('Team chat, 4 unread messages');
    expect(describeUnread(250)).toBe('Team chat, more than 99 unread messages');
  });
});

describe('Escape', () => {
  // Losing the whole panel because you wanted to leave one conversation is how
  // people learn not to press Escape at all.
  it('leaves one layer at a time', () => {
    expect(escapeFrom('thread')).toBe('list');
    expect(escapeFrom('list')).toBe('minimised');
    expect(escapeFrom('minimised')).toBe('minimised');
  });
});

describe('total unread', () => {
  it('adds every conversation up', () => {
    expect(totalUnread([{ unread: 2 }, { unread: 0 }, { unread: 5 }])).toBe(7);
    expect(totalUnread([])).toBe(0);
  });
});

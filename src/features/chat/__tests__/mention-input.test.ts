import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  applyMention,
  moveHighlight
} from '../mention-input';

describe('spotting the mention being typed', () => {
  it('finds one at the start', () => {
    expect(activeMentionQuery('@ben', 4)).toEqual({ start: 0, query: 'ben' });
  });

  it('finds one after a space', () => {
    expect(activeMentionQuery('ask @tan', 8)).toEqual({
      start: 4,
      query: 'tan'
    });
  });

  it('opens on the bare @, before anything is typed', () => {
    expect(activeMentionQuery('hello @', 7)).toEqual({ start: 6, query: '' });
  });

  // The reason this is a function and not a regex in the component.
  it('ignores the @ in an email address', () => {
    expect(activeMentionQuery('mail ben@example.com', 20)).toBeNull();
  });

  it('closes once the mention is followed by a space', () => {
    expect(activeMentionQuery('@ben please look', 16)).toBeNull();
  });

  it('is about the caret, not the last @ in the text', () => {
    // Caret sits right after "@be", before the later text.
    expect(activeMentionQuery('@ben and @dan', 3)).toEqual({
      start: 0,
      query: 'be'
    });
  });

  it('gives up on something far too long to be a name', () => {
    expect(activeMentionQuery(`@${'x'.repeat(60)}`, 61)).toBeNull();
  });

  it('is null when there is no @ at all', () => {
    expect(activeMentionQuery('nothing here', 12)).toBeNull();
  });
});

describe('inserting the choice', () => {
  it('replaces the typed fragment and leaves a trailing space', () => {
    const mention = activeMentionQuery('ask @tan', 8)!;
    expect(applyMention('ask @tan', 8, mention, '@Tanya Harris')).toEqual({
      text: 'ask @Tanya Harris ',
      caret: 18
    });
  });

  it('keeps whatever follows the caret', () => {
    const text = 'ask @tan about it';
    const mention = activeMentionQuery(text, 8)!;
    expect(applyMention(text, 8, mention, '@Tanya Harris').text).toBe(
      'ask @Tanya Harris  about it'
    );
  });

  it('inserts a job reference as plain text, so it linkifies itself', () => {
    const mention = activeMentionQuery('check @SS', 9)!;
    expect(applyMention('check @SS', 9, mention, 'SS-WDDG-5412').text).toBe(
      'check SS-WDDG-5412 '
    );
  });
});

describe('moving through the menu', () => {
  it('wraps at both ends', () => {
    expect(moveHighlight(0, 1, 3)).toBe(1);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
  });

  it('does not divide by zero on an empty menu', () => {
    expect(moveHighlight(0, 1, 0)).toBe(0);
  });
});

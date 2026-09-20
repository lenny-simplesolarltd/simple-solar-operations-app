// Finding the "@" somebody is currently typing, and replacing it once they
// choose something.
//
// Kept pure and separate from the composer because the fiddly part is not the
// menu, it is deciding when there IS one: "@" in an email address is not a
// mention, "@" three words ago is not the one you are typing, and a mention
// ends at a space.

export interface MentionQuery {
  /** Index of the "@" itself. */
  start: number;
  /** What has been typed after it, which may be empty. */
  query: string;
}

/** How much can be typed after "@" before we stop treating it as a mention. */
const MAX_QUERY = 40;

/**
 * The mention being typed at the caret, or null.
 *
 * An "@" only starts a mention at the beginning of the text or after
 * whitespace, so name@example.com never opens the menu.
 */
export function activeMentionQuery(
  text: string,
  caret: number
): MentionQuery | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;

  const before = at === 0 ? '' : upto[at - 1];
  if (before && !/\s/.test(before)) return null;

  const query = upto.slice(at + 1);
  // A mention is one run of text: a space ends it, and so does a newline.
  if (/\s/.test(query)) return null;
  if (query.length > MAX_QUERY) return null;
  return { start: at, query };
}

export interface MentionApplied {
  text: string;
  caret: number;
}

/**
 * Replace the "@query" at the caret with the chosen text, leaving a trailing
 * space so the next word does not run into it.
 */
export function applyMention(
  text: string,
  caret: number,
  mention: MentionQuery,
  insert: string
): MentionApplied {
  const head = text.slice(0, mention.start);
  const tail = text.slice(Math.min(caret, text.length));
  const middle = `${insert} `;
  return {
    text: `${head}${middle}${tail}`,
    caret: head.length + middle.length
  };
}

/** Move a highlighted index around a list, wrapping at both ends. */
export function moveHighlight(
  current: number,
  delta: number,
  length: number
): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}

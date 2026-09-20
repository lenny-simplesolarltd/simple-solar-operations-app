// Small pure helpers for the launcher badge and the panel state machine.
// Kept out of the provider so they can be tested without React.

/** The three ways chat can be presented. Minimised IS the launcher. */
export type ChatSurface = 'minimised' | 'list' | 'thread';

/**
 * What the launcher badge says. Capped so a busy week cannot turn a small
 * floating button into a wide one.
 */
export function formatUnread(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > 99 ? '99+' : String(Math.floor(total));
}

/** What a screen reader should hear, rather than a bare number. */
export function describeUnread(total: number): string {
  if (total <= 0) return 'Team chat, no unread messages';
  if (total === 1) return 'Team chat, 1 unread message';
  return `Team chat, ${total > 99 ? 'more than 99' : total} unread messages`;
}

/**
 * Where Escape takes you.
 *
 * From a thread it goes back to the list rather than closing outright: losing
 * the whole panel because you wanted to leave one conversation is the kind of
 * thing that makes people stop using Escape at all.
 */
export function escapeFrom(surface: ChatSurface): ChatSurface {
  if (surface === 'thread') return 'list';
  return 'minimised';
}

/** Total unread across every conversation. */
export function totalUnread(
  conversations: readonly { unread: number }[]
): number {
  return conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
}

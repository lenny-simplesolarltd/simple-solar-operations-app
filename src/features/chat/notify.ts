// Telling somebody a message arrived, without being obnoxious about it.
//
// Two rules shape everything here:
//
//   1. Never announce your own message. You just sent it.
//   2. Never announce a conversation the person is already looking at. A
//      notification for a message you can see is noise, and noise is how
//      people end up switching notifications off altogether.
//
// The notification text comes from the refreshed conversation list - the same
// authorized read everything else uses - never from the realtime payload. The
// socket says "something changed"; the read says what you are allowed to know.

export interface NotifiableConversation {
  id: string;
  unread: number;
  name: string;
  preview: string | null;
}

/**
 * Which conversations gained unread messages between two snapshots, skipping
 * the one on screen.
 *
 * A conversation that is new to the list counts from zero, so the first
 * message in a brand-new conversation still announces itself.
 */
export function newlyUnread(
  before: readonly { id: string; unread: number }[],
  after: readonly NotifiableConversation[],
  visibleConversationId: string | null
): NotifiableConversation[] {
  const previous = new Map(before.map((c) => [c.id, c.unread]));
  return after.filter((c) => {
    if (c.id === visibleConversationId) return false;
    return c.unread > (previous.get(c.id) ?? 0);
  });
}

/** One line for the notification body. */
export function notificationBody(preview: string | null): string {
  const text = (preview ?? '').trim();
  if (!text) return 'New message';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * A short two-tone chime, synthesised rather than shipped.
 *
 * A sound file would be another asset to load, cache and keep in step with the
 * brand; this is a few oscillator nodes and costs nothing. It is deliberately
 * quiet and short - a notification, not an alarm.
 */
export function playMessageChime(
  ctor: typeof AudioContext | undefined = typeof window === 'undefined'
    ? undefined
    : (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext)
): boolean {
  if (!ctor) return false;
  try {
    const ctx = new ctor();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    // Rise and fall, so it never clicks.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(ctx.destination);

    for (const [frequency, at] of [
      [660, 0],
      [880, 0.09]
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.18);
    }
    // Let it finish, then release the hardware. The bare global works in a
    // browser and under test; window.setTimeout does not exist in the latter.
    setTimeout(() => void ctx.close().catch(() => {}), 600);
    return true;
  } catch {
    // Audio is a courtesy. A browser that refuses it changes nothing else.
    return false;
  }
}

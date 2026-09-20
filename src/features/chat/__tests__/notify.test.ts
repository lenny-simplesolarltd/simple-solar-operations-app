import { describe, expect, it, vi } from 'vitest';
import { newlyUnread, notificationBody, playMessageChime } from '../notify';

const conv = (
  id: string,
  unread: number,
  preview: string | null = 'hello'
) => ({
  id,
  unread,
  name: `Conversation ${id}`,
  preview
});

describe('which arrivals are worth announcing', () => {
  it('announces a conversation whose unread went up', () => {
    const out = newlyUnread([{ id: 'a', unread: 0 }], [conv('a', 1)], null);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });

  it('says nothing when the count did not move', () => {
    expect(newlyUnread([{ id: 'a', unread: 2 }], [conv('a', 2)], null)).toEqual(
      []
    );
  });

  // Reading a conversation lowers its count; that is not an arrival.
  it('says nothing when the count went down', () => {
    expect(newlyUnread([{ id: 'a', unread: 3 }], [conv('a', 0)], null)).toEqual(
      []
    );
  });

  // The rule that keeps this from becoming noise.
  it('never announces the conversation on screen', () => {
    expect(newlyUnread([{ id: 'a', unread: 0 }], [conv('a', 1)], 'a')).toEqual(
      []
    );
  });

  it('announces a brand-new conversation, counting from zero', () => {
    const out = newlyUnread([], [conv('new', 1)], null);
    expect(out.map((c) => c.id)).toEqual(['new']);
  });

  it('handles several at once', () => {
    const out = newlyUnread(
      [
        { id: 'a', unread: 0 },
        { id: 'b', unread: 1 }
      ],
      [conv('a', 1), conv('b', 3), conv('c', 0)],
      null
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('the notification body', () => {
  it('uses the message', () => {
    expect(notificationBody('Can you check SS-ABCD-1234?')).toBe(
      'Can you check SS-ABCD-1234?'
    );
  });

  it('falls back rather than showing an empty bubble', () => {
    expect(notificationBody(null)).toBe('New message');
    expect(notificationBody('   ')).toBe('New message');
  });

  it('truncates a long message', () => {
    const body = notificationBody('x'.repeat(400));
    expect(body.length).toBeLessThanOrEqual(121);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('the chime', () => {
  it('reports failure rather than throwing where there is no audio', () => {
    expect(playMessageChime(undefined)).toBe(false);
  });

  it('builds a short two-tone sound', () => {
    const oscillators: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    }[] = [];

    // A real class: `new ctor()` cannot construct an arrow function.
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn()
          },
          connect: vi.fn()
        };
      }
      createOscillator() {
        const o = {
          type: '',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
        oscillators.push(o);
        return o;
      }
      close() {
        return Promise.resolve();
      }
    }

    expect(
      playMessageChime(FakeAudioContext as unknown as typeof AudioContext)
    ).toBe(true);
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(
      true
    );
    // It must stop on its own: a notification, not an alarm.
    expect(oscillators.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
  });
});

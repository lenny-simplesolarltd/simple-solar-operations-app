import { describe, expect, it } from 'vitest';
import { linkifyMessage } from '../linkify';
import { conversationName } from '../types';

const refs = (...r: string[]) => new Set(r);

describe('job references', () => {
  it('links one the server resolved for this reader', () => {
    const out = linkifyMessage(
      'Can you check SS-ABCD-1234?',
      refs('SS-ABCD-1234')
    );
    expect(out).toEqual([
      { kind: 'text', text: 'Can you check ' },
      { kind: 'job', text: 'SS-ABCD-1234', jobRef: 'SS-ABCD-1234' },
      { kind: 'text', text: '?' }
    ]);
  });

  // The important one: a reference the reader may not open stays plain text.
  // A dead link that reveals the job exists is worse than no link.
  it('leaves an unresolved reference as text', () => {
    const out = linkifyMessage('what about SS-ZZZZ-9999', refs('SS-ABCD-1234'));
    expect(out).toEqual([{ kind: 'text', text: 'what about SS-ZZZZ-9999' }]);
  });

  it('matches case-insensitively but resolves against the canonical form', () => {
    const out = linkifyMessage('ss-abcd-1234', refs('SS-ABCD-1234'));
    expect(out[0]).toEqual({
      kind: 'job',
      text: 'ss-abcd-1234',
      jobRef: 'SS-ABCD-1234'
    });
  });

  it('links several in one message', () => {
    const out = linkifyMessage(
      'SS-ABCD-1234 and SS-EFGH-5678',
      refs('SS-ABCD-1234', 'SS-EFGH-5678')
    );
    expect(out.filter((s) => s.kind === 'job')).toHaveLength(2);
  });
});

describe('links', () => {
  it('recognises http and https only', () => {
    expect(linkifyMessage('see https://example.com/x', refs())).toEqual([
      { kind: 'text', text: 'see ' },
      {
        kind: 'link',
        text: 'https://example.com/x',
        href: 'https://example.com/x'
      }
    ]);
  });

  // The whole reason the URL pattern is narrow rather than permissive.
  it('never makes a javascript: or data: string clickable', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd'
    ]) {
      const out = linkifyMessage(hostile, refs());
      expect(out.every((s) => s.kind === 'text')).toBe(true);
    }
  });

  it('leaves trailing sentence punctuation out of the address', () => {
    const out = linkifyMessage('go to https://example.com.', refs());
    expect(out[1]).toEqual({
      kind: 'link',
      text: 'https://example.com',
      href: 'https://example.com'
    });
  });
});

describe('markup is never produced', () => {
  // There is no escaping step because nothing is interpolated into markup.
  // The angle brackets must survive as literal text in a text segment.
  it('treats HTML in a message as the characters somebody typed', () => {
    const body = '<img src=x onerror=alert(1)> and <b>bold</b>';
    const out = linkifyMessage(body, refs());
    expect(out).toEqual([{ kind: 'text', text: body }]);
  });

  it('round-trips the original text exactly', () => {
    const body = 'check SS-ABCD-1234 at https://example.com now';
    const out = linkifyMessage(body, refs('SS-ABCD-1234'));
    expect(out.map((s) => s.text).join('')).toBe(body);
  });
});

describe('what a direct conversation is called', () => {
  const me = 'p1';
  it('is the other person, from the reader-s point of view', () => {
    expect(
      conversationName(
        {
          kind: 'Direct',
          title: null,
          members: [
            { personId: me, displayName: 'Tanya' },
            { personId: 'p2', displayName: 'Ben Quick' }
          ]
        },
        me
      )
    ).toBe('Ben Quick');
  });

  it('falls back to the stored title for a group', () => {
    expect(
      conversationName(
        { kind: 'Group', title: 'Thursday installs', members: [] },
        me
      )
    ).toBe('Thursday installs');
  });

  it('names an untitled group rather than showing nothing', () => {
    expect(
      conversationName({ kind: 'Group', title: '   ', members: [] }, me)
    ).toBe('Group conversation');
  });
});

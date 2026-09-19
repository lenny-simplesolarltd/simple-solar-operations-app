import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  linksConfigured,
  linkToken,
  TOKEN_PATTERN,
  tokenHash
} from '../server/tokens';

const env = { FORMS_LINK_SECRET: 'x'.repeat(40) };

describe('recipient link tokens', () => {
  it('are 256-bit, URL-safe and derived from the link id (never stored)', () => {
    const a = linkToken('3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11', env);
    expect(a).toMatch(TOKEN_PATTERN);
    expect(linkToken('3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11', env)).toBe(a);
    expect(linkToken('4e1d2c3b-7a53-4a52-9d53-6f1f0e0b8a22', env)).not.toBe(a);
    expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(a)).not.toContain(a);
  });

  it('depend on the server secret', () => {
    const id = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';
    expect(linkToken(id, env)).not.toBe(
      linkToken(id, { FORMS_LINK_SECRET: 'y'.repeat(40) })
    );
  });

  it('cannot be made without a real secret: there is no fallback', () => {
    expect(linksConfigured({})).toBe(false);
    expect(linksConfigured({ FORMS_LINK_SECRET: 'short' })).toBe(false);
    expect(() => linkToken('id', {})).toThrow(/FORMS_LINK_SECRET/);
  });
});

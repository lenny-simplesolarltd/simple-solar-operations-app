import { describe, expect, it } from 'vitest';
import { compareSerials, normaliseSerial } from '../serial';

/**
 * The installer's screen compares serials so that someone standing at the meter
 * is told, then and there, that what they typed is not what the client expects.
 * It must normalise exactly as app.programme_norm_serial does, or the screen and
 * the office record would disagree about whether two serials are the same one.
 */
describe('normaliseSerial', () => {
  it('upper-cases and removes every non-alphanumeric character', () => {
    expect(normaliseSerial(' 21l3-312 345/x ')).toBe('21L3312345X');
  });

  it('treats nothing, blank and punctuation-only as no serial at all', () => {
    expect(normaliseSerial(null)).toBeNull();
    expect(normaliseSerial(undefined)).toBeNull();
    expect(normaliseSerial('   ')).toBeNull();
    expect(normaliseSerial('--/--')).toBeNull();
  });
});

describe('compareSerials', () => {
  it('matches across case, spacing and punctuation', () => {
    expect(compareSerials('21L3 312345', ' 21l3-312345 ')).toBe('match');
  });

  it('reports a genuine difference as a mismatch', () => {
    expect(compareSerials('21L3312345', '21L3312346')).toBe('mismatch');
  });

  it('never claims a match when no expected serial was recorded', () => {
    expect(compareSerials(null, '21L3312345')).toBe('no-expected');
    expect(compareSerials('  ', '21L3312345')).toBe('no-expected');
  });

  it('says nothing either way until something has been typed', () => {
    expect(compareSerials('21L3312345', '')).toBe('not-typed');
    expect(compareSerials('21L3312345', '  -  ')).toBe('not-typed');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import {
  FIELD_TYPE_INFO,
  INPUT_TYPES,
  STAFF_ONLY_TYPES,
  SIGNATURE_MAX_LENGTH,
  checkAnswers,
  hasStaffOnlyField,
  isSignaturePath,
  type FormDefinition
} from '../definition';
import { SignatureImage } from '../components/signature-pad';
import { ResponseAnswers } from '../components/response-answers';

/**
 * A signature the CUSTOMER draws.
 *
 * A photo question makes a form unsendable as a recipient link, because a photo
 * becomes evidence and evidence needs a signed-in owner. A signature must not
 * inherit that, or the one case people ask for - the customer signing on their
 * own phone, from a link - would be the case it could not do. So the value is
 * the drawing itself, and these assertions hold it to that.
 *
 * The allow-list is the other half: this value ends up as an SVG path's `d`
 * attribute, so it is untrusted content going into markup.
 */
const SIGNED = 'M10 20 L12 22 L30 44 M40 10 C41 12 43 14 45 16';

const form = (required = false): FormDefinition => ({
  fields: [
    {
      id: 'sign',
      type: 'signature',
      label: 'Sign here',
      ...(required ? { required: true } : {})
    }
  ]
});

describe('a signature is not a file', () => {
  it('is an answerable question type', () => {
    expect(INPUT_TYPES).toContain('signature');
    expect(FIELD_TYPE_INFO.signature.label).toBe('Signature');
  });

  it('does not make a form unsendable as a recipient link', () => {
    // The whole reason it is not evidence.
    expect(STAFF_ONLY_TYPES).not.toContain('signature');
    expect(hasStaffOnlyField(form())).toBe(false);
  });
});

describe('what counts as a signature', () => {
  it('accepts strokes drawn in the box', () => {
    expect(isSignaturePath(SIGNED)).toBe(true);
    expect(checkAnswers(form(), { sign: SIGNED }).errors).toEqual({});
  });

  it('refuses anything that is not path data', () => {
    for (const bad of [
      '<svg onload=alert(1)>',
      'M10 10 </path><script>alert(1)</script>',
      'url(javascript:alert(1))',
      'M10 10 A 5 5 0 0 1 20 20' // arcs are not in the allow-list
    ])
      expect(isSignaturePath(bad), bad).toBe(false);
  });

  it('refuses a path that does not start with a move', () => {
    expect(isSignaturePath('L10 20 L12 22')).toBe(false);
  });

  it('refuses a signature longer than the database would store', () => {
    const huge = 'M1 1' + ' L2 2'.repeat(SIGNATURE_MAX_LENGTH);
    expect(huge.length).toBeGreaterThan(SIGNATURE_MAX_LENGTH);
    expect(isSignaturePath(huge)).toBe(false);
  });

  it('reports a required signature that was never drawn', () => {
    expect(checkAnswers(form(true), {}).errors.sign).toMatch(/required/i);
    expect(checkAnswers(form(true), { sign: '' }).errors.sign).toMatch(
      /required/i
    );
  });

  it('reports rubbish in place of a signature', () => {
    expect(
      checkAnswers(form(true), { sign: 'not a signature' }).errors.sign
    ).toMatch(/sign/i);
  });
});

describe('reading a signature back', () => {
  it('draws it rather than printing its coordinates', () => {
    const out = renderToStaticMarkup(
      <ResponseAnswers definition={form()} answers={{ sign: SIGNED }} />
    );
    expect(out).toContain('<svg');
    expect(out).toContain(`d="${SIGNED}"`);
    expect(out).toContain('Signature');
  });

  it('says it was not signed rather than showing an empty box', () => {
    const out = renderToStaticMarkup(
      <ResponseAnswers definition={form()} answers={{}} />
    );
    expect(out).toContain('Not signed');
    expect(out).not.toContain('<path');
  });

  it('refuses to draw a value that is not path data', () => {
    // Belt and braces: the database validated this on the way in, and it is
    // checked again on the way out, because this attribute is markup.
    const out = renderToStaticMarkup(
      <ResponseAnswers
        definition={form()}
        answers={{ sign: '"><script>alert(1)</script>' }}
      />
    );
    expect(out).toContain('Not signed');
    expect(out).not.toContain('<script');
  });

  it('renders a standalone signature at a fixed aspect, whatever the screen', () => {
    const out = renderToStaticMarkup(<SignatureImage value={SIGNED} />);
    expect(out).toContain('viewBox="0 0 600 200"');
    expect(out).toContain('preserveAspectRatio');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server/actions', () => ({
  beginVisitPhotoAction: async () => ({ ok: false, message: 'not in a test' }),
  completeVisitPhotoAction: async () => ({ ok: true })
}));

import { VisitPhotoField } from '../components/photo-field';

/**
 * The photo control. A photograph that is on the phone but not on the server is
 * the one thing a field worker cannot tell by looking, so every tile says which
 * it is: uploaded photographs are marked saved, and the count says "saved"
 * rather than "added".
 */

const field = {
  id: 'meter_photo',
  type: 'photo' as const,
  label: 'Meter photo',
  max: 4
};

const render = (value: string[], visitId: string | null) =>
  renderToStaticMarkup(
    <VisitPhotoField
      field={field}
      value={value}
      onChange={() => {}}
      inputId='field-meter_photo'
      invalid={false}
      visitId={visitId}
      category='MeterPhoto'
    />
  );

describe('VisitPhotoField', () => {
  it('cannot be used before a visit exists to attach photographs to', () => {
    const html = render([], null);
    expect(html).toContain('disabled=""');
    expect(html).toContain('0 of 4 saved');
  });

  it('marks each photograph that has reached the server as saved', () => {
    const html = render(
      ['55555555-5555-5555-5555-555555555555'],
      '66666666-6666-6666-6666-666666666666'
    );
    expect(html).toContain('Saved');
    expect(html).toContain('1 of 4 saved');
    expect(html).toContain(
      '/api/evidence/55555555-5555-5555-5555-555555555555'
    );
    expect(html).toContain('Add another photo');
  });
});

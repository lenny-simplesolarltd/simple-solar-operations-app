import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server/lookup', () => ({
  searchPropertiesAction: async () => ({ ok: true, properties: [] })
}));

import { PropertyLookupField } from '../components/property-lookup';
import type { ProgrammeProperty } from '../types';

/**
 * The confirmation card. Recording a visit against the wrong property is the
 * mistake on this screen that nobody catches until the client does, so the card
 * has to state all three identifying things - the address, PCH's own reference
 * and the serial they expect - and must not imply a property can be swapped on a
 * draft when no command does that.
 */

const property: ProgrammeProperty = {
  id: '11111111-1111-1111-1111-111111111111',
  programmeId: '22222222-2222-2222-2222-222222222222',
  externalRef: 'PCH-00412',
  addressLine1: '12 Example Terrace',
  addressLine2: 'Flat 3',
  town: 'Plymouth',
  postcode: 'PL1 1AA',
  expectedMeterSerial: '21L3312345',
  existingSimSerial: null,
  existingSimType: null,
  notes: null,
  active: true,
  synthetic: false,
  version: 1
};

const card = (p: ProgrammeProperty, locked = false) =>
  renderToStaticMarkup(
    <PropertyLookupField
      field={{ id: 'property', type: 'entity', label: 'Property' }}
      value={p.id}
      onChange={() => {}}
      inputId='field-property'
      invalid={false}
      programmeId={p.programmeId}
      initial={p}
      locked={locked}
    />
  );

describe('PropertyLookupField, once a property is chosen', () => {
  it('states the address, the PCH property ID and the expected meter together', () => {
    const html = card(property);
    expect(html).toContain('12 Example Terrace');
    expect(html).toContain('Flat 3');
    expect(html).toContain('PL1 1AA');
    expect(html).toContain('PCH property ID');
    expect(html).toContain('PCH-00412');
    expect(html).toContain('Expected meter');
    expect(html).toContain('21L3312345');
  });

  it('says the expected meter is not recorded rather than leaving the row out', () => {
    const html = card({ ...property, expectedMeterSerial: null });
    expect(html).toContain('Expected meter');
    expect(html).toContain('Not recorded');
  });

  it('offers a change before the visit is started', () => {
    expect(card(property)).toContain('Change it');
  });

  it('once started, explains what to do instead of offering a swap', () => {
    const html = card(property, true);
    expect(html).not.toContain('Change it');
    expect(html).toContain('This visit was started for this property');
    expect(html).toContain('start a visit at the right one');
  });
});

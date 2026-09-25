import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server/actions', () => ({
  startVisitAction: async () => ({ ok: true, result: {} }),
  submitVisitAction: async () => ({ ok: true, result: {} }),
  beginVisitPhotoAction: async () => ({ ok: false, message: 'not in a test' }),
  completeVisitPhotoAction: async () => ({ ok: true })
}));
vi.mock('../server/lookup', () => ({
  searchPropertiesAction: async () => ({ ok: true, properties: [] })
}));

import type { FormDefinition } from '@/features/forms/definition';
import {
  MeterSerialCheck,
  VisitForm,
  VisitRecorded
} from '../components/visit-form';
import type { ProgrammeProperty } from '../types';

/**
 * The installer's screen, at a doorstep, one-handed.
 *
 * What these tests hold in place is mostly about honesty rather than layout: the
 * screen may help someone notice they are at the wrong meter, but it must never
 * read as though it had decided the question - the server derives
 * meter_serial_matches and the office reviews it.
 */

const property: ProgrammeProperty = {
  id: '11111111-1111-1111-1111-111111111111',
  programmeId: '22222222-2222-2222-2222-222222222222',
  externalRef: 'PCH-00412',
  addressLine1: '12 Example Terrace',
  addressLine2: 'Flat 3',
  town: 'Plymouth',
  postcode: 'PL1 1AA',
  expectedMeterSerial: '21L3 312345',
  existingSimSerial: null,
  notes: null,
  active: true,
  synthetic: false,
  version: 1
};

const definition: FormDefinition = {
  fields: [
    { id: 'property', type: 'entity', label: 'Property', required: true },
    {
      id: 'actual_meter_serial',
      type: 'short_text',
      label: 'Actual meter serial',
      required: true
    },
    { id: 'meter_reading', type: 'number', label: 'Meter reading', min: 0 },
    { id: 'csq_reading', type: 'number', label: 'CSQ reading', min: 0, max: 31 }
  ]
} as FormDefinition;

const form = {
  formId: '33333333-3333-3333-3333-333333333333',
  revisionId: '44444444-4444-4444-4444-444444444444',
  revision: 1,
  title: 'PCH - Installer Meter Visit',
  description: null,
  definition,
  signalConfig: { metric: 'csq', good_min: 14, bad_max: 4 }
};

const fieldMap = {
  property: 'property',
  actual_meter_serial: 'actual_meter_serial',
  meter_reading: 'meter_reading',
  csq: 'csq_reading'
};

const markup = () =>
  renderToStaticMarkup(
    <VisitForm
      programmeId={property.programmeId}
      form={form}
      fieldMap={fieldMap}
      property={property}
      doneHref='/dashboard/operations/programmes/p/properties'
      exitHref='/dashboard/operations/programmes'
    />
  );

describe('MeterSerialCheck', () => {
  it('shows the expected serial before anything has been typed', () => {
    const html = renderToStaticMarkup(
      <MeterSerialCheck expected='21L3 312345' actual='' />
    );
    expect(html).toContain('21L3 312345');
    expect(html).toContain('Read the serial from the meter itself');
  });

  it('calls a match the same serial, and still points at the review', () => {
    const html = renderToStaticMarkup(
      <MeterSerialCheck expected='21L3 312345' actual='21l3-312345' />
    );
    expect(html).toContain('Same as the expected serial');
    expect(html).toContain('office still confirms this on review');
  });

  it('warns on a difference without telling anyone to change what they read', () => {
    const html = renderToStaticMarkup(
      <MeterSerialCheck expected='21L3312345' actual='21L3312346' />
    );
    expect(html).toContain('not the serial expected here');
    expect(html).toContain('send what you read');
    expect(html).toContain('office reviews every mismatch');
  });

  it('says plainly that there is nothing to compare, rather than showing a match', () => {
    const html = renderToStaticMarkup(
      <MeterSerialCheck expected={null} actual='21L3312345' />
    );
    expect(html).toContain('No expected serial was given for this property');
    expect(html).not.toContain('Same as the expected serial');
  });
});

describe('VisitForm', () => {
  it('puts the expected serial beside the question asking for the actual one', () => {
    const html = markup();
    const serialQuestion = html.indexOf('Actual meter serial');
    const expectedSerial = html.indexOf('Expected serial');
    expect(serialQuestion).toBeGreaterThan(-1);
    expect(expectedSerial).toBeGreaterThan(serialQuestion);
    // Adjacent, not parked at the top of the form beside the property.
    expect(html.indexOf('Meter reading')).toBeGreaterThan(expectedSerial);
  });

  it('asks a phone for a decimal keypad for the reading and digits for CSQ', () => {
    const html = markup();
    const reading = html.slice(html.indexOf('field-meter_reading'));
    expect(reading).toMatch(/inputmode="decimal"/i);
    const csq = html.slice(html.indexOf('field-csq_reading'));
    expect(csq).toMatch(/inputmode="numeric"/i);
  });

  it('has exactly one submit control, however it is anchored', () => {
    const html = markup();
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('env(safe-area-inset-bottom');
  });
});

describe('VisitRecorded', () => {
  it('offers the next property and a way out, and stays honest about review', () => {
    const html = renderToStaticMarkup(
      <VisitRecorded doneHref='/next' exitHref='/programmes' />
    );
    expect(html).toContain('It is now with the office for review.');
    expect(html).toContain('href="/next"');
    expect(html).toContain('Record the next property');
    expect(html).toContain('href="/programmes"');
  });
});

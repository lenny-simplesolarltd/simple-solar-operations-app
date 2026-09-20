/**
 * The column registry for the historical Job Booking export.
 *
 * Columns are addressed by index, not by name: the export has repeated header
 * labels (`Electrical extras to note` at 22 and 33, `Roofing extras Optimisers`
 * at 24 and 30) and a name-keyed reader would drop one of each pair.
 *
 * Every one of the 94 columns has an entry. `analyse.ts` fails if the registry
 * and the file disagree on width or on any header label, so a re-export that
 * adds or reorders a column cannot pass unnoticed.
 */

/** What the eventual importer does with the column. */
export type Disposition =
  /** Becomes a typed value on a normalised row. */
  | 'IMPORT'
  /** Kept only inside the intake payload, for provenance. */
  | 'PRESERVE_ONLY'
  /** Carries no information worth keeping. */
  | 'IGNORE';

/** Why a column has no normalised destination. */
export type NoDestinationReason =
  | 'A_NEW_STRUCTURED_FIELD_MAY_BE_NEEDED'
  | 'B_LEGACY_METADATA'
  | 'C_DUPLICATE_OF_ANOTHER_COLUMN'
  | 'D_OBSOLETE'
  | 'E_UNKNOWN_OWNER_DECISION';

export type Confidence = 'High' | 'Medium' | 'Low';

export type ColumnSpec = {
  index: number;
  /** Header label exactly as exported, trailing spaces included. */
  header: string;
  meaning: string;
  /** Destination table in the current schema, or null when there is none. */
  destinationTable: string | null;
  /** Destination column(s). Empty when the column is not imported. */
  destinationFields: string[];
  transformation: string;
  confidence: Confidence;
  /** How a clash with data already in Supabase is resolved. */
  conflictRule: string;
  disposition: Disposition;
  noDestinationReason?: NoDestinationReason;
  notes?: string;
};

/** Marks a column pair that answers the same question in two form generations. */
export type GenerationPair = {
  concept: string;
  /** Preferred column index when both are populated. */
  primary: number;
  /** Fallback column index. */
  fallback: number;
  rule: string;
};

const C = (spec: ColumnSpec): ColumnSpec => spec;

export const COLUMNS: ColumnSpec[] = [
  C({
    index: 0,
    header: 'Reference',
    // No example value is given: the reference is built from the customer's
    // postcode, so quoting one here would publish a customer's postcode.
    meaning:
      'Legacy job reference the office typed by hand: the customer postcode with the space removed, followed by a counter. Treated as customer identity.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json', 'source_revision'],
    transformation:
      'Trimmed and kept verbatim. Never mapped to jobs.job_ref: the schema enforces SS-XXXX-0000 and this is not that shape.',
    confidence: 'High',
    conflictRule:
      'Never overwrites an existing jobs.job_ref. Used only as a deduplication signal.',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'B_LEGACY_METADATA',
    notes:
      'Populated on 126/303 rows and not unique across them, so it cannot be the idempotency key.'
  }),
  C({
    index: 1,
    header: 'Address - Street Address',
    meaning: 'Customer street address, first form generation.',
    destinationTable: 'customers',
    destinationFields: ['address_line1'],
    transformation:
      'Whitespace-normalised. First line becomes address_line1; any remainder becomes address_line2.',
    confidence: 'High',
    conflictRule:
      'Existing customer row wins. A difference raises a warning for owner review; never overwritten.',
    disposition: 'IMPORT'
  }),
  C({
    index: 2,
    header: 'Address - City',
    meaning: 'Customer town.',
    destinationTable: 'customers',
    destinationFields: ['town'],
    transformation: 'Whitespace-normalised.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 3,
    header: 'Address - Postal / Zip Code',
    meaning: 'Customer postcode, first form generation.',
    destinationTable: 'customers',
    destinationFields: ['postcode'],
    transformation:
      'Upper-cased and re-spaced to the schema shape. Rejected if it does not match.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT',
    notes:
      'Superseded by column 61 in the later form generation. See GENERATION_PAIRS.'
  }),
  C({
    index: 4,
    header: 'Customer name - First Name',
    meaning: 'Customer first name, first form generation.',
    destinationTable: 'customers',
    destinationFields: ['first_name'],
    transformation: 'Whitespace-normalised.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT',
    notes: 'Superseded by column 62.'
  }),
  C({
    index: 5,
    header: 'Customer name - Last Name',
    meaning: 'Customer surname, first form generation.',
    destinationTable: 'customers',
    destinationFields: ['last_name'],
    transformation: 'Whitespace-normalised.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT',
    notes: 'Superseded by column 63.'
  }),
  C({
    index: 6,
    header: 'Customer Email',
    meaning: 'Customer email address.',
    destinationTable: 'customers',
    destinationFields: ['email'],
    transformation:
      'Lower-cased and trimmed to satisfy the schema check. Rejected if not an email shape.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins. Also a deduplication signal.',
    disposition: 'IMPORT'
  }),
  C({
    index: 7,
    header: 'Installers',
    meaning:
      'Installer(s) allocated, as a newline-separated multi-select of first names.',
    destinationTable: 'historical_job_people',
    destinationFields: ['source_value', 'person_id', 'match_kind'],
    transformation:
      'Split on newlines. Each name is preserved verbatim; a person link is added only for an unambiguous match. An unresolved name blocks nothing.',
    confidence: 'Medium',
    conflictRule:
      'Never creates or replaces an allocation. Recorded as a historical fact only.',
    disposition: 'IMPORT',
    notes:
      'Contains the ambiguous alias "Lewis" on 104 rows; see people-matches.md.'
  }),
  C({
    index: 8,
    header: 'Email James',
    meaning:
      'Notification address used for the electrical booking email in the earlier form generation. Holds whichever contractor was emailed, not James specifically.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload only.',
    confidence: 'Low',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'E_UNKNOWN_OWNER_DECISION',
    notes:
      'Label and content disagree, and some values are junk placeholders. Not used for people matching.'
  }),
  C({
    index: 9,
    header: 'Email Lewis',
    meaning:
      'Second notification address on the same email, same caveat as column 8.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload only.',
    confidence: 'Low',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'E_UNKNOWN_OWNER_DECISION'
  }),
  C({
    index: 10,
    header: 'Date Roofer',
    meaning: 'Date the roofing visit was booked for.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'MM-DD-YYYY to an ISO date on the Roof work package. A date in the past is recorded as a historical fact, not a plan.',
    confidence: 'High',
    conflictRule:
      'Never moves an existing work package; no live work package is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 11,
    header: 'Date Sparky',
    meaning: 'Date the electrical visit was booked for.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 10, on the Electrical work package.',
    confidence: 'High',
    conflictRule:
      'Never moves an existing work package; no live work package is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 12,
    header: 'Date Scaffolding',
    meaning: 'Date scaffolding was booked to be erected.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'MM-DD-YYYY to an ISO date. Recorded as a completed historical erect, never as a live booking.',
    confidence: 'High',
    conflictRule:
      'Never touches an existing scaffold booking; no live scaffold booking is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 13,
    header: 'Roof hooks type',
    meaning: 'Roof hook / mounting type chosen for the roof.',
    destinationTable: 'technical_details',
    destinationFields: ['roof_type'],
    transformation:
      'Whitespace-normalised free text. Not mapped to a products SKU: the 29 distinct values mix hook type, tile type and manufacturer.',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 14,
    header: 'Roof hooks Quantity',
    meaning: 'Number of roof hooks required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Integer to a materials line on the Roof package, description "Roof hooks (historical)", unit Each.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 15,
    header: 'Roof end clamps Quantity',
    meaning: 'Number of end clamps required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 14.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 16,
    header: 'Roof mid clamps Quantity',
    meaning: 'Number of mid clamps required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 14.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 17,
    header: 'Roof end caps Quantity',
    meaning: 'Number of end caps required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 14.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 18,
    header: 'Roof rail Quantity',
    meaning: 'Number of rails required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 14.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 19,
    header: 'Roof splice Quantity',
    meaning: 'Number of splices required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'As column 14.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 20,
    header: 'Inverter ordered',
    meaning: 'Inverter model ordered (mostly Fox ESS).',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Kept as free text on an Inverter equipment row. Not resolved to products.sku: model strings are not SKUs and several cells describe more than one unit.',
    confidence: 'Medium',
    conflictRule:
      'Never replaces existing job_equipment; no live job_equipment row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 21,
    header: 'Battery ordered',
    meaning: 'Battery model and count ordered.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Kept as free text on a Battery equipment row. Counts embedded in prose ("FoxESS EP5 x 3") are not parsed into quantity.',
    confidence: 'Medium',
    conflictRule:
      'Never replaces existing job_equipment; no live job_equipment row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 22,
    header: 'Electrical extras to note',
    meaning: 'Electrical extras multi-select. Populated on 7 rows.',
    destinationTable: 'technical_details',
    destinationFields: ['electrical_notes'],
    transformation:
      'Newline list folded into electrical_notes, prefixed "Electrical extras:".',
    confidence: 'Medium',
    conflictRule:
      'Appended to the historical note block only; never edits an existing note.',
    disposition: 'IMPORT',
    notes: 'Shares its header label with column 33, which is empty.'
  }),
  C({
    index: 23,
    header: 'Roofing extras to note',
    meaning: 'Roofing extras multi-select. Never populated.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'D_OBSOLETE',
    notes: '0/303 populated.'
  }),
  C({
    index: 24,
    header: 'Roofing extras Optimisers',
    meaning: 'Number of optimisers, current form generation.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Integer to a materials line "Optimisers (historical)", unit Each.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT',
    notes: 'Paired with column 30. See GENERATION_PAIRS.'
  }),
  C({
    index: 25,
    header: 'Roofing extras Bird netting (m)',
    meaning: 'Metres of bird netting required.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Decimal to a materials line "Bird netting (historical)", unit Metre.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 26,
    header: 'Annual generation',
    meaning: 'Estimated annual generation in kWh.',
    destinationTable: 'technical_details',
    destinationFields: ['annual_generation_kwh'],
    transformation: 'Decimal. Rejected if negative.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 27,
    header: 'Annual consumption',
    meaning: 'Estimated annual consumption in kWh.',
    destinationTable: 'technical_details',
    destinationFields: ['annual_consumption_kwh'],
    transformation: 'Decimal.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 28,
    header: 'Cost of job',
    meaning: 'Agreed gross selling price in pounds.',
    destinationTable: 'jobs',
    destinationFields: [
      'original_gross_pence (nullable for HistoricalImport)',
      'current_contract_gross_pence'
    ],
    transformation:
      'Pounds to pence. Zero and unparseable values leave the price null rather than being defaulted; the > 0 check still applies to any value that is recorded.',
    confidence: 'Medium',
    conflictRule:
      'Never overwrites an existing job price. A difference is reported, not applied.',
    disposition: 'IMPORT',
    notes:
      'Informational only: no payment, invoice or accounting event is derived from it.'
  }),
  C({
    index: 29,
    header: 'Bens prompts',
    meaning:
      'Office checklist the director worked through at booking. The choice list changed at least twice, so it mixes checklist items ("Invoice", "Send pre sale"), bare answers ("Yes", "No", "Not sure") and extras ("Canopy", "Smoke alarm", "Ohme").',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload only.',
    confidence: 'Low',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'E_UNKNOWN_OWNER_DECISION',
    notes:
      'Replaying these as tasks would create live office work for finished jobs. See owner-decisions.md.'
  }),
  C({
    index: 30,
    header: 'Roofing extras Optimisers',
    meaning: 'Number of optimisers, earlier form generation.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'Used only when column 24 is blank.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT',
    notes: 'Duplicate header of column 24.'
  }),
  C({
    index: 31,
    header: 'Sparky',
    meaning: 'Electrician allocated to the job, as a first name.',
    destinationTable: 'historical_job_people',
    destinationFields: ['source_value', 'person_id', 'match_kind'],
    transformation:
      'Preserved verbatim; linked only on an unambiguous match. No allocation is created.',
    confidence: 'Medium',
    conflictRule:
      'Never creates or replaces an allocation. Recorded as a historical fact only.',
    disposition: 'IMPORT',
    notes: 'Contains the ambiguous aliases "Dave" and "Lewis".'
  }),
  C({
    index: 32,
    header: 'SUNPOWER Inverter ordered',
    meaning:
      'Inverter model for SunPower/Powervault systems; a conditional branch of the form.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Used when column 20 is blank. Genuinely a different question, not a newer version of column 20.',
    confidence: 'Medium',
    conflictRule:
      'Never replaces existing job_equipment; no live job_equipment row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 33,
    header: 'Electrical extras to note',
    meaning: 'Duplicate export of the column 22 question. Never populated.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'C_DUPLICATE_OF_ANOTHER_COLUMN',
    notes: '0/303 populated; same header label as column 22.'
  }),
  C({
    index: 34,
    header: 'Amp of Fuse',
    meaning: 'Main fuse rating in amps.',
    destinationTable: 'technical_details',
    destinationFields: ['fuse_rating_amps'],
    transformation:
      'Integer; the schema requires > 0. Non-integer values such as "3.68" are a kW rating in the wrong column and are rejected with a warning.',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 35,
    header: 'Extras for ordering',
    meaning: 'Standing electrical order checklist, as a newline multi-select.',
    destinationTable: 'technical_details',
    destinationFields: ['ordering_notes'],
    transformation:
      'Kept as text. Not converted to materials lines: the entries name catalogue items without quantities, and the wording drifts ("with2 way" / "with 2 ways").',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 36,
    header: 'SUNPOWER Battery ordered',
    meaning: 'Battery model for SunPower/Powervault systems.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'Used when column 21 is blank.',
    confidence: 'Medium',
    conflictRule:
      'Never replaces existing job_equipment; no live job_equipment row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 37,
    header: 'Customer Phone Number',
    meaning: 'Customer telephone number.',
    destinationTable: 'customers',
    destinationFields: ['phone'],
    transformation:
      'Trimmed, kept verbatim. Digits are normalised only to build a deduplication key, never to rewrite the stored value.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 38,
    header: 'Solar size (kW)',
    meaning: 'System size in kW.',
    destinationTable: 'technical_details',
    destinationFields: ['system_kw'],
    transformation: 'Decimal.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 39,
    header: 'Battery size (kWh)',
    meaning: 'Battery capacity in kWh.',
    destinationTable: 'technical_details',
    destinationFields: ['battery_kwh'],
    transformation: 'Decimal.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 40,
    header: 'MPAN',
    meaning: 'Meter Point Administration Number.',
    destinationTable: 'technical_details',
    destinationFields: ['mpan'],
    transformation:
      'Kept as plain text exactly as entered, per the schema comment.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 41,
    header: 'Submission Date',
    meaning: 'When the booking form was submitted.',
    destinationTable: 'intake',
    destinationFields: ['received_at'],
    transformation:
      'Three formats accepted, all unambiguous. Also supplies jobs.sold_at, which the schema requires.',
    confidence: 'High',
    conflictRule: 'Never changes an existing job sold_at.',
    disposition: 'IMPORT'
  }),
  C({
    index: 42,
    header: 'Email',
    meaning:
      'Form recipient address. Constant: info@simplesolarltd.co.uk on all 300 populated rows.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'D_OBSOLETE',
    notes:
      'A form delivery setting, not job data. info@ is not an actor in the current system.'
  }),
  C({
    index: 43,
    header: 'Roofing notes',
    meaning: 'Free-text roofing notes.',
    destinationTable: 'technical_details',
    destinationFields: ['roof_notes'],
    transformation: 'Kept verbatim.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 44,
    header: 'Electrical notes',
    meaning: 'Free-text electrical notes.',
    destinationTable: 'technical_details',
    destinationFields: ['electrical_notes'],
    transformation: 'Kept verbatim.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 45,
    header: 'Ordering notes',
    meaning: 'Free-text ordering notes.',
    destinationTable: 'technical_details',
    destinationFields: ['ordering_notes'],
    transformation:
      'Kept verbatim, joined after column 35 when both are present.',
    confidence: 'High',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 46,
    header: 'G99',
    meaning:
      'G99 application flag. The only value is the literal "G99", so presence means yes.',
    destinationTable: 'technical_details',
    destinationFields: ['g99_status'],
    transformation:
      'Presence to g99_status = "HistoricalG99Flagged"; blank leaves it null rather than asserting "not required".',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 47,
    header: 'Salesman',
    meaning: 'Salesperson who sold the job.',
    destinationTable: 'jobs',
    destinationFields: ['salesperson_id (nullable for HistoricalImport)'],
    transformation:
      'Matched against people. A unique match sets jobs.salesperson_id; anything else leaves it null (permitted for HistoricalImport) and the name is preserved in historical_job_people.',
    confidence: 'Medium',
    conflictRule: 'Never changes an existing job salesperson.',
    disposition: 'IMPORT',
    notes:
      'Populated on only 102/303 rows, and "Dave" and "Dan" are ambiguous. No longer blocking: unknown is recorded as unknown.'
  }),
  C({
    index: 48,
    header: 'Lead from',
    meaning: 'Lead source.',
    destinationTable: 'jobs',
    destinationFields: ['lead_source'],
    transformation:
      'Whitespace-normalised free text; the column is unconstrained text. Typos are preserved, not corrected.',
    confidence: 'High',
    conflictRule: 'Never changes an existing job lead_source.',
    disposition: 'IMPORT',
    notes:
      '"Student Choice" and "Student Choise" are the same source spelled two ways.'
  }),
  C({
    index: 49,
    header: 'Fox order email',
    meaning:
      'Merchant address the Fox order was sent to. Constant on all 63 populated rows.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'D_OBSOLETE',
    notes:
      'A routing setting. The merchant itself is carried by columns 60/85/86.'
  }),
  C({
    index: 50,
    header: 'PowerVault order email',
    meaning: 'As column 49, same constant address.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'C_DUPLICATE_OF_ANOTHER_COLUMN'
  }),
  C({
    index: 51,
    header: 'PowerVault extras',
    meaning: 'PowerVault extras. Never populated.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'D_OBSOLETE'
  }),
  C({
    index: 52,
    header: 'Genius flashing ',
    meaning:
      'Quantity of Genius flashing required. Header has a trailing space in the export.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Integer to a materials line "Genius flashing (historical)", unit Each. A recorded 0 means "none required" and produces no line.',
    confidence: 'Medium',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 53,
    header: 'Electrical extras Canopy',
    meaning: 'Canopy required, as 1/0. Populated on 3 rows.',
    destinationTable: 'technical_details',
    destinationFields: ['electrical_notes'],
    transformation: 'Folded into the historical electrical note block when 1.',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 54,
    header: 'Electrical extras Off-grid backup',
    meaning: 'Off-grid backup required, as 1/0. Populated on 4 rows.',
    destinationTable: 'technical_details',
    destinationFields: ['electrical_notes'],
    transformation: 'As column 53.',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 55,
    header: 'Scaffold company',
    meaning:
      'Scaffolding company, or a "not required" answer written into the same box.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Matched against companies of type Scaffolder. "NA", "no scaff", "NOT REQUIRED" and similar set scaffold_required = false instead of naming a company. "TBC" is unresolved.',
    confidence: 'Medium',
    conflictRule:
      'Never touches an existing scaffold booking. Companies are never created automatically.',
    disposition: 'IMPORT',
    notes:
      '"Plym" and "Plym Group" are almost certainly one company across 76 rows; see owner-decisions.md.'
  }),
  C({
    index: 56,
    header: 'Finance',
    meaning: 'Whether the sale used a finance route.',
    destinationTable: 'jobs',
    destinationFields: ['finance_route (nullable for HistoricalImport)'],
    transformation:
      'No becomes "Standard" - a real route decision. Yes leaves finance_route null: the form never recorded which route, and both evaluate_ready_to_book and process_booking_gates branch on finance_route = "Standard", so any route value would assert a decision that was never made.',
    confidence: 'Medium',
    conflictRule: 'Never changes an existing job finance_route.',
    disposition: 'IMPORT',
    notes:
      'No finance_plans row is created: the form answer is not a finance agreement. The original Yes/No survives in the intake payload.'
  }),
  C({
    index: 57,
    header: 'Emails',
    meaning: 'Stray address column, populated on a single row.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload only.',
    confidence: 'Low',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'E_UNKNOWN_OWNER_DECISION'
  }),
  C({
    index: 58,
    header: 'Date for invoice',
    meaning: 'Date the office intended to raise the invoice.',
    destinationTable: null,
    destinationFields: [],
    transformation:
      'Parsed and validated, then kept in the intake payload only.',
    confidence: 'Medium',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'A_NEW_STRUCTURED_FIELD_MAY_BE_NEEDED',
    notes:
      'Deliberately not written to invoice_stages.due_date: a historical intention is not a live invoice obligation.'
  }),
  C({
    index: 59,
    header: 'Panel',
    meaning: 'Panel wattage used: 510, 455 or "Mixed".',
    destinationTable: 'technical_details',
    destinationFields: ['roof_notes'],
    transformation:
      'Recorded in the historical roof note block. Not resolved to products: matching a wattage to a SKU needs a manufacturer the form never captured.',
    confidence: 'Medium',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 60,
    header: 'Merchant',
    meaning: 'Merchant the order went to, recorded as an email address.',
    destinationTable: 'companies',
    destinationFields: ['id (lookup only)'],
    transformation:
      'Email mapped to a known merchant for reporting. No company is created and no order is created.',
    confidence: 'Medium',
    conflictRule: 'Never creates or edits a company.',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'B_LEGACY_METADATA',
    notes:
      'Overlaps columns 85 and 86; the three are reconciled into one merchant value.'
  }),
  C({
    index: 61,
    header: 'Post code',
    meaning: 'Customer postcode, later form generation.',
    destinationTable: 'customers',
    destinationFields: ['postcode'],
    transformation:
      'As column 3. Preferred over column 3 when both are present.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 62,
    header: '1st name',
    meaning: 'Customer first name, later form generation.',
    destinationTable: 'customers',
    destinationFields: ['first_name'],
    transformation: 'Preferred over column 4 when both are present.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 63,
    header: '2nd name',
    meaning: 'Customer surname, later form generation.',
    destinationTable: 'customers',
    destinationFields: ['last_name'],
    transformation: 'Preferred over column 5 when both are present.',
    confidence: 'High',
    conflictRule: 'Existing customer row wins.',
    disposition: 'IMPORT'
  }),
  // --- Catalogue-specific component quantity columns (64-80) -----------------
  // These name an exact manufacturer part. They are mapped as described
  // materials lines rather than products rows: creating products from a form
  // export would seed the catalogue from unreviewed historical text.
  ...(
    [
      [
        64,
        'Slate - Renusol Roof Hook (R420181) - Landscape & screws',
        'Renusol R420181 landscape roof hooks with screws'
      ],
      [
        65,
        'Concrete - Renusol Roof hook (R420150) - Portrait & screws',
        'Renusol R420150 portrait roof hooks with screws'
      ],
      [
        66,
        'L bracket for landscape hooks - REN-420353',
        'Renusol REN-420353 L brackets'
      ],
      // The export puts a non-breaking space after "Concrete -" in this label.
      [
        67,
        'Concrete - Renusol Roof Hook (R420150) - Landscape & screws',
        'Renusol R420150 landscape roof hooks with screws'
      ],
      [
        68,
        'K2 Curved multi rail - landscape',
        'K2 curved multi rail, landscape'
      ],
      [69, 'K2 Flat mini rail - portrait', 'K2 flat mini rail, portrait'],
      [70, 'K2 Curved mini rail - portrait', 'K2 curved mini rail, portrait'],
      [
        71,
        'Slate - Renusol Roof Hook (R420181) - Portrait & screws',
        'Renusol R420181 portrait roof hooks with screws'
      ],
      [
        72,
        'Renusol End clamps REN-420081-B',
        'Renusol REN-420081-B end clamps'
      ],
      [
        75,
        'K2 1000074 15CM Roof Hook for Flat Tiles - Portrait & Landscape',
        'K2 1000074 15cm flat tile roof hooks'
      ],
      [
        76,
        'K2 Mid Clamps 2004540 - Portrait & Landscape',
        'K2 2004540 mid clamps'
      ],
      [
        77,
        'K2 End Clamps 2004545 - Portrait & Landscape',
        'K2 2004545 end clamps'
      ],
      [78, 'K2 End Caps - Portrait & Landscape', 'K2 end caps'],
      [79, 'K2 Splice - Portrait & Landscape', 'K2 splices'],
      [80, 'K2 Rail - Portrait & Landscape', 'K2 rail']
    ] as Array<[number, string, string]>
  ).map(([index, header, description]) =>
    C({
      index,
      header,
      meaning: `Quantity of ${description}.`,
      destinationTable: 'intake',
      destinationFields: ['raw_payload_json'],
      transformation: `Integer to a materials line described "${description} (historical)", unit Each. A recorded 0 produces no line.`,
      confidence: 'Medium',
      conflictRule:
        'Never merged into an existing materials list; no live materials row is created.',
      disposition: 'IMPORT',
      notes:
        'Part number preserved in the description; no products row is created.'
    })
  ),
  C({
    index: 73,
    header: 'Total Renusol Roof Hook (R420181) -&  screws',
    meaning: 'Total R420181 hooks, i.e. columns 64 + 71 added up by the form.',
    destinationTable: null,
    destinationFields: [],
    transformation:
      'Not imported as its own line; recomputed from the landscape and portrait columns so the total is not double-counted.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'C_DUPLICATE_OF_ANOTHER_COLUMN'
  }),
  C({
    index: 74,
    header: 'Total Renusol Roof Hook (R420150) -&  screws',
    meaning: 'Total R420150 hooks, i.e. columns 65 + 67 added up by the form.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'As column 73.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'C_DUPLICATE_OF_ANOTHER_COLUMN'
  }),
  C({
    index: 81,
    header: 'Tesla Extras',
    meaning: 'Tesla-specific extras. Populated on a single row.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Free text kept as a described materials line with quantity 1, because the text states its own count.',
    confidence: 'Low',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 82,
    header: 'Tesla Extras To Order',
    meaning: 'Tesla extras still to order. Populated on 3 rows.',
    destinationTable: 'technical_details',
    destinationFields: ['ordering_notes'],
    transformation: 'Folded into the historical ordering note block.',
    confidence: 'Low',
    conflictRule: 'Existing technical_details row wins.',
    disposition: 'IMPORT'
  }),
  C({
    index: 83,
    header: 'Scaffold PDF & additional',
    meaning:
      'Scaffold scope attachment, as a link or as free-text access notes.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'URLs go to the file inventory and are NOT downloaded. Non-URL text becomes access_notes.',
    confidence: 'Medium',
    conflictRule:
      'Never touches an existing scaffold booking; no live scaffold booking is created.',
    disposition: 'IMPORT',
    notes:
      'scaffold_bookings.scope_file_id is left null until the owner decides whether to copy files into Storage.'
  }),
  C({
    index: 84,
    header: 'Email Scaffolder',
    meaning:
      'Address the scaffold booking was emailed to. A stronger scaffold-company signal than column 55, because the domain names the firm.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Domain used to corroborate the column 55 company. Typo variants are treated as the same domain only when they differ by a trailing character.',
    confidence: 'Medium',
    conflictRule:
      'Never touches an existing scaffold booking; no live scaffold booking is created.',
    disposition: 'IMPORT',
    notes:
      'tanya@simplesolarltd.co.uk on 20 rows means the office booked it, not that a scaffolder was chosen.'
  }),
  C({
    index: 85,
    header: 'Merchant Email',
    meaning: 'Merchant contact address, later form generation.',
    destinationTable: null,
    destinationFields: [],
    transformation:
      'Reconciled with columns 60 and 86 into a single merchant value.',
    confidence: 'Medium',
    conflictRule: 'Never creates or edits a company.',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'B_LEGACY_METADATA'
  }),
  C({
    index: 86,
    header: 'Merchant Name',
    meaning:
      'Merchant contact first name ("Tom", "Luke") — a person at the merchant, not the merchant itself.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Reconciled with columns 60 and 85.',
    confidence: 'Medium',
    conflictRule: 'Never creates a person or a company.',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'B_LEGACY_METADATA',
    notes:
      'These are supplier contacts, not Simple Solar staff, and must never be matched against people.'
  }),
  C({
    index: 87,
    header: '2nd Email sparky',
    meaning: 'Address the second electrician was emailed at.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload; corroborates column 88.',
    confidence: 'Medium',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'B_LEGACY_METADATA'
  }),
  C({
    index: 88,
    header: '2nd Sparky',
    meaning: 'Second electrician allocated.',
    destinationTable: 'historical_job_people',
    destinationFields: ['source_value', 'person_id', 'match_kind'],
    transformation:
      'Preserved verbatim; linked only on an unambiguous match. No allocation is created.',
    confidence: 'Medium',
    conflictRule:
      'Never creates or replaces an allocation. Recorded as a historical fact only.',
    disposition: 'IMPORT'
  }),
  C({
    index: 89,
    header: 'Scaffolding notes',
    meaning: 'Free-text scaffolding notes.',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation: 'Joined after column 83 text when both are present.',
    confidence: 'High',
    conflictRule:
      'Never touches an existing scaffold booking; no live scaffold booking is created.',
    disposition: 'IMPORT'
  }),
  C({
    index: 90,
    header: 'Amount of 455 Panels',
    meaning:
      'Originally a count of 455W panels. The column was later reused for a date: 36 of 55 populated cells hold values like "8/12/2026".',
    destinationTable: 'intake',
    destinationFields: ['raw_payload_json'],
    transformation:
      'Integers become a "455W panels (historical)" line. Date-shaped values are NOT imported and raise a warning; their meaning is an owner decision.',
    confidence: 'Low',
    conflictRule:
      'Never merged into an existing materials list; no live materials row is created.',
    disposition: 'IMPORT',
    notes: 'Changed meaning over time. See owner-decisions.md.'
  }),
  C({
    index: 91,
    header: 'Tanya Email',
    meaning: 'Office notification address. Constant on all 27 populated rows.',
    destinationTable: null,
    destinationFields: [],
    transformation: 'None.',
    confidence: 'High',
    conflictRule: 'n/a',
    disposition: 'IGNORE',
    noDestinationReason: 'D_OBSOLETE',
    notes: 'A form routing setting, not job data.'
  }),
  C({
    index: 92,
    header: 'Submission ID',
    meaning:
      'Form submission identifier. The only column populated on all 303 rows.',
    destinationTable: 'intake',
    destinationFields: ['submission_id', 'intake_id'],
    transformation:
      'Preserved exactly. Combined with an identity fingerprint only where one identifier is reused by a different customer. See identity.ts.',
    confidence: 'High',
    conflictRule:
      'A row whose (form_id, submission_id) already exists in intake is a replay and is skipped.',
    disposition: 'IMPORT',
    notes:
      'Only 287 of 303 values are distinct. All 10 duplicate groups proved to be the same job exported repeatedly, so those rows collapse to one candidate; see owner-decisions.md finding A.'
  }),
  C({
    index: 93,
    header: 'Copied to Plym Tracker',
    meaning:
      'Originally a "copied to the scaffolder tracker" flag (247 rows hold "1"). Later reused for a date (13 rows).',
    destinationTable: null,
    destinationFields: [],
    transformation: 'Kept in the intake payload only.',
    confidence: 'Low',
    conflictRule: 'n/a',
    disposition: 'PRESERVE_ONLY',
    noDestinationReason: 'E_UNKNOWN_OWNER_DECISION',
    notes:
      'Changed meaning over time. An external tracker flag has no destination in this system.'
  })
].sort((a, b) => a.index - b.index);

/**
 * Columns where the form asked the same question twice across generations.
 * Later generation wins when populated, because the office stopped filling the
 * older box once the newer one existed — verified on this export: the
 * populated counts of each pair are near-disjoint and sum to ~303.
 */
export const GENERATION_PAIRS: GenerationPair[] = [
  {
    concept: 'Customer postcode',
    primary: 61,
    fallback: 3,
    rule: 'Column 61 (177 rows) and column 3 (125 rows) are disjoint on 302 of 303 rows. Prefer 61; fall back to 3.'
  },
  {
    concept: 'Customer first name',
    primary: 62,
    fallback: 4,
    rule: 'Column 62 (177 rows) and column 4 (125 rows). Prefer 62; fall back to 4.'
  },
  {
    concept: 'Customer surname',
    primary: 63,
    fallback: 5,
    rule: 'Column 63 (177 rows) and column 5 (123 rows). Prefer 63; fall back to 5.'
  },
  {
    concept: 'Optimiser quantity',
    primary: 24,
    fallback: 30,
    rule: 'Same header label. Column 24 (254 rows) is the live question; column 30 (24 rows) is the retired one. Prefer 24.'
  }
];

/**
 * Columns that look like duplicates but ask genuinely different questions, so
 * the "newer wins" rule must not be applied to them.
 */
export const CONDITIONAL_BRANCHES = [
  {
    concept: 'Inverter',
    columns: [20, 32],
    rule: 'Column 32 is the SunPower/Powervault branch, not a newer version of column 20. Take 20 when present, else 32, and record which branch supplied the value.'
  },
  {
    concept: 'Battery',
    columns: [21, 36],
    rule: 'As above for column 36.'
  },
  {
    concept: 'Electrician',
    columns: [31, 88],
    rule: 'Column 88 is a second electrician on the same job, not a replacement for column 31. Both are allocated.'
  },
  {
    concept: 'Merchant',
    columns: [60, 85, 86],
    rule: 'Column 60 is an address, 85 an address, 86 a contact first name. Reconciled by address; 86 only labels the contact.'
  },
  {
    concept: 'Roof hook totals',
    columns: [64, 71, 73],
    rule: 'Column 73 is the sum of 64 and 71. Import the parts, never the total, or quantities double.'
  },
  {
    concept: 'Roof hook totals (R420150)',
    columns: [65, 67, 74],
    rule: 'Column 74 is the sum of 65 and 67.'
  }
];

export const EXPECTED_COLUMN_COUNT = 94;

export function columnByIndex(index: number): ColumnSpec | undefined {
  return COLUMNS.find((c) => c.index === index);
}

/** Verifies the registry describes the file that was actually loaded. */
export function verifyRegistry(header: string[]): string[] {
  const problems: string[] = [];
  if (header.length !== EXPECTED_COLUMN_COUNT) {
    problems.push(
      `expected ${EXPECTED_COLUMN_COUNT} columns, file has ${header.length}`
    );
  }
  if (COLUMNS.length !== EXPECTED_COLUMN_COUNT) {
    problems.push(
      `registry describes ${COLUMNS.length} columns, expected ${EXPECTED_COLUMN_COUNT}`
    );
  }
  header.forEach((label, index) => {
    const spec = columnByIndex(index);
    if (!spec) {
      problems.push(
        `column ${index} (${JSON.stringify(label)}) has no registry entry`
      );
      return;
    }
    if (spec.header !== label) {
      problems.push(
        `column ${index} label drift: registry ${JSON.stringify(spec.header)} vs file ${JSON.stringify(label)}`
      );
    }
  });
  return problems;
}

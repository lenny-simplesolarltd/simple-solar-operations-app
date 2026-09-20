/**
 * Row -> import candidate.
 *
 * A candidate is a proposal, never a write. It carries the values that would
 * be written, the provenance that explains where they came from, and every
 * warning raised on the way, so the dry run can be judged without opening the
 * source file.
 */

import { cell } from './csv';
import {
  parseEmail,
  parsePostcode,
  parseList,
  parseWorkDate,
  parseSubmissionTimestamp,
  parseDecimal,
  parseInteger,
  parseMoneyPence,
  parseBoolean,
  parseScaffoldCompany,
  extractUrls,
  normaliseSpace,
  looksLikeDate,
  eraForSubmission
} from './normalise';
import { COLUMNS, GENERATION_PAIRS } from './columns';
import { matchPerson, isUsablePerson, type PersonMatch } from './match';
import type { Directory } from './directory';
import type { ImportIdentity } from './identity';

/** The fixed form identity every historical row is filed under. */
export const SOURCE_FORM_ID = 'historical-job-booking-form';
export const IMPORTER_VERSION = '2.0.0';

export type Warning = {
  /** Source column index, or null for row-level findings. */
  column: number | null;
  code: string;
  message: string;
};

export type MaterialLine = {
  column: number;
  description: string;
  quantity: number;
  unit: 'Each' | 'Metre';
  trade: 'Roof' | 'Electrical';
};

export type FileRef = {
  column: number;
  /** Host only. Full URLs stay out of committed output. */
  host: string;
  status:
    | 'AVAILABLE'
    | 'BROKEN_INVALID'
    | 'UNKNOWN'
    | 'REQUIRES_AUTH'
    | 'EMPTY';
};

export type Candidate = {
  /** 1-based row number in the data section of the file. */
  rowNumber: number;

  provenance: {
    sourceSystem: 'historical-job-booking-form';
    formId: string;
    /** The Submission ID exactly as exported. */
    submissionId: string;
    /** Submission ID plus a discriminator only where one is needed. */
    importKey: string;
    /** The idempotency key stored on intake: `${formId}:${importKey}`. */
    intakeKey: string;
    /** Hash of the whole source row, so a changed re-export is detectable. */
    payloadHash: string;
    submittedAt: string | null;
    legacyReference: string | null;
    importerVersion: string;
    /** Set by the runner; constant for one execution. */
    batchId: string;
  };

  /** How this candidate's identity was resolved across the export. */
  identity: ImportIdentity | null;

  customer: {
    firstName: string | null;
    lastName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    postcode: string | null;
    email: string | null;
    phone: string | null;
    /** Which generation of the name/postcode columns supplied the value. */
    generation: 'later' | 'earlier' | 'mixed' | 'none';
  };

  job: {
    soldAt: string | null;
    grossPence: number | null;
    leadSource: string | null;
    financeRoute: 'Standard' | 'OtherReview' | null;
    roofRequired: boolean;
    electricalRequired: boolean;
    scaffoldRequired: boolean | null;
    salesperson: PersonMatch | null;
  };

  technical: {
    systemKw: number | null;
    batteryKwh: number | null;
    annualGenerationKwh: number | null;
    annualConsumptionKwh: number | null;
    mpan: string | null;
    fuseRatingAmps: number | null;
    roofType: string | null;
    g99Status: string | null;
    roofNotes: string | null;
    electricalNotes: string | null;
    orderingNotes: string | null;
  };

  equipment: Array<{
    column: number;
    equipmentType: string;
    descriptor: string;
    branch: 'standard' | 'sunpower';
  }>;

  people: {
    installers: PersonMatch[];
    electricians: PersonMatch[];
  };

  work: {
    roofDate: string | null;
    electricalDate: string | null;
  };

  scaffold: {
    required: boolean | null;
    companyName: string | null;
    erectDate: string | null;
    accessNotes: string | null;
    /** The scaffolder's email domain, when it names a firm. */
    contactDomain: string | null;
  };

  materials: MaterialLine[];

  commercial: {
    /** Informational only. No ledger row is derived from these. */
    invoiceIntentDate: string | null;
    merchantContact: string | null;
    financeAnswer: string | null;
  };

  files: FileRef[];

  /** Every column preserved verbatim, keyed by index. Becomes raw_payload_json. */
  rawPayload: Record<string, string>;

  warnings: Warning[];
};

const warn = (
  list: Warning[],
  column: number | null,
  code: string,
  message: string
) => {
  list.push({ column, code, message });
};

/** Picks the later-generation column, falling back to the earlier one. */
function generational(row: string[], primary: number, fallback: number) {
  const p = cell(row, primary);
  const f = cell(row, fallback);
  if (p !== '')
    return { value: p, from: primary, generation: 'later' as const };
  if (f !== '')
    return { value: f, from: fallback, generation: 'earlier' as const };
  return { value: '', from: null, generation: 'none' as const };
}

const QUANTITY_COLUMNS: Array<{
  column: number;
  description: string;
  unit: 'Each' | 'Metre';
  trade: 'Roof' | 'Electrical';
}> = [
  { column: 14, description: 'Roof hooks', unit: 'Each', trade: 'Roof' },
  { column: 15, description: 'Roof end clamps', unit: 'Each', trade: 'Roof' },
  { column: 16, description: 'Roof mid clamps', unit: 'Each', trade: 'Roof' },
  { column: 17, description: 'Roof end caps', unit: 'Each', trade: 'Roof' },
  { column: 18, description: 'Roof rail', unit: 'Each', trade: 'Roof' },
  { column: 19, description: 'Roof splice', unit: 'Each', trade: 'Roof' },
  { column: 25, description: 'Bird netting', unit: 'Metre', trade: 'Roof' },
  { column: 52, description: 'Genius flashing', unit: 'Each', trade: 'Roof' },
  {
    column: 64,
    description: 'Renusol R420181 landscape roof hooks with screws',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 65,
    description: 'Renusol R420150 portrait roof hooks with screws',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 66,
    description: 'Renusol REN-420353 L brackets',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 67,
    description: 'Renusol R420150 landscape roof hooks with screws',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 68,
    description: 'K2 curved multi rail, landscape',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 69,
    description: 'K2 flat mini rail, portrait',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 70,
    description: 'K2 curved mini rail, portrait',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 71,
    description: 'Renusol R420181 portrait roof hooks with screws',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 72,
    description: 'Renusol REN-420081-B end clamps',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 75,
    description: 'K2 1000074 15cm flat tile roof hooks',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 76,
    description: 'K2 2004540 mid clamps',
    unit: 'Each',
    trade: 'Roof'
  },
  {
    column: 77,
    description: 'K2 2004545 end clamps',
    unit: 'Each',
    trade: 'Roof'
  },
  { column: 78, description: 'K2 end caps', unit: 'Each', trade: 'Roof' },
  { column: 79, description: 'K2 splices', unit: 'Each', trade: 'Roof' },
  { column: 80, description: 'K2 rail', unit: 'Each', trade: 'Roof' }
];

export function transformRow(
  row: string[],
  rowNumber: number,
  directory: Directory,
  batchId: string,
  identity: ImportIdentity | null = null
): Candidate {
  const warnings: Warning[] = [];

  // --- Provenance ------------------------------------------------------------
  const submissionId = cell(row, 92);
  const submittedRaw = cell(row, 41);
  const submitted = parseSubmissionTimestamp(submittedRaw);
  if (!submitted.ok && submittedRaw !== '') {
    warn(
      warnings,
      41,
      'BAD_SUBMISSION_DATE',
      `submission date not parseable: ${submitted.reason}`
    );
  }
  if (submittedRaw === '') {
    warn(
      warnings,
      41,
      'MISSING_SUBMISSION_DATE',
      'no submission date; jobs.sold_at cannot be set'
    );
  }

  const legacyReference = cell(row, 0) || null;

  // --- Customer --------------------------------------------------------------
  const first = generational(row, 62, 4);
  const last = generational(row, 63, 5);
  const post = generational(row, 61, 3);

  const generations = new Set([
    first.generation,
    last.generation,
    post.generation
  ]);
  generations.delete('none');
  const generation =
    generations.size === 0
      ? 'none'
      : generations.size > 1
        ? 'mixed'
        : Array.from(generations)[0];
  if (generation === 'mixed') {
    warn(
      warnings,
      null,
      'MIXED_NAME_GENERATION',
      'customer name and postcode came from different form generations; check the row is not two records merged'
    );
  }

  const postcode = post.value === '' ? null : parsePostcode(post.value);
  if (postcode && !postcode.ok) {
    warn(
      warnings,
      post.from,
      'BAD_POSTCODE',
      `postcode "${postcode.raw}" ${postcode.reason}; customers.postcode would reject it`
    );
  }

  const emailRaw = cell(row, 6);
  const email = emailRaw === '' ? null : parseEmail(emailRaw);
  if (email && !email.ok) {
    warn(warnings, 6, 'BAD_EMAIL', `customer email ${email.reason}`);
  }

  const street = cell(row, 1);
  const streetLines = street
    .split(/\r?\n/)
    .map(normaliseSpace)
    .filter((s) => s !== '');

  const customer: Candidate['customer'] = {
    firstName: first.value || null,
    lastName: last.value || null,
    addressLine1: streetLines[0] ?? null,
    addressLine2:
      streetLines.length > 1 ? streetLines.slice(1).join(', ') : null,
    town: cell(row, 2) || null,
    postcode: postcode && postcode.ok ? postcode.value : null,
    email: email && email.ok ? email.value : null,
    phone: cell(row, 37) || null,
    generation
  };

  // --- Job -------------------------------------------------------------------
  const costRaw = cell(row, 28);
  const cost = costRaw === '' ? null : parseMoneyPence(costRaw);
  if (cost && !cost.ok) {
    warn(
      warnings,
      28,
      'BAD_COST',
      `cost of job ${cost.reason}; jobs.original_gross_pence requires a positive amount`
    );
  }

  const salesmanRaw = cell(row, 47);
  const salesperson =
    salesmanRaw === '' ? null : matchPerson(salesmanRaw, directory.people);
  if (salesperson && !isUsablePerson(salesperson)) {
    warn(
      warnings,
      47,
      'SALESPERSON_UNRESOLVED',
      `salesperson "${salesmanRaw}" is ${salesperson.kind}: ${salesperson.reason}`
    );
  }
  if (salesmanRaw === '') {
    warn(
      warnings,
      47,
      'MISSING_SALESPERSON',
      'no salesperson recorded; jobs.salesperson_id is NOT NULL'
    );
  }

  const financeRaw = cell(row, 56);
  const finance = financeRaw === '' ? null : parseBoolean(financeRaw);
  let financeRoute: 'Standard' | 'OtherReview' | null = null;
  if (finance && finance.ok) {
    // "No" is a real route decision: the sale was not financed, which is
    // exactly what 'Standard' means.
    //
    // "Yes" is NOT mapped to a route. finance_route is not a label: both
    // app.evaluate_ready_to_book and app.process_booking_gates branch on
    // `finance_route = 'Standard'` to decide whether deposit evidence is
    // required, so writing 'Phoenix' or 'OtherReview' onto history would
    // assert a route decision the form never recorded. It stays null - the
    // truthful "not recorded" - and the original answer survives in the
    // intake payload.
    financeRoute = finance.value ? null : 'Standard';
    if (finance.value) {
      warn(
        warnings,
        56,
        'FINANCE_USED_ROUTE_UNKNOWN',
        'the sale used finance but the form never recorded which route; finance_route is left unknown rather than invented'
      );
    }
  } else if (finance && !finance.ok) {
    warn(
      warnings,
      56,
      'BAD_FINANCE_ANSWER',
      `finance answer "${finance.raw}" is not yes/no`
    );
  }

  // The work-date columns changed from month-first to day-first part-way
  // through the form's life; the row's own submission date fixes which.
  const era = eraForSubmission(submitted.ok ? submitted.value : null);

  const workDate = (index: number, label: string) => {
    const raw = cell(row, index);
    if (raw === '') return null;
    const parsed = parseWorkDate(raw, era);
    if (!parsed.ok) {
      warn(warnings, index, 'BAD_DATE', `${label} "${raw}": ${parsed.reason}`);
      return null;
    }
    if (parsed.value.contradictsEra) {
      warn(
        warnings,
        index,
        'DATE_ERA_CONTRADICTION',
        `${label} "${raw}" can only be read against the opposite convention to the rest of its era; read as ${parsed.value.iso}`
      );
    }
    return parsed.value.iso;
  };

  const roofDateIso = workDate(10, 'roofing date');
  const elecDateIso = workDate(11, 'electrical date');

  // --- Scaffold --------------------------------------------------------------
  const scaffoldCompany = parseScaffoldCompany(cell(row, 55));
  const scaffoldDateRaw = cell(row, 12);
  const scaffoldDateIso = workDate(12, 'scaffold date');
  if (scaffoldCompany.kind === 'undecided') {
    warn(
      warnings,
      55,
      'SCAFFOLD_COMPANY_TBC',
      'scaffold company was never decided on this row; no company is proposed'
    );
  }

  const scaffolderEmail = cell(row, 84);
  const domainMatch = /@([^\s@]+)$/.exec(scaffolderEmail.toLowerCase());
  const contactDomain = domainMatch ? domainMatch[1] : null;

  const scaffoldNotesParts = [cell(row, 83), cell(row, 89)]
    .map((t) => t.replace(/https?:\/\/\S+/gi, '').trim())
    .filter((t) => t !== '');

  const scaffoldRequired =
    scaffoldCompany.kind === 'not-required'
      ? false
      : scaffoldCompany.kind === 'company' || scaffoldDateRaw !== ''
        ? true
        : null;

  // --- Materials -------------------------------------------------------------
  const materials: MaterialLine[] = [];
  for (const q of QUANTITY_COLUMNS) {
    const raw = cell(row, q.column);
    if (raw === '') continue;
    const parsed = q.unit === 'Metre' ? parseDecimal(raw) : parseInteger(raw);
    if (!parsed.ok) {
      warn(
        warnings,
        q.column,
        'BAD_QUANTITY',
        `${q.description} quantity "${raw}" ${parsed.reason}; preserved as text, not imported`
      );
      continue;
    }
    if (parsed.value === 0) continue; // an explicit "none required"
    materials.push({
      ...q,
      description: `${q.description} (historical)`,
      quantity: parsed.value
    });
  }

  // Optimisers: later generation wins over the retired duplicate header.
  const optimiser = generational(row, 24, 30);
  if (optimiser.value !== '') {
    const parsed = parseInteger(optimiser.value);
    if (parsed.ok && parsed.value > 0) {
      materials.push({
        column: optimiser.from as number,
        description: 'Optimisers (historical)',
        quantity: parsed.value,
        unit: 'Each',
        trade: 'Roof'
      });
    } else if (!parsed.ok) {
      warn(
        warnings,
        optimiser.from,
        'BAD_QUANTITY',
        `optimiser count "${optimiser.value}" ${parsed.reason}`
      );
    }
  }

  // Column 90 was repurposed from a panel count to a date part-way through.
  const panel455 = cell(row, 90);
  if (panel455 !== '') {
    if (looksLikeDate(panel455)) {
      warn(
        warnings,
        90,
        'REPURPOSED_COLUMN',
        'column 90 holds a date, not a panel count; not imported pending an owner decision'
      );
    } else {
      const parsed = parseInteger(panel455);
      if (parsed.ok && parsed.value > 0) {
        materials.push({
          column: 90,
          description: '455W panels (historical)',
          quantity: parsed.value,
          unit: 'Each',
          trade: 'Roof'
        });
      } else if (!parsed.ok) {
        warn(
          warnings,
          90,
          'BAD_QUANTITY',
          `455W panel count "${panel455}" ${parsed.reason}`
        );
      }
    }
  }

  const teslaExtras = cell(row, 81);
  if (teslaExtras !== '') {
    materials.push({
      column: 81,
      description: `${normaliseSpace(teslaExtras)} (historical)`,
      quantity: 1,
      unit: 'Each',
      trade: 'Electrical'
    });
  }

  // The form's own "Total ..." columns are the sum of two part columns; if the
  // parts disagree with the total, the parts are authoritative and the
  // discrepancy is reported rather than reconciled.
  for (const [total, a, b] of [
    [73, 64, 71],
    [74, 65, 67]
  ] as const) {
    const t = parseInteger(cell(row, total));
    if (!t.ok) continue;
    const pa = parseInteger(cell(row, a));
    const pb = parseInteger(cell(row, b));
    const sum = (pa.ok ? pa.value : 0) + (pb.ok ? pb.value : 0);
    if (sum !== t.value) {
      warn(
        warnings,
        total,
        'TOTAL_DISAGREES',
        `form total ${t.value} does not equal columns ${a} + ${b} = ${sum}; the parts are imported`
      );
    }
  }

  // --- Equipment -------------------------------------------------------------
  const equipment: Candidate['equipment'] = [];
  const inverter = cell(row, 20) || cell(row, 32);
  if (inverter !== '') {
    equipment.push({
      column: cell(row, 20) !== '' ? 20 : 32,
      equipmentType: 'Inverter',
      descriptor: normaliseSpace(inverter),
      branch: cell(row, 20) !== '' ? 'standard' : 'sunpower'
    });
  }
  const battery = cell(row, 21) || cell(row, 36);
  if (battery !== '') {
    equipment.push({
      column: cell(row, 21) !== '' ? 21 : 36,
      equipmentType: 'Battery',
      descriptor: normaliseSpace(battery),
      branch: cell(row, 21) !== '' ? 'standard' : 'sunpower'
    });
  }

  // --- Technical -------------------------------------------------------------
  const num = (index: number, code: string) => {
    const raw = cell(row, index);
    if (raw === '') return null;
    const parsed = parseDecimal(raw);
    if (!parsed.ok) {
      warn(warnings, index, code, `"${raw}" ${parsed.reason}`);
      return null;
    }
    return parsed.value;
  };

  const fuseRaw = cell(row, 34);
  let fuse: number | null = null;
  if (fuseRaw !== '') {
    const parsed = parseInteger(fuseRaw);
    if (parsed.ok && parsed.value > 0) fuse = parsed.value;
    else {
      warn(
        warnings,
        34,
        'BAD_FUSE_RATING',
        `fuse rating "${fuseRaw}" is not a positive integer; technical_details.fuse_rating_amps would reject it`
      );
    }
  }

  const electricalExtras = [
    ...parseList(cell(row, 22)),
    cell(row, 53) === '1' ? 'Canopy' : '',
    cell(row, 54) === '1' ? 'Off-grid backup' : ''
  ].filter((s) => s !== '');

  const roofNoteParts = [cell(row, 43)];
  const panel = cell(row, 59);
  if (panel !== '') roofNoteParts.push(`Panel (historical): ${panel}`);

  const electricalNoteParts = [cell(row, 44)];
  if (electricalExtras.length > 0) {
    electricalNoteParts.push(
      `Electrical extras: ${electricalExtras.join(', ')}`
    );
  }

  const orderingNoteParts = [cell(row, 35), cell(row, 45), cell(row, 82)];

  const join = (parts: string[]) => {
    const kept = parts.map((p) => p.trim()).filter((p) => p !== '');
    return kept.length > 0 ? kept.join('\n\n') : null;
  };

  // --- People ----------------------------------------------------------------
  const installers = parseList(cell(row, 7)).map((v) =>
    matchPerson(v, directory.people)
  );
  installers.forEach((m) => {
    if (!isUsablePerson(m)) {
      warn(
        warnings,
        7,
        'INSTALLER_UNRESOLVED',
        `installer "${m.raw}" is ${m.kind}: ${m.reason}`
      );
    }
  });

  const electricians = [
    ...parseList(cell(row, 31)),
    ...parseList(cell(row, 88))
  ].map((v) => matchPerson(v, directory.people));
  electricians.forEach((m) => {
    if (!isUsablePerson(m)) {
      warn(
        warnings,
        31,
        'ELECTRICIAN_UNRESOLVED',
        `electrician "${m.raw}" is ${m.kind}: ${m.reason}`
      );
    }
  });

  // --- Files -----------------------------------------------------------------
  const files: FileRef[] = [];
  for (const index of [83]) {
    const raw = cell(row, index);
    if (raw === '') continue;
    const urls = extractUrls(raw);
    for (const url of urls) {
      let host = 'unparseable';
      let status: FileRef['status'] = 'UNKNOWN';
      try {
        host = new URL(url).host;
        // Nothing is fetched in this task, so availability is genuinely unknown.
        // A signed URL is recorded as requiring auth without echoing the token.
        status = /[?&](x-amz-|token=|signature=|sig=)/i.test(url)
          ? 'REQUIRES_AUTH'
          : 'UNKNOWN';
      } catch {
        status = 'BROKEN_INVALID';
      }
      files.push({ column: index, host, status });
    }
  }

  // Column 58 never changed over: it is month-first for its whole life.
  const invoiceIntentRaw = cell(row, 58);
  let invoiceIntentIso: string | null = null;
  if (invoiceIntentRaw !== '') {
    const parsed = parseWorkDate(invoiceIntentRaw, 'month-first');
    if (parsed.ok) invoiceIntentIso = parsed.value.iso;
    else
      warn(
        warnings,
        58,
        'BAD_DATE',
        `invoice intent date "${invoiceIntentRaw}": ${parsed.reason}`
      );
  }

  // --- Raw payload -----------------------------------------------------------
  // Every column, including the ignored ones: the intake row is what makes
  // "where did this come from?" answerable after the fact.
  const rawPayload: Record<string, string> = {};
  COLUMNS.forEach((spec) => {
    const value = cell(row, spec.index);
    if (value !== '') rawPayload[String(spec.index)] = value;
  });

  return {
    rowNumber,
    identity,
    provenance: {
      sourceSystem: 'historical-job-booking-form',
      formId: SOURCE_FORM_ID,
      submissionId,
      importKey: identity ? identity.importKey : submissionId,
      payloadHash: identity ? identity.payloadHash : '',
      intakeKey: `${SOURCE_FORM_ID}:${identity ? identity.importKey : submissionId}`,
      submittedAt: submitted.ok ? submitted.value : null,
      legacyReference,
      importerVersion: IMPORTER_VERSION,
      batchId
    },
    customer,
    job: {
      soldAt: submitted.ok ? submitted.value : null,
      grossPence: cost && cost.ok ? cost.value : null,
      leadSource: cell(row, 48) || null,
      financeRoute,
      roofRequired: roofDateIso !== null,
      electricalRequired: elecDateIso !== null,
      scaffoldRequired,
      salesperson
    },
    technical: {
      systemKw: num(38, 'BAD_SYSTEM_KW'),
      batteryKwh: num(39, 'BAD_BATTERY_KWH'),
      annualGenerationKwh: num(26, 'BAD_GENERATION'),
      annualConsumptionKwh: num(27, 'BAD_CONSUMPTION'),
      mpan: cell(row, 40) || null,
      fuseRatingAmps: fuse,
      roofType: cell(row, 13) || null,
      g99Status: cell(row, 46) !== '' ? 'HistoricalG99Flagged' : null,
      roofNotes: join(roofNoteParts),
      electricalNotes: join(electricalNoteParts),
      orderingNotes: join(orderingNoteParts)
    },
    equipment,
    people: { installers, electricians },
    work: {
      roofDate: roofDateIso,
      electricalDate: elecDateIso
    },
    scaffold: {
      required: scaffoldRequired,
      companyName:
        scaffoldCompany.kind === 'company' ? scaffoldCompany.name : null,
      erectDate: scaffoldDateIso,
      accessNotes:
        scaffoldNotesParts.length > 0 ? scaffoldNotesParts.join('\n\n') : null,
      contactDomain
    },
    materials,
    commercial: {
      invoiceIntentDate: invoiceIntentIso,
      merchantContact: cell(row, 85) || cell(row, 60) || null,
      financeAnswer: financeRaw || null
    },
    files,
    rawPayload,
    warnings
  };
}

export { GENERATION_PAIRS };

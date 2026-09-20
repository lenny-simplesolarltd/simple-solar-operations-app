// Customer document generation - the shared vocabulary.
//
// The rule that shapes every type here: a generated PDF must be deterministic
// from a STORED SNAPSHOT. Nothing in the render path may read the job, the
// presale, the catalogue or today's settings. `DocumentInput` is that snapshot
// - plain JSON, every value already resolved and formatted - and the renderer
// takes nothing else. Re-rendering revision 1 in a year's time, after the
// catalogue and the price of electricity have both moved, produces the same
// bytes.

export const DOCUMENT_TYPES = ['QuotationContract', 'ROI'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  QuotationContract: 'Quotation & Contract',
  ROI: 'ROI Report'
};

/**
 * Pending   - requested, not yet picked up
 * Preparing - resolving variables against canonical data
 * Rendering - drawing the PDF
 * Generated - stored, immutable, downloadable
 * Failed    - stopped with a named reason; retryable
 * Superseded- a later revision replaced it. The file is KEPT.
 */
export const REVISION_STATUSES = [
  'Pending',
  'Preparing',
  'Rendering',
  'Generated',
  'Failed',
  'Superseded'
] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RevisionStatus[] = [
  'Generated',
  'Failed',
  'Superseded'
];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Every variable resolves to a value or an explicit absence. There is no third
 * state and no empty-string fallback: a blank where a number should be is how
 * a document quietly tells a customer something untrue.
 */
export type Resolved =
  | { state: 'value'; text: string }
  | { state: 'missing'; reason: string };

export const value = (text: string): Resolved => ({ state: 'value', text });
export const missing = (reason: string): Resolved => ({
  state: 'missing',
  reason
});

/** A required variable that did not resolve. Blocks generation. */
export interface UnresolvedVariable {
  /** Registry id, e.g. `customer.full_name`. */
  variable: string;
  /** Why it could not be produced, in words a person can act on. */
  reason: string;
  /** Pages of this document that needed it. */
  pages: number[];
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/**
 * The frozen input to a render. Values are pre-formatted strings because
 * formatting is part of what was shown to the customer: "£12,345.00" is the
 * fact, not 1234500 plus today's formatter.
 *
 * `variables` is flat and keyed by registry id so the map, the renderer, the
 * tests and the "generation details" UI all read the same thing.
 */
export interface DocumentInput {
  /** Bumped when the snapshot's own shape changes. */
  snapshotVersion: number;
  documentType: DocumentType;
  templateId: string;
  templateVersion: string;
  masterSha256: string;
  /** Resolved registry values, id -> formatted text. */
  variables: Record<string, string>;
  /** The ROI projection rows, empty for the quotation. */
  projection: ProjectionRow[];
  /** Provenance - enough to prove what produced this, never used to render. */
  provenance: {
    jobId: string;
    jobReference: string;
    presaleId: string;
    presaleSubmittedAt: string;
    designSchemaVersion: number;
    catalogueVersion: string;
    /** The inflation rate this revision was generated with (see settings). */
    electricityInflationPct: number;
    generatedAt: string;
    generatedByPersonId: string | null;
  };
}

/** One row of the ROI 30-year projection. Years 1-15, 20, 25, 30. */
export interface ProjectionRow {
  /** Row ordinal as the master indexes it: 1..15, then 16, 17, 18. */
  n: number;
  year: number;
  /** Electricity unit price that year, pence per kWh. */
  pencePerKwh: number;
  billNoSolarMonthly: number;
  billNoSolarAnnual: number;
  billWithSolarMonthly: number;
  billWithSolarAnnual: number;
  /** Saving in that year alone. */
  savingAnnual: number;
  /** Cumulative saving to the end of that year. */
  savingCumulative: number;
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

export const GENERATION_ERRORS = {
  INCOMPLETE_DESIGN: 'INCOMPLETE_DESIGN',
  MISSING_CONSUMPTION: 'MISSING_CONSUMPTION',
  MISSING_GENERATION_FORECAST: 'MISSING_GENERATION_FORECAST',
  UNRESOLVED_VARIABLE: 'UNRESOLVED_VARIABLE',
  HISTORICAL_IMPORT: 'HISTORICAL_IMPORT',
  MASTER_CHANGED: 'MASTER_CHANGED',
  REGION_OVERFLOW: 'REGION_OVERFLOW',
  RENDER_FAILED: 'RENDER_FAILED'
} as const;
export type GenerationErrorCode =
  (typeof GENERATION_ERRORS)[keyof typeof GENERATION_ERRORS];

/** What the UI shows when a generation stops. Always actionable. */
export interface GenerationFailure {
  code: GenerationErrorCode;
  /** One line, addressed to an office user, e.g. "Missing annual generation forecast". */
  message: string;
  unresolved?: UnresolvedVariable[];
}

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly unresolved: UnresolvedVariable[];

  constructor(
    code: GenerationErrorCode,
    message: string,
    unresolved: UnresolvedVariable[] = []
  ) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    this.unresolved = unresolved;
  }

  toFailure(): GenerationFailure {
    return {
      code: this.code,
      message: this.message,
      ...(this.unresolved.length ? { unresolved: this.unresolved } : {})
    };
  }
}

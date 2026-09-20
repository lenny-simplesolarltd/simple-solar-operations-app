/**
 * Generates the analysis documents that are derived from data, so they cannot
 * drift from the registry or from the dry run.
 *
 *   npm run import:historical-bookings:docs
 *
 * Writes column-mapping.md and people-matches.md. owner-decisions.md and
 * README.md are written by hand: they hold judgement, not derived facts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { COLUMNS, GENERATION_PAIRS, CONDITIONAL_BRANCHES } from './columns';

const ROOT = process.cwd();
const ANALYSIS = path.join(
  ROOT,
  'data-import/historical-job-bookings/analysis'
);
const REPORT = path.join(ANALYSIS, 'dry-run-report.json');

type Report = {
  generatedAt: string;
  source: { rows: number; columns: number };
  columns: Array<{
    index: number;
    populated: number;
    blank: number;
    distinct: number;
    inferredType: string;
    examples: string[];
    anomalies: string[];
  }>;
  summary: {
    people: {
      distinctValues: number;
      values: Array<{
        value: string;
        kind: string;
        candidates: string[];
        rows: number;
      }>;
    };
  };
};

const DISPOSITION_LABEL: Record<string, string> = {
  IMPORT: 'IMPORT',
  PRESERVE_ONLY: 'PRESERVE ONLY',
  IGNORE: 'IGNORE'
};

const REASON_LABEL: Record<string, string> = {
  A_NEW_STRUCTURED_FIELD_MAY_BE_NEEDED:
    'A — new structured field may be needed',
  B_LEGACY_METADATA: 'B — legacy metadata / provenance',
  C_DUPLICATE_OF_ANOTHER_COLUMN: 'C — duplicate of another column',
  D_OBSOLETE: 'D — obsolete',
  E_UNKNOWN_OWNER_DECISION: 'E — unknown, owner decision required'
};

function columnMapping(report: Report): string {
  const stats = new Map(report.columns.map((c) => [c.index, c]));
  const counts = {
    IMPORT: COLUMNS.filter((c) => c.disposition === 'IMPORT').length,
    PRESERVE_ONLY: COLUMNS.filter((c) => c.disposition === 'PRESERVE_ONLY')
      .length,
    IGNORE: COLUMNS.filter((c) => c.disposition === 'IGNORE').length
  };

  const lines: string[] = [];
  lines.push('# Column mapping — historical Job Booking export');
  lines.push('');
  lines.push(
    'Generated from the column registry and the dry run. Do not edit by hand:'
  );
  lines.push('run `npm run import:historical-bookings:docs` instead.');
  lines.push('');
  lines.push(
    `Source: ${report.source.rows} rows, ${report.source.columns} columns.`
  );
  lines.push('');
  lines.push(
    'Examples are redacted. Customer name, address, postcode, email, phone and'
  );
  lines.push('MPAN columns show a masked value or a character shape only.');
  lines.push('');
  lines.push('| Disposition | Columns |');
  lines.push('| --- | --- |');
  lines.push(`| IMPORT — becomes a typed value | ${counts.IMPORT} |`);
  lines.push(
    `| PRESERVE ONLY — kept in \`intake.raw_payload_json\` | ${counts.PRESERVE_ONLY} |`
  );
  lines.push(`| IGNORE — carries no information | ${counts.IGNORE} |`);
  lines.push(`| **Total** | **${COLUMNS.length}** |`);
  lines.push('');
  lines.push(
    'Every column has an entry, and every column that is not imported carries a'
  );
  lines.push(
    'reason, so nothing disappears silently. Even ignored columns are kept in the'
  );
  lines.push(
    'intake payload, so the original submission is always recoverable.'
  );
  lines.push('');

  lines.push('## Reconciliation rules');
  lines.push('');
  lines.push('### Form generations — the later question wins');
  lines.push('');
  lines.push('| Concept | Preferred | Fallback | Rule |');
  lines.push('| --- | --- | --- | --- |');
  for (const p of GENERATION_PAIRS) {
    lines.push(
      `| ${p.concept} | col ${p.primary} | col ${p.fallback} | ${p.rule} |`
    );
  }
  lines.push('');
  lines.push('### Look-alikes that are NOT generations');
  lines.push('');
  lines.push(
    'The "newer wins" rule must not be applied to these; they ask different'
  );
  lines.push('questions or are conditional branches of the form.');
  lines.push('');
  lines.push('| Concept | Columns | Rule |');
  lines.push('| --- | --- | --- |');
  for (const b of CONDITIONAL_BRANCHES) {
    lines.push(`| ${b.concept} | ${b.columns.join(', ')} | ${b.rule} |`);
  }
  lines.push('');
  lines.push('### Dates');
  lines.push('');
  lines.push(
    '`Date Roofer`, `Date Sparky` and `Date Scaffolding` are not one format. The'
  );
  lines.push(
    'export changes from month-first to day-first at submission date **2025-08-21**,'
  );
  lines.push(
    'with no overlap: every cell whose first component exceeds 12 sits on or after'
  );
  lines.push(
    'that date, and every cell whose second component exceeds 12 sits before it.'
  );
  lines.push(
    "The era is therefore taken from the row's own submission date rather than"
  );
  lines.push(
    'guessed per value. A cell that is only valid under the opposite convention is'
  );
  lines.push(
    'read that way and flagged. A cell that is valid both ways on a row with no'
  );
  lines.push('usable submission date is refused.');
  lines.push('');
  lines.push(
    '`Date for invoice` (column 58) did not change over and is month-first'
  );
  lines.push(
    'throughout. `Submission Date` has three generations, all unambiguous.'
  );
  lines.push('');

  lines.push('## Columns');
  lines.push('');

  for (const spec of COLUMNS) {
    const s = stats.get(spec.index);
    lines.push(`### ${spec.index}. \`${spec.header.replace(/\u00a0/g, '·')}\``);
    lines.push('');
    lines.push(`**Meaning.** ${spec.meaning}`);
    lines.push('');
    if (s) {
      lines.push(
        `**Data quality.** ${s.populated} populated, ${s.blank} blank, ` +
          `${s.distinct} distinct. Inferred type: ${s.inferredType}.`
      );
      if (s.examples.length > 0) {
        lines.push(
          `Examples (redacted): ${s.examples.map((e) => `\`${e.replace(/\n/g, '\\n')}\``).join(', ')}.`
        );
      }
      if (s.anomalies.length > 0) {
        lines.push('');
        lines.push(`**Anomalies.** ${s.anomalies.join('; ')}.`);
      }
      lines.push('');
    }
    lines.push(
      `**Destination.** ${
        spec.destinationTable
          ? `\`${spec.destinationTable}\` — ${spec.destinationFields.map((f) => `\`${f}\``).join(', ')}`
          : 'none'
      }`
    );
    lines.push('');
    lines.push(`**Transformation.** ${spec.transformation}`);
    lines.push('');
    lines.push(`**Conflict rule.** ${spec.conflictRule}`);
    lines.push('');
    lines.push(
      `**Disposition.** ${DISPOSITION_LABEL[spec.disposition]}` +
        (spec.noDestinationReason
          ? ` — ${REASON_LABEL[spec.noDestinationReason]}`
          : '') +
        ` · confidence ${spec.confidence}`
    );
    if (spec.notes) {
      lines.push('');
      lines.push(`**Notes.** ${spec.notes}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function peopleMatches(report: Report): string {
  const values = report.summary.people.values;
  const group = (kind: string) => values.filter((v) => v.kind === kind);

  const lines: string[] = [];
  lines.push('# People matching — historical Job Booking export');
  lines.push('');
  lines.push('Generated from the dry run. Do not edit by hand.');
  lines.push('');
  lines.push(
    'Historical staff values come from `Installers` (col 7), `Sparky` (col 31),'
  );
  lines.push(
    '`2nd Sparky` (col 88) and `Salesman` (col 47). They are matched against'
  );
  lines.push(
    '`public.people` on trimmed, case-folded, whitespace-normalised names.'
  );
  lines.push('');
  lines.push(
    'The matcher fails closed. A value that could mean two people is never'
  );
  lines.push(
    'resolved by picking one, and no `people` row is ever created automatically.'
  );
  lines.push('');
  lines.push(
    'Merchant contacts (`Merchant Name`, `Merchant Email`) and scaffolder'
  );
  lines.push(
    'addresses are supplier contacts, not staff, and are excluded from matching.'
  );
  lines.push(
    'The shared `info@` mailbox is excluded: it is not an actor in this system.'
  );
  lines.push('');
  lines.push(
    `**${report.summary.people.distinctValues} distinct staff values.**`
  );
  lines.push('');
  lines.push('| Classification | Distinct values | Rows affected |');
  lines.push('| --- | --- | --- |');
  for (const [kind, label] of [
    ['EXACT_MATCH', 'EXACT MATCH'],
    ['SAFE_NORMALISED_MATCH', 'SAFE NORMALISED MATCH'],
    ['AMBIGUOUS', 'AMBIGUOUS'],
    ['NO_MATCH', 'NO MATCH'],
    ['NON_PERSON_VALUE', 'NON-PERSON VALUE']
  ] as const) {
    const g = group(kind);
    lines.push(
      `| ${label} | ${g.length} | ${g.reduce((n, v) => n + v.rows, 0)} |`
    );
  }
  lines.push('');

  const section = (kind: string, title: string, blurb: string) => {
    const g = group(kind);
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(blurb);
    lines.push('');
    if (g.length === 0) {
      lines.push('_None._');
      lines.push('');
      return;
    }
    lines.push('| Value | Rows | Resolves to |');
    lines.push('| --- | --- | --- |');
    for (const v of g) {
      lines.push(
        `| \`${v.value}\` | ${v.rows} | ${v.candidates.length > 0 ? v.candidates.join(' **or** ') : '—'} |`
      );
    }
    lines.push('');
  };

  section(
    'EXACT_MATCH',
    'Exact match',
    "The value equals a person's full display name or email address."
  );
  section(
    'SAFE_NORMALISED_MATCH',
    'Safe normalised match',
    'The value is a first name held by exactly one active person. Safe to use.'
  );
  section(
    'AMBIGUOUS',
    'Ambiguous — owner decision required',
    'More than one active person could be meant, or the value matches only as a surname. These are never resolved automatically.'
  );
  section(
    'NO_MATCH',
    'No match — owner decision required',
    'No active person carries this name. These may be former staff, subcontractors, or aliases. No `people` row is created automatically.'
  );
  section(
    'NON_PERSON_VALUE',
    'Non-person values',
    'Placeholders written into a staff box.'
  );

  lines.push('## Effect on the import');
  lines.push('');
  lines.push(
    '`jobs.salesperson_id` is `NOT NULL`, so an unresolved salesperson blocks the'
  );
  lines.push(
    'whole row. An unresolved installer or electrician does not block the job — it'
  );
  lines.push('blocks only that allocation, and the row goes to owner review.');
  lines.push('');
  lines.push(
    'See `owner-decisions.md`, decision 4, for the questions this raises.'
  );

  return `${lines.join('\n')}\n`;
}

function main() {
  const report = JSON.parse(readFileSync(REPORT, 'utf8')) as Report;
  mkdirSync(ANALYSIS, { recursive: true });
  writeFileSync(
    path.join(ANALYSIS, 'column-mapping.md'),
    columnMapping(report)
  );
  writeFileSync(
    path.join(ANALYSIS, 'people-matches.md'),
    peopleMatches(report)
  );
  console.log(
    'wrote analysis/column-mapping.md and analysis/people-matches.md'
  );
}

main();

import 'server-only';

import { getJobDetail } from '@/features/jobs/server/queries';
import {
  getQuoteVersions,
  type QuoteVersion
} from '@/features/presale/server/versions';
import { z } from 'zod';
import type { ReadTool, ToolResult } from '../registry';
import { money, resolveJobReference } from './resolve-job';

/**
 * Reading a job's quote.
 *
 * A presale is append-only (migration 20260920300000): a job's quote is a
 * history of immutable versions, and exactly one of them is current. These two
 * tools are the read half of that - what the customer is on now, and what
 * changed between two versions - and they read the SAME PRESALE_VERSIONS model
 * the presale screen reads, so a figure SimpleBot quotes and a figure the
 * screen shows cannot disagree.
 *
 * What they deliberately do not show is the designer state. `presales.design`
 * is the wizard's own working document, not a description of the system in
 * words, and a model paraphrasing it would be inventing a specification. The
 * facts that WERE agreed - kWp, panel count, the price and its breakdown, the
 * roof and electrical notes - are all here; anything finer belongs on the
 * presale screen, and the tools say so.
 */

const ENFORCED =
  'app.read_presale_versions via public.execute_operations_read (job visibility is the database’s) + RLS on public.presales';

/**
 * PRESALE_VERSIONS is gated by role in app.read_registry, and there is no
 * permission code that stands in for it - this application has job.read.all
 * and job.read.own, never a plain `job.read`. Naming the roles keeps the
 * coarse pre-check honest; the read re-decides it whatever this says.
 */
const QUOTE_ROLES = [
  'Admin',
  'Manager',
  'Director',
  'Office',
  'Surveyor',
  'Finance'
] as const;

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, or a customer name that identifies one job'
  );

const versionInput = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .describe(
    'A quote version: its label as get_quote_versions reports it ("Quote 2", "Quote 2c"), its number ("2"), or its presale id'
  );

type Loaded =
  | { ok: true; jobRef: string; versions: QuoteVersion[] }
  | { ok: false; result: ToolResult };

/**
 * The job's quote history, or the reason there isn't one. A historical import
 * is refused by name: it has no presale of record, and "no quote found" would
 * read like a missing document rather than a record that never had one.
 */
async function loadVersions(job: string): Promise<Loaded> {
  const resolved = await resolveJobReference(job);
  if (!resolved.ok) return { ok: false, result: resolved.result };

  const detail = await getJobDetail(resolved.jobId);
  if (!detail) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'NOT_FOUND',
        message: 'No job with that id is visible to the signed-in staff member.'
      }
    };
  }
  const jobRef = detail.job.job_ref ?? resolved.jobRef ?? 'this job';
  if (detail.job.record_class === 'HistoricalImport') {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'HISTORICAL_IMPORT',
        message: `${jobRef} is an imported historical record from the previous system. It has no presale of record, so there is no quote to read. Whatever price the archive holds is on the job itself, not on a quote.`
      }
    };
  }

  const read = await getQuoteVersions(resolved.jobId);
  if (!read.ok) {
    return {
      ok: false,
      result: { ok: false, code: read.code, message: read.message }
    };
  }
  if (read.versions.length === 0) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'PRESALE_NOT_FOUND',
        message: `${jobRef} has no presale recorded, so there is no quote yet.`
      }
    };
  }
  return { ok: true, jobRef, versions: read.versions };
}

/** A version named the way a person names it, or by id. */
function pick(versions: QuoteVersion[], wanted: string): QuoteVersion | null {
  const want = wanted.trim().toLowerCase();
  const byId = versions.find((v) => v.presaleId.toLowerCase() === want);
  if (byId) return byId;
  if (want === 'current' || want === 'latest')
    return versions.find((v) => v.isCurrent) ?? versions[0];
  const byLabel = versions.find((v) => v.label.toLowerCase() === want);
  if (byLabel) return byLabel;
  // "2" means the newest correction of quote 2, which is what "Quote 2" means
  // to a customer holding one piece of paper.
  const asNumber = Number(want.replace(/^quote\s*/, ''));
  if (Number.isInteger(asNumber)) {
    const ofNumber = versions.filter((v) => v.quoteNumber === asNumber);
    if (ofNumber.length > 0) return ofNumber[0];
  }
  return null;
}

const quoteForModel = (v: QuoteVersion) => ({
  quote: v.label,
  presale_id: v.presaleId,
  current: v.isCurrent,
  agreed_price: money(v.agreedPricePence),
  agreed_price_pence: v.agreedPricePence,
  computed_total:
    v.computedTotalPence === null ? null : money(v.computedTotalPence),
  system: `${v.systemKwp.toFixed(2)} kWp · ${v.netPanels} panels`,
  system_kwp: v.systemKwp,
  net_panels: v.netPanels,
  price_breakdown: v.priceBreakdown.map((r) => ({
    label: r.label,
    amount: money(r.pence)
  })),
  roof_notes: v.roofNotes,
  electrical_notes: v.electricalNotes,
  recorded_by: v.surveyor,
  recorded_at: v.submittedAt,
  superseded_at: v.supersededAt,
  reason_this_version_exists: v.revisionReason,
  catalogue_version: v.catalogueVersion
});

const DESIGN_NOTE =
  'The panel layout, inverters and batteries are held as designer state and are not readable here; describe the kWp, the panel count and the price breakdown, and send them to the job’s Presale screen for the full design.';

// -- What the customer is on now ---------------------------------------------

export const getCurrentQuoteTool: ReadTool<{ job: string }> = {
  name: 'get_current_quote',
  summary: 'Read a job’s current quote version in full',
  description:
    "The quote a job is on RIGHT NOW: its customer-facing label (\"Quote 2\"), the agreed price and what the price is made up of, the system size and panel count, the roof and electrical notes, who recorded it and when, and - if it is a revision - why that version exists. Use it for 'what are we quoting Mrs Parton', 'what's the price on SS-ABCD-0001', 'what's included in that quote'. For the list of every version use get_quote_versions; to see what changed between two, use compare_quote_revisions.",
  domain: 'quotes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ job: jobInput }),
  authorization: { permissions: [], roles: QUOTE_ROLES, enforcedBy: ENFORCED },

  async execute({ job }) {
    const loaded = await loadVersions(job);
    if (!loaded.ok) return loaded.result;
    const current =
      loaded.versions.find((v) => v.isCurrent) ?? loaded.versions[0];

    const superseded = loaded.versions.length - 1;
    return {
      ok: true,
      data: {
        job_ref: loaded.jobRef,
        quote: quoteForModel(current),
        earlier_versions: superseded,
        design_note: DESIGN_NOTE
      },
      display: {
        kind: 'workflow',
        title: `${current.label} · ${loaded.jobRef}`,
        steps: [
          { label: 'Agreed price', detail: money(current.agreedPricePence) },
          {
            label: 'System',
            detail: `${current.systemKwp.toFixed(2)} kWp · ${current.netPanels} panels`
          },
          ...current.priceBreakdown.map((r) => ({
            label: r.label,
            detail: money(r.pence)
          })),
          ...(current.roofNotes
            ? [{ label: 'Roof notes', detail: current.roofNotes }]
            : []),
          ...(current.electricalNotes
            ? [{ label: 'Electrical notes', detail: current.electricalNotes }]
            : []),
          ...(current.revisionReason
            ? [{ label: 'Why this version', detail: current.revisionReason }]
            : [])
        ],
        footnote:
          superseded > 0
            ? `${superseded} earlier version${superseded === 1 ? '' : 's'} kept. Recorded by ${current.surveyor ?? 'unknown'}.`
            : `Recorded by ${current.surveyor ?? 'unknown'}.`
      }
    };
  }
};

// -- What changed between two versions ---------------------------------------

interface Change {
  field: string;
  from: string;
  to: string;
}

/** The price breakdown compared row by row, including rows added or removed. */
function breakdownChanges(a: QuoteVersion, b: QuoteVersion): Change[] {
  const keys = Array.from(
    new Set([
      ...a.priceBreakdown.map((r) => r.key),
      ...b.priceBreakdown.map((r) => r.key)
    ])
  );
  const changes: Change[] = [];
  for (const key of keys) {
    const from = a.priceBreakdown.find((r) => r.key === key);
    const to = b.priceBreakdown.find((r) => r.key === key);
    if (from && to && from.pence === to.pence) continue;
    changes.push({
      field: to?.label ?? from?.label ?? key,
      from: from ? money(from.pence) : 'not on this quote',
      to: to ? money(to.pence) : 'removed'
    });
  }
  return changes;
}

const text = (v: string | null) => (v && v.trim() !== '' ? v : 'not recorded');

function compare(a: QuoteVersion, b: QuoteVersion): Change[] {
  const changes: Change[] = [];
  const add = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from, to });
  };
  add('Agreed price', money(a.agreedPricePence), money(b.agreedPricePence));
  add(
    'System size',
    `${a.systemKwp.toFixed(2)} kWp`,
    `${b.systemKwp.toFixed(2)} kWp`
  );
  add('Panels', String(a.netPanels), String(b.netPanels));
  changes.push(...breakdownChanges(a, b));
  add('Roof notes', text(a.roofNotes), text(b.roofNotes));
  add('Electrical notes', text(a.electricalNotes), text(b.electricalNotes));
  return changes;
}

export const compareQuoteRevisionsTool: ReadTool<{
  job: string;
  from?: string;
  to?: string;
}> = {
  name: 'compare_quote_revisions',
  summary: 'Compare two of a job’s quote versions line by line',
  description:
    "What changed between two versions of a job's quote: the agreed price, the system size and panel count, each line of the price breakdown, and the roof and electrical notes, each as 'was' and 'now'. With no versions named it compares the one before the current one with the current one - the usual question, 'what changed on the new quote?'. Name versions the way get_quote_versions reports them (\"Quote 1\", \"Quote 2c\"). It compares what was RECORDED; it cannot compare designs.",
  domain: 'quotes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    from: versionInput
      .optional()
      .describe(
        'The earlier version. Default: the one before the current one.'
      ),
    to: versionInput
      .optional()
      .describe('The later version. Default: the current one.')
  }),
  authorization: { permissions: [], roles: QUOTE_ROLES, enforcedBy: ENFORCED },

  async execute({ job, from, to }) {
    const loaded = await loadVersions(job);
    if (!loaded.ok) return loaded.result;
    const versions = loaded.versions;

    if (versions.length < 2 && !(from && to)) {
      return {
        ok: false,
        code: 'ONLY_ONE_VERSION',
        message: `${loaded.jobRef} has only one quote version (${versions[0].label}), so there is nothing to compare it with.`
      };
    }

    const current = versions.find((v) => v.isCurrent) ?? versions[0];
    // The list is newest first, so "the one before the current one" is the row
    // after it.
    const previous = versions[versions.indexOf(current) + 1] ?? null;

    const later = to ? pick(versions, to) : current;
    const earlier = from ? pick(versions, from) : previous;

    const unknown = [
      ...(to && !later ? [to] : []),
      ...(from && !earlier ? [from] : [])
    ];
    if (unknown.length > 0) {
      return {
        ok: false,
        code: 'UNKNOWN_QUOTE_VERSION',
        message: `${loaded.jobRef} has no quote version called ${unknown.join(' or ')}. Its versions are: ${versions.map((v) => v.label).join(', ')}.`
      };
    }
    if (!later || !earlier) {
      return {
        ok: false,
        code: 'ONLY_ONE_VERSION',
        message: `${loaded.jobRef} has only one quote version, so there is nothing to compare it with.`
      };
    }
    if (later.presaleId === earlier.presaleId) {
      return {
        ok: false,
        code: 'SAME_QUOTE_VERSION',
        message: `Those are the same version (${later.label}). Name two different ones.`
      };
    }

    const changes = compare(earlier, later);
    return {
      ok: true,
      data: {
        job_ref: loaded.jobRef,
        from: {
          quote: earlier.label,
          recorded_at: earlier.submittedAt,
          current: earlier.isCurrent
        },
        to: {
          quote: later.label,
          recorded_at: later.submittedAt,
          current: later.isCurrent,
          reason_this_version_exists: later.revisionReason
        },
        changes,
        unchanged: changes.length === 0,
        design_note: DESIGN_NOTE
      },
      display: {
        kind: 'workflow',
        title: `${earlier.label} → ${later.label} · ${loaded.jobRef}`,
        steps:
          changes.length > 0
            ? changes.map((c) => ({
                label: c.field,
                detail: `${c.from} → ${c.to}`
              }))
            : [
                {
                  label: 'No recorded difference',
                  detail:
                    'Price, system, breakdown and notes are identical on both versions.'
                }
              ],
        footnote: later.revisionReason
          ? `${later.label} exists because: ${later.revisionReason}`
          : undefined
      }
    };
  }
};

export const QUOTE_READ_TOOLS = [
  getCurrentQuoteTool,
  compareQuoteRevisionsTool
];

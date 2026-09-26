import 'server-only';

import { runCommand } from '@/lib/backend/command';
import { readOps } from '@/lib/backend/read';
import { getJobDetail } from '@/features/jobs/server/queries';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool
} from '../registry';

/**
 * Revising a quote, and the two things that can mean.
 *
 * A presale is append-only: migration 20260920300000 made a job's quote a
 * history of immutable versions rather than a single row, because a generated
 * contract has to stay traceable to the figures it came from. So this tool
 * cannot edit anything, and does not try to - it asks PRESALE_REVISE for a new
 * version, exactly as the presale screen does.
 *
 * The mode is the whole point, and the model must choose it deliberately:
 *
 *   correction   The customer's quote number does not move. For fixing what
 *                was recorded wrongly - a misheard note, a wrong reading.
 *   new_version  The quote number moves. For changing what is being SOLD, so
 *                the customer can say which offer they accepted.
 *
 * What this tool deliberately cannot do is redesign the system. Changing the
 * panels, the roof layout or the inverters means recomputing kWp, panel counts
 * and a price breakdown, and the designer is the only thing that does that
 * correctly - PRESALE_REVISE refuses a design or price change that arrives
 * without its recomputed totals. A sentence cannot produce those, so the model
 * is told to send the person to the presale screen instead.
 *
 * That leaves it able to do the thing people actually ask for in words: fix a
 * note, and record an agreed price change.
 */

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe('Job reference, or enough of the customer name to find one');

interface Loaded {
  jobId: string;
  jobRef: string;
  quoteLabel: string;
  agreedPricePence: number;
  roofNotes: string | null;
  electricalNotes: string | null;
}

interface VersionsRead {
  versions: {
    presale_id: string;
    quote_label: string;
    is_current: boolean;
    agreed_price_pence: number;
    revision_reason: string | null;
    submitted_at: string;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(
  job: string
): Promise<
  { ok: true; loaded: Loaded } | { ok: false; code: string; message: string }
> {
  // A job id needs no search, and the other job-scoped tools resolve it the
  // same way. Everything below then works identically for a reference, a
  // customer name or an id.
  if (UUID.test(job)) return loadById(job, job);

  const { hits } = await searchVisibleJobs(job);
  const exact = hits.filter(
    (h) => h.jobRef.toUpperCase() === job.toUpperCase()
  );
  const found =
    exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (!found) {
    return {
      ok: false,
      code: hits.length > 1 ? 'AMBIGUOUS_JOB' : 'NOT_FOUND',
      message:
        hits.length > 1
          ? `"${job}" matches ${hits.length} jobs (${hits
              .slice(0, 5)
              .map((h) => `${h.jobRef} ${h.customerName}`)
              .join('; ')}). Ask which one they mean.`
          : 'No job the signed-in staff member can see matched.'
    };
  }

  return loadById(found.id, found.jobRef);
}

async function loadById(
  jobId: string,
  fallbackRef: string
): Promise<
  { ok: true; loaded: Loaded } | { ok: false; code: string; message: string }
> {
  // Refuse a historical record HERE, not at execute. The command refuses it
  // too, but showing somebody a confirmation card for something the database
  // will reject is a worse answer than saying so now.
  const detail = await getJobDetail(jobId);
  const jobRef = detail?.job?.job_ref ?? fallbackRef;
  if (detail?.job?.record_class === 'HistoricalImport') {
    return {
      ok: false,
      code: 'HISTORICAL_IMPORT',
      message: `${jobRef} is an imported historical record. It has no presale of record, so there is no quote to revise.`
    };
  }

  const read = await readOps<VersionsRead>('PRESALE_VERSIONS', {
    job_id: jobId
  });
  if (!read.ok)
    return {
      ok: false,
      code: 'PRESALE_READ_FAILED',
      message: read.error.message
    };
  const current = read.data.versions.find((v) => v.is_current);
  if (!current)
    return {
      ok: false,
      code: 'PRESALE_NOT_FOUND',
      message: `${jobRef} has no presale, so there is no quote to revise.`
    };

  return {
    ok: true,
    loaded: {
      jobId,
      jobRef,
      quoteLabel: current.quote_label,
      agreedPricePence: current.agreed_price_pence,
      roofNotes: null,
      electricalNotes: null
    }
  };
}

const money = (pence: number) =>
  `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export const getQuoteVersionsTool: ReadTool<{ job: string }> = {
  name: 'get_quote_versions',
  summary: 'List a job’s quote versions',
  description:
    "Every quote version of a job, newest first, with which one is current, what each was agreed at and why it exists. Use this before proposing a revision, and to answer 'which quote did they accept?'.",
  domain: 'jobs',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ job: jobInput }),
  authorization: {
    // No permission code: reading a job's quote versions is part of reading
    // the job, and PRESALE_VERSIONS applies the job's own visibility rules.
    // This asked for `job.read`, which is not a permission this application
    // has - role_permissions holds job.read.all / job.read.own - so nobody
    // held it and the tool was never offered to anyone.
    permissions: [],
    roles: ['Admin', 'Manager', 'Director', 'Office', 'Surveyor', 'Finance'],
    enforcedBy:
      'app.read_presale_versions via public.execute_operations_read - job visibility is the database’s'
  },

  async execute(input) {
    const loaded = await load(input.job);
    if (!loaded.ok)
      return { ok: false, code: loaded.code, message: loaded.message };
    const read = await readOps<VersionsRead>('PRESALE_VERSIONS', {
      job_id: loaded.loaded.jobId
    });
    if (!read.ok)
      return {
        ok: false,
        code: 'PRESALE_READ_FAILED',
        message: read.error.message
      };
    return {
      ok: true,
      data: {
        job_ref: loaded.loaded.jobRef,
        versions: read.data.versions.map((v) => ({
          quote: v.quote_label,
          current: v.is_current,
          agreed_price: money(v.agreed_price_pence),
          reason: v.revision_reason,
          created: v.submitted_at
        }))
      }
    };
  }
};

interface ReviseInput {
  job: string;
  mode: 'correction' | 'new_version';
  reason: string;
  agreed_price_pence?: number;
  roof_notes?: string;
  electrical_notes?: string;
}

export const revisePresaleTool: MutationTool<ReviseInput> = {
  name: 'revise_quote',
  summary: 'Record a corrected or new version of a job’s quote',
  description:
    "Write a NEW version of a job's quote. Nothing is ever edited in place: the old version is kept and superseded, and fresh customer documents are generated from the new one. " +
    "Choose the mode deliberately. Use 'correction' when something was RECORDED wrongly - the customer's quote number does not change. Use 'new_version' when what is being SOLD changes, including an agreed price change - the quote number increments so the customer can say which offer they accepted. " +
    'This tool can change the agreed price and the roof/electrical notes only. It CANNOT change the system design - panels, layout, inverters or batteries - because those require recomputed totals that only the presale screen produces; if the customer wants a different system, say so and send them to the presale screen.',
  domain: 'jobs',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    mode: z
      .enum(['correction', 'new_version'])
      .describe(
        'correction = fixing what was recorded (quote number unchanged); new_version = what is being sold changed (quote number increments)'
      ),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(400)
      .describe('Why this version exists. Shown beside the quote.'),
    agreed_price_pence: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('New agreed price in pence. Only with mode=new_version.'),
    roof_notes: z.string().trim().max(2000).optional(),
    electrical_notes: z.string().trim().max(2000).optional()
  }),
  authorization: {
    // `presale.revise` was never a permission this application defines, so
    // this asked for something nobody holds and the tool was never offered.
    // PRESALE_REVISE is gated by ROLE in app.command_registry, and the
    // registry can express that; the command re-decides it regardless.
    permissions: [],
    roles: ['Admin', 'Manager', 'Director', 'Office', 'Surveyor'],
    enforcedBy:
      'app.cmd_presale_revise via public.execute_command - role, job assignment and the historical-import refusal are the database’s'
  },

  async prepare(input) {
    const loaded = await load(input.job);
    if (!loaded.ok)
      return { ok: false, code: loaded.code, message: loaded.message };
    const c = loaded.loaded;

    if (input.agreed_price_pence != null && input.mode === 'correction') {
      return {
        ok: false,
        code: 'PRESALE_PRICE_NEEDS_VERSION',
        message:
          'A price change is a new offer, not a correction. Propose it as mode=new_version so the quote number moves and the customer can tell the two apart.'
      };
    }

    const changes: ActionPreview['changes'] = [];
    if (input.agreed_price_pence != null) {
      changes.push({
        label: 'Agreed price',
        from: money(c.agreedPricePence),
        to: money(input.agreed_price_pence)
      });
    }
    if (input.roof_notes != null)
      changes.push({ label: 'Roof notes', from: '—', to: input.roof_notes });
    if (input.electrical_notes != null)
      changes.push({
        label: 'Electrical notes',
        from: '—',
        to: input.electrical_notes
      });

    if (changes.length === 0) {
      return {
        ok: false,
        code: 'PRESALE_NO_CHANGE',
        message:
          'Nothing was given to change. Say what should differ in the new version.'
      };
    }

    return {
      ok: true,
      preview: {
        title:
          input.mode === 'new_version'
            ? 'Create the next quote version'
            : 'Correct the current quote',
        summary:
          input.mode === 'new_version'
            ? `${c.jobRef} is on ${c.quoteLabel}. This creates the next quote and regenerates the customer documents.`
            : `${c.jobRef} stays on ${c.quoteLabel}. This corrects it and regenerates the customer documents.`,
        changes,
        warnings: [
          'The current version is kept and superseded - nothing is overwritten.',
          'New customer documents are generated. Anything already emailed still refers to the version it was sent with.'
        ],
        confirmLabel:
          input.mode === 'new_version'
            ? 'Create new version'
            : 'Save correction',
        // A revision inserts; there is no existing row whose version could go
        // stale, so there is nothing to quote back.
        expectedVersion: null
      }
    };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await load(input.job);
    if (!loaded.ok)
      return { ok: false, code: loaded.code, message: loaded.message };
    const c = loaded.loaded;

    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'PRESALE_REVISE',
      job_id: c.jobId,
      payload: {
        mode: input.mode,
        reason: input.reason,
        ...(input.agreed_price_pence != null
          ? { agreed_price_pence: input.agreed_price_pence }
          : {}),
        ...(input.roof_notes != null ? { roof_notes: input.roof_notes } : {}),
        ...(input.electrical_notes != null
          ? { electrical_notes: input.electrical_notes }
          : {})
      }
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }

    const result = response.result as {
      quote_label?: string;
      quote_number?: number;
    };
    return {
      ok: true,
      data: {
        job_ref: c.jobRef,
        previous_quote: c.quoteLabel,
        quote: result.quote_label,
        note: 'The previous version is kept. New customer documents are being generated from this one.'
      }
    };
  }
};

export const PRESALE_REVISION_READ_TOOLS = [getQuoteVersionsTool];
export const PRESALE_REVISION_MUTATION_TOOLS = [revisePresaleTool];

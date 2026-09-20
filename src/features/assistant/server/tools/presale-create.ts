import 'server-only';

import { getSalespeople } from '@/features/presale/server/queries';
import { submitPresale } from '@/features/presale/server/submit-presale';
import type { PresaleSubmission } from '@/features/presale/contract';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ToolContext
} from '../registry';

/**
 * Creating a sale - the New presale the wizard submits.
 *
 * public.submit_presale has always been the one entry point: it validates
 * everything, derives the actor from the session, and commits customer, job,
 * presale, tasks and audit in a single transaction. The wizard calls it through
 * submitPresale(); so does this. There is no second path and no second
 * validator - every rule below is the database's, restated here only so the
 * staff member is told what is wrong before a round trip rather than after.
 *
 * Two things about this tool are deliberate and worth knowing before changing
 * it.
 *
 * It submits NO DESIGN. The wizard carries a designer state - panels, layout,
 * elevations, a priced breakdown against a catalogue version - and a sale made
 * from a sentence has none of that. Rather than invent a layout or borrow a
 * catalogue version it did not use, the submission records design {} and a
 * catalogue_version that says plainly where it came from. The sale is real and
 * complete; the design is absent and visibly so. Anything downstream that
 * needs a layout (materials, commissioning) will find nothing, which is the
 * honest outcome and the reason a designed sale should still go through the
 * wizard.
 *
 * And it takes POUNDS, not pence. The contract is in pence, and a model handed
 * "eight and a half grand" has an easy hundred-fold error to make in either
 * direction. Taking pounds and formatting the total back as currency on the
 * confirmation card puts that error in front of a person who will recognise it
 * instantly.
 */

const ENFORCED =
  'public.submit_presale (presale.submit; salesperson must be an active Surveyor; presale.submit_on_behalf to name anyone else; UK postcode, contact method and price all validated in the database) - session-bound, one transaction, audited';

/** The wording submit_presale rejects with, mapped to what the model should do. */
const CATALOGUE_VERSION = 'simplebot-no-designer';

interface PresaleInput {
  first_name: string;
  last_name: string;
  address_line1: string;
  address_line2?: string;
  town: string;
  postcode: string;
  phone?: string;
  email?: string;
  salesperson?: string;
  finance_route: 'Standard' | 'Phoenix' | 'OtherReview';
  agreed_price_pounds: number;
  lead_source?: string;
  quote_reference?: string;
  roof_required: boolean;
  electrical_required: boolean;
  scaffold_required: boolean;
  roof_notes?: string;
  electrical_notes?: string;
  system_kwp?: number;
  net_panels?: number;
}

const money = (pence: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(pence / 100);

/** UK postcode, the same shape submit_presale insists on. */
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

function normalisePostcode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  if (!POSTCODE.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** The Surveyor this sale is recorded against. */
async function resolveSalesperson(
  input: PresaleInput,
  ctx: ToolContext
): Promise<
  | { ok: true; id: string; name: string }
  | { ok: false; code: string; message: string }
> {
  const salespeople = await getSalespeople();
  if (salespeople.length === 0) {
    return {
      ok: false,
      code: 'NO_SALESPEOPLE',
      message:
        'There are no active Surveyors the signed-in staff member can see, so a sale cannot be recorded against anybody.'
    };
  }
  if (!input.salesperson) {
    // A Surveyor submitting their own sale is the ordinary case, and the one
    // the database allows without presale.submit_on_behalf.
    const self = salespeople.find((p) => p.id === ctx.actor.user.id);
    if (self) return { ok: true, id: self.id, name: self.displayName };
    return {
      ok: false,
      code: 'SALESPERSON_REQUIRED',
      message: `Ask whose sale this is. The active Surveyors are: ${salespeople
        .map((p) => p.displayName)
        .join(', ')}.`
    };
  }
  const wanted = input.salesperson.trim().toLowerCase();
  const matches = salespeople.filter((p) =>
    p.displayName.toLowerCase().includes(wanted)
  );
  if (matches.length === 1) {
    return { ok: true, id: matches[0].id, name: matches[0].displayName };
  }
  return {
    ok: false,
    code:
      matches.length > 1 ? 'AMBIGUOUS_SALESPERSON' : 'SALESPERSON_NOT_FOUND',
    message:
      matches.length > 1
        ? `"${input.salesperson}" matches ${matches.map((m) => m.displayName).join(', ')}. Ask which one.`
        : `No active Surveyor matched "${input.salesperson}". The active Surveyors are: ${salespeople
            .map((p) => p.displayName)
            .join(', ')}.`
  };
}

function build(input: PresaleInput, salespersonId: string): PresaleSubmission {
  return {
    customer: {
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      address_line1: input.address_line1.trim(),
      address_line2: input.address_line2?.trim() || null,
      town: input.town.trim(),
      postcode: normalisePostcode(input.postcode) ?? input.postcode,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null
    },
    sale: {
      salesperson_id: salespersonId,
      lead_source: input.lead_source?.trim() || null,
      quote_reference: input.quote_reference?.trim() || null,
      finance_route: input.finance_route,
      agreed_price_pence: Math.round(input.agreed_price_pounds * 100)
    },
    scope: {
      roof_required: input.roof_required,
      electrical_required: input.electrical_required,
      scaffold_required: input.scaffold_required,
      roof_notes: input.roof_notes?.trim() || null,
      electrical_notes: input.electrical_notes?.trim() || null
    },
    design: {},
    design_schema_version: 1,
    catalogue_version: CATALOGUE_VERSION,
    computed: {
      system_kwp: input.system_kwp ?? 0,
      net_panels: input.net_panels ?? 0,
      computed_total_pence: Math.round(input.agreed_price_pounds * 100),
      price_breakdown: []
    }
  };
}

/** Checks the database will refuse anyway, answered before the round trip. */
function problem(
  input: PresaleInput
): { code: string; message: string } | null {
  if (!normalisePostcode(input.postcode)) {
    return {
      code: 'INVALID_POSTCODE',
      message: `"${input.postcode}" is not a UK postcode. A sale cannot be recorded without a real one - ask for the customer's postcode.`
    };
  }
  if (!input.phone?.trim() && !input.email?.trim()) {
    return {
      code: 'CONTACT_METHOD_REQUIRED',
      message:
        'A customer needs a phone number or an email address. Ask for one before proposing this.'
    };
  }
  if (!(input.agreed_price_pounds > 0)) {
    return {
      code: 'INVALID_GROSS_AMOUNT',
      message: 'The agreed price must be more than zero. Ask what was agreed.'
    };
  }
  return null;
}

export const createPresaleTool: MutationTool<PresaleInput> = {
  name: 'create_presale',
  summary: 'Record a new sale (New presale), creating the customer and job',
  description:
    'Record a sale that has been agreed - the New presale. This creates the CUSTOMER, the JOB and its first tasks in one go, and a presale CANNOT be edited or undone once submitted, so read the details back before proposing it and never guess a value. Everything must be real: a valid UK postcode, a phone number or email address, an agreed price in POUNDS, and an active Surveyor as the salesperson. It records no design - no panel layout, elevations or priced breakdown - so if the sale was designed in the quoting tool, say it should be submitted through the New presale screen instead so the design is kept. Use this when someone dictates the details of a sale, or gives you a row of data to enter.',
  domain: 'presales',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    address_line1: z.string().trim().min(1).max(200),
    address_line2: z.string().trim().max(200).optional(),
    town: z.string().trim().min(1).max(100),
    postcode: z.string().trim().min(5).max(12).describe('A UK postcode'),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(254).optional(),
    salesperson: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe(
        'The Surveyor whose sale this is, by name. Leave out if it is the signed-in person’s own sale.'
      ),
    finance_route: z.enum(['Standard', 'Phoenix', 'OtherReview']),
    agreed_price_pounds: z
      .number()
      .positive()
      .describe(
        'The agreed gross selling price in POUNDS, e.g. 8500 for £8,500'
      ),
    lead_source: z.string().trim().max(200).optional(),
    quote_reference: z.string().trim().max(200).optional(),
    roof_required: z.boolean().describe('Is roof work part of this sale?'),
    electrical_required: z
      .boolean()
      .describe('Is electrical work part of this sale?'),
    scaffold_required: z.boolean().describe('Is scaffolding needed?'),
    roof_notes: z.string().trim().max(2000).optional(),
    electrical_notes: z.string().trim().max(2000).optional(),
    system_kwp: z.number().nonnegative().optional(),
    net_panels: z.number().int().nonnegative().optional()
  }),
  authorization: { permissions: ['presale.submit'], enforcedBy: ENFORCED },

  async prepare(input, ctx) {
    const bad = problem(input);
    if (bad) return { ok: false, ...bad };
    const salesperson = await resolveSalesperson(input, ctx);
    if (!salesperson.ok)
      return {
        ok: false,
        code: salesperson.code,
        message: salesperson.message
      };

    const pence = Math.round(input.agreed_price_pounds * 100);
    const scope = [
      input.roof_required ? 'Roof' : null,
      input.electrical_required ? 'Electrical' : null,
      input.scaffold_required ? 'Scaffolding' : null
    ].filter(Boolean);

    const preview: ActionPreview = {
      title: 'Record a new sale',
      summary: `Create a customer and a job for ${input.first_name.trim()} ${input.last_name.trim()} at ${normalisePostcode(input.postcode)}.`,
      changes: [
        {
          label: 'Customer',
          to: `${input.first_name.trim()} ${input.last_name.trim()}`
        },
        {
          label: 'Address',
          to: [
            input.address_line1.trim(),
            input.address_line2?.trim(),
            input.town.trim(),
            normalisePostcode(input.postcode)
          ]
            .filter(Boolean)
            .join(', ')
        },
        {
          label: 'Contact',
          to: [input.phone?.trim(), input.email?.trim()]
            .filter(Boolean)
            .join(' · ')
        },
        { label: 'Salesperson', to: salesperson.name },
        { label: 'Finance route', to: input.finance_route },
        // Formatted as money so a hundred-fold slip is obvious at a glance.
        { label: 'Agreed price', to: money(pence) },
        { label: 'Work included', to: scope.join(', ') || 'none stated' },
        ...(input.lead_source
          ? [{ label: 'Lead source', to: input.lead_source.trim() }]
          : []),
        ...(input.system_kwp || input.net_panels
          ? [
              {
                label: 'System',
                to: `${input.system_kwp ?? 0} kWp, ${input.net_panels ?? 0} panels`
              }
            ]
          : [])
      ],
      warnings: [
        'This creates a customer, a job and its first tasks. A presale cannot be edited or undone once submitted.',
        'No design is recorded - no panel layout, elevations or priced breakdown. If this sale was designed, submit it through the New presale screen instead so the design is kept.'
      ],
      confirmLabel: 'Record the sale',
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const bad = problem(input);
    if (bad) return { ok: false, ...bad };
    const salesperson = await resolveSalesperson(input, ctx);
    if (!salesperson.ok)
      return {
        ok: false,
        code: salesperson.code,
        message: salesperson.message
      };

    const result = await submitPresale(
      ctx.commandId,
      build(input, salesperson.id)
    );
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.field
          ? `${result.message} (${result.field})`
          : result.message
      };
    }
    return {
      ok: true,
      data: {
        job_ref: result.result.job_ref,
        customer: result.result.customer.display_name,
        postcode: result.result.customer.postcode,
        workflow_stage: result.result.workflow_stage,
        tasks_created: result.result.tasks.map((t) => ({
          code: t.code,
          title: t.title,
          owner: t.owner_name
        })),
        note: `Recorded as ${result.result.job_ref}. No design was captured, so the panel layout and priced breakdown are empty on this job.`
      }
    };
  }
};

export const PRESALE_MUTATION_TOOLS = [createPresaleTool];

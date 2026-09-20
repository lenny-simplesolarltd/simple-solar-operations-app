import 'server-only';

import { runCommand } from '@/lib/backend/command';
import { getCustomerContact } from '@/features/customers/server/contact';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * Correcting a customer's contact details, and where a job came from.
 *
 * These are the two things staff asked SimpleBot for and it could not do -
 * not because it was being careful, but because the capability did not exist
 * anywhere in the system. There was no command, no screen, and public.customers
 * was SELECT-only, so a phone number captured at intake was permanent.
 *
 * Migration 20260920270000 added CUSTOMER_UPDATE and JOB_SALE_UPDATE. These
 * tools are adapters over those commands and nothing more: they run through
 * runCommand -> public.execute_command under the signed-in person's own
 * session, so the permission (customer.edit / job.sale.edit), the job
 * visibility rule, the refusal on imported historical records, the version
 * check, the command_id idempotency and the audit trigger are all the
 * database's, exactly as they are for a member of staff.
 *
 * Deliberately NOT offered, and refused by the command itself even if asked:
 *
 *   * the customer's NAME and ADDRESS - identity the job reference and the
 *     whole identity spine are derived from;
 *   * the agreed price, finance route, quote reference and salesperson - the
 *     commercial terms of a signed contract.
 *
 * Those are not withheld to be cautious about tooling. They are decisions with
 * consequences a sentence does not carry, and they belong in front of a person
 * who can see the contract.
 */

const CUSTOMER_ENFORCED =
  'public.execute_command CUSTOMER_UPDATE (app.customer_edit_require: customer.edit; app.can_read_job; HistoricalImport refused; expected_version on the customer) - session-bound, audited by customers_audit';

const SALE_ENFORCED =
  'public.execute_command JOB_SALE_UPDATE (app.customer_edit_require: job.sale.edit; app.can_read_job; HistoricalImport refused; expected_version on the job) - session-bound, audited by jobs_audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, a postcode, or a customer name that identifies exactly one job'
  );

type Resolved = { ok: true; jobId: string } | { ok: false; result: ToolResult };

async function resolveJob(job: string): Promise<Resolved> {
  if (UUID.test(job)) return { ok: true, jobId: job };
  const { hits } = await searchVisibleJobs(job);
  const exact = hits.filter(
    (h) => h.jobRef.toUpperCase() === job.toUpperCase()
  );
  const match =
    exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (match) return { ok: true, jobId: match.id };
  return {
    ok: false,
    result: {
      ok: false,
      code: hits.length > 1 ? 'AMBIGUOUS_JOB' : 'NOT_FOUND',
      message:
        hits.length > 1
          ? `"${job}" matches ${hits.length} jobs (${hits
              .slice(0, 5)
              .map((h) => `${h.jobRef} ${h.customerName}`)
              .join('; ')}). Ask which one they mean, or use find_job.`
          : 'No job the signed-in staff member can see matched. It may not exist, or they may not have access to it.'
    }
  };
}

/** The job, its customer and both versions - or the reason it cannot be edited. */
async function load(job: string) {
  const resolved = await resolveJob(job);
  if (!resolved.ok) return { ok: false as const, result: resolved.result };
  const contact = await getCustomerContact(resolved.jobId);
  if (!contact) {
    return {
      ok: false as const,
      result: {
        ok: false as const,
        code: 'NOT_FOUND',
        message:
          'That job has no customer record the signed-in staff member can see.'
      }
    };
  }
  if (contact.recordClass === 'HistoricalImport') {
    return {
      ok: false as const,
      result: {
        ok: false as const,
        code: 'HISTORICAL_IMPORT',
        message: `${contact.jobRef} is an imported historical record, not live work. Imported records are an archive of what the previous system held and cannot be edited. Say so rather than trying another way.`
      }
    };
  }
  return { ok: true as const, contact };
}

/** How a contact detail reads in a confirmation, including when there isn't one. */
const shown = (v: string | null) => (v && v.trim() !== '' ? v : 'not recorded');

// -- Read: what is on file now ------------------------------------------------

export const getCustomerContactTool: ReadTool<{ job: string }> = {
  name: 'get_customer_contact',
  summary: 'See the contact details recorded for a job’s customer',
  description:
    "The contact details on file for a job's customer: phone, email, alternate contact and any contact notes, plus where the enquiry came from (lead source). Use it before proposing a correction, so you can say what is currently recorded, and to answer 'what number do we have for SS-ABCD-1234'. Returns the customer's name but never their address.",
  domain: 'customers',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ job: jobInput }),
  authorization: {
    permissions: [],
    enforcedBy: 'RLS on public.customers (customers_select, job visibility)'
  },
  async execute({ job }) {
    const loaded = await load(job);
    if (!loaded.ok) return loaded.result;
    const c = loaded.contact;
    return {
      ok: true,
      data: {
        job_ref: c.jobRef,
        customer_name: c.name,
        phone: c.phone,
        email: c.email,
        alternate_contact: c.alternateContact,
        contact_notes: c.contactNotes,
        lead_source: c.leadSource
      }
    };
  }
};

// -- Mutation: correct the contact details ------------------------------------

interface ContactInput {
  job: string;
  phone?: string;
  email?: string;
  alternate_contact?: string;
  contact_notes?: string;
}

/** Only the fields the request actually named reach the command. */
function contactPayload(input: ContactInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.phone !== undefined) payload.phone = input.phone.trim();
  if (input.email !== undefined) payload.email = input.email.trim();
  if (input.alternate_contact !== undefined)
    payload.alternate_contact = input.alternate_contact.trim();
  if (input.contact_notes !== undefined)
    payload.contact_notes = input.contact_notes.trim();
  return payload;
}

export const updateCustomerContactTool: MutationTool<ContactInput> = {
  name: 'update_customer_contact',
  summary: 'Correct a customer’s phone, email, alternate contact or notes',
  description:
    "Correct the contact details held for a job's customer - add a phone number, fix an email address, record an alternate contact or a note about how to reach them. Name only the fields that change; the rest are left alone. Pass an empty string to clear one, though a customer must keep at least a phone number or an email address. This CANNOT change the customer's name or address, and cannot change anything about the sale - do not offer to. Always say what is currently recorded and what it would become.",
  domain: 'customers',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    phone: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('The phone number as it should read, e.g. "01833 660484"'),
    email: z.string().trim().max(200).optional(),
    alternate_contact: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Another way to reach them, e.g. a partner’s number'),
    contact_notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe('How or when to contact them, e.g. "prefers calls after 6pm"')
  }),
  authorization: {
    permissions: ['customer.edit'],
    enforcedBy: CUSTOMER_ENFORCED
  },

  async prepare(input) {
    const loaded = await load(input.job);
    if (!loaded.ok) return { ok: false, ...failure(loaded.result) };
    const c = loaded.contact;
    const payload = contactPayload(input);
    if (Object.keys(payload).length === 0) {
      return {
        ok: false,
        code: 'CUSTOMER_NO_CHANGE',
        message:
          'No contact detail was named. Ask which detail they want to change.'
      };
    }

    const current: Record<string, string | null> = {
      phone: c.phone,
      email: c.email,
      alternate_contact: c.alternateContact,
      contact_notes: c.contactNotes
    };
    const label: Record<string, string> = {
      phone: 'Phone',
      email: 'Email',
      alternate_contact: 'Alternate contact',
      contact_notes: 'Contact notes'
    };
    const changes = Object.entries(payload)
      .filter(([k, v]) => (v as string) !== (current[k] ?? ''))
      .map(([k, v]) => ({
        label: label[k],
        from: shown(current[k]),
        to: (v as string) === '' ? 'cleared' : (v as string)
      }));
    if (changes.length === 0) {
      return {
        ok: false,
        code: 'CUSTOMER_NO_CHANGE',
        message: `Those details are already what is recorded for ${c.jobRef}. Say so rather than running anything.`
      };
    }

    const preview: ActionPreview = {
      title: 'Correct contact details',
      summary: `Update the contact details for ${c.name} on ${c.jobRef}.`,
      changes,
      warnings: [
        'This changes the details staff and automated messages use to reach this customer.'
      ],
      confirmLabel: 'Save contact details',
      expectedVersion: c.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await load(input.job);
    if (!loaded.ok) return loaded.result;
    const c = loaded.contact;
    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'CUSTOMER_UPDATE',
      job_id: c.jobId,
      expected_version: ctx.expectedVersion ?? c.version,
      payload: contactPayload(input)
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    return {
      ok: true,
      data: {
        job_ref: c.jobRef,
        customer_name: c.name,
        changed: (response.result as { changed?: string[] }).changed ?? [],
        note: 'Saved. The change is recorded against the customer in the audit trail.'
      }
    };
  }
};

// -- Mutation: where the enquiry came from ------------------------------------

interface LeadSourceInput {
  job: string;
  lead_source: string;
}

export const setLeadSourceTool: MutationTool<LeadSourceInput> = {
  name: 'set_lead_source',
  summary: 'Change where a job’s enquiry came from',
  description:
    "Change a job's lead source - where the enquiry came from, e.g. Facebook, Referral, Checkatrade. This is the ONLY part of the sale that can be changed here: it cannot change the agreed price, the finance route, the quote reference or the salesperson, so do not offer to. Say what the lead source currently is before proposing a change.",
  domain: 'jobs',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    lead_source: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Where the enquiry came from, as the business names it')
  }),
  authorization: {
    permissions: ['job.sale.edit'],
    enforcedBy: SALE_ENFORCED
  },

  async prepare(input) {
    const loaded = await load(input.job);
    if (!loaded.ok) return { ok: false, ...failure(loaded.result) };
    const c = loaded.contact;
    const next = input.lead_source.trim();
    if (next === (c.leadSource ?? '')) {
      return {
        ok: false,
        code: 'JOB_SALE_NO_CHANGE',
        message: `${c.jobRef} already has its lead source recorded as "${next}". Say so rather than running anything.`
      };
    }
    const preview: ActionPreview = {
      title: 'Change lead source',
      summary: `Record where ${c.jobRef} came from.`,
      changes: [{ label: 'Lead source', from: shown(c.leadSource), to: next }],
      warnings: [
        'Lead source is reported on. Only the source changes: the agreed price, finance route and quote reference are untouched.'
      ],
      confirmLabel: 'Save lead source',
      expectedVersion: c.jobVersion
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await load(input.job);
    if (!loaded.ok) return loaded.result;
    const c = loaded.contact;
    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'JOB_SALE_UPDATE',
      job_id: c.jobId,
      expected_version: ctx.expectedVersion ?? c.jobVersion,
      payload: { lead_source: input.lead_source.trim() }
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    const result = response.result as {
      lead_source?: string;
      previous_lead_source?: string | null;
    };
    return {
      ok: true,
      data: {
        job_ref: c.jobRef,
        lead_source: result.lead_source,
        previous_lead_source: result.previous_lead_source,
        note: 'Saved and recorded in the audit trail.'
      }
    };
  }
};

/** Narrows a failed ToolResult to the shape prepare() returns. */
function failure(result: ToolResult): { code: string; message: string } {
  return result.ok
    ? { code: 'UNEXPECTED', message: 'Unexpected result.' }
    : { code: result.code, message: result.message };
}

export const CUSTOMER_READ_TOOLS = [getCustomerContactTool];
export const CUSTOMER_MUTATION_TOOLS = [
  updateCustomerContactTool,
  setLeadSourceTool
];

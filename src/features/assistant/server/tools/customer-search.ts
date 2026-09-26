import 'server-only';

import { searchVisibleCustomers } from '@/features/customers/server/search';
import { z } from 'zod';
import type { JobCardData } from '../../protocol';
import type { ReadTool } from '../registry';

/**
 * Finding a customer without starting from a job.
 *
 * find_job answers "which job is this?"; this answers "who is this?", which is
 * a different question and the one staff ask when a stranger rings up. One
 * person can hold several jobs - a repeat customer, a remedial visit, a second
 * property - and find_job can only ever show them one at a time.
 *
 * It returns contact details, because a call handler with a name and no phone
 * number has not been helped. It does NOT decide who may see them: the search
 * runs under the signed-in person's own session, and customers_select ties a
 * customer's visibility to their jobs'. A Surveyor gets their own customers.
 */

const MODEL_LIMIT = 8;

export const findCustomerTool: ReadTool<{ query: string }> = {
  name: 'find_customer',
  summary: 'Find a customer by name, postcode, address, phone or email',
  description:
    "Find a CUSTOMER rather than a job: by name, postcode, address, town, phone number or email address. Returns each match with their contact details and every job of theirs this staff member can see, newest first. Use it when the staff member starts from a person - 'who is 07700 900123', 'have we done anything for the Partons before', 'find me Mrs Smith in DL12' - or when they might have more than one job. When they clearly mean one specific job, find_job is the better tool. Several matches means several different people, not several jobs: name them and ask which, never assume.",
  domain: 'customers',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe(
        'A name, postcode, address, town, phone number or email address'
      )
  }),
  authorization: {
    permissions: [],
    enforcedBy:
      'RLS on public.customers (customers_select) and public.jobs - session-bound client, job visibility decides customer visibility'
  },

  async execute({ query }) {
    const { hits, total } = await searchVisibleCustomers(query, MODEL_LIMIT);

    // Every job of every match, as one list of cards - the drawer has no
    // customer card, and the jobs are what staff click through to.
    const jobs: JobCardData[] = hits.flatMap((c) =>
      c.jobs.map((j) => ({
        id: j.id,
        jobRef: j.jobRef,
        customerName: c.name,
        postcode: c.postcode ?? '',
        workflowStage: j.workflowStage,
        ...(j.soldAt ? { soldAt: j.soldAt } : {})
      }))
    );

    return {
      ok: true,
      data: {
        query,
        total,
        customers: hits.map((c) => ({
          customer_id: c.id,
          name: c.name,
          address: c.address,
          postcode: c.postcode,
          phone: c.phone,
          email: c.email,
          alternate_contact: c.alternateContact,
          jobs: c.jobs.map((j) => ({
            job_id: j.id,
            job_ref: j.jobRef,
            stage: j.workflowStage,
            sold_at: j.soldAt,
            // Finished history from the previous system, not live work.
            historical_import: j.isHistorical
          }))
        })),
        truncated: total > hits.length || undefined,
        note:
          hits.length === 0
            ? 'No customer this staff member can see matched.'
            : undefined,
        visibility_note:
          'Only customers with a job this staff member can see are searched, and only those jobs are listed. An empty result does not prove the person is not a customer.'
      },
      display: {
        kind: 'job_list',
        query,
        total: jobs.length,
        jobs: jobs.slice(0, 12)
      }
    };
  }
};

export const CUSTOMER_SEARCH_READ_TOOLS = [findCustomerTool];

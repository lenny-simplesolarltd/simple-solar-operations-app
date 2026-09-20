import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

/**
 * A job's customer, as far as contact details go.
 *
 * Read under the signed-in person's own session: public.customers carries a
 * SELECT policy tied to job visibility, so this returns exactly the customers
 * whose jobs that person may already see, and nothing else.
 *
 * The version is the point of reading this at all. CUSTOMER_UPDATE takes the
 * CUSTOMER's version as its expected_version - not the job's - so a correction
 * proposed from stale details is refused rather than quietly overwriting
 * somebody else's edit.
 */
export type CustomerContact = {
  customerId: string;
  version: number;
  name: string;
  phone: string | null;
  email: string | null;
  alternateContact: string | null;
  contactNotes: string | null;
  /** The job the details were reached through. */
  jobId: string;
  jobRef: string;
  leadSource: string | null;
  jobVersion: number;
  recordClass: string;
};

type Row = {
  id: string;
  job_ref: string;
  version: number;
  lead_source: string | null;
  record_class: string;
  customers: {
    id: string;
    version: number;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    alternate_contact: string | null;
    contact_notes: string | null;
  } | null;
};

export async function getCustomerContact(
  jobId: string
): Promise<CustomerContact | null> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, job_ref, version, lead_source, record_class, customers(id, version, first_name, last_name, phone, email, alternate_contact, contact_notes)'
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`customer contact: ${error.message}`);
  const row = data as Row | null;
  if (!row?.customers) return null;
  const c = row.customers;
  return {
    customerId: c.id,
    version: c.version,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
    phone: c.phone,
    email: c.email,
    alternateContact: c.alternate_contact,
    contactNotes: c.contact_notes,
    jobId: row.id,
    jobRef: row.job_ref,
    leadSource: row.lead_source,
    jobVersion: row.version,
    recordClass: row.record_class
  };
}

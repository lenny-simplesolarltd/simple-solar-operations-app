import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The fields job search matches on.
 *
 * SimpleBot's find_job goes through searchVisibleJobs, and staff ask for an
 * imported job by whatever they have - "find job 13 Rivendell Way" as readily
 * as a name or a postcode. The address columns were missing here while the
 * canonical database reads already matched on them, so the assistant could not
 * find a job the Jobs screen found. These assertions pin the two lists
 * together.
 */
const captured: { filter: string; options?: unknown }[] = [];

function builder() {
  const self = {
    select: () => self,
    order: () => self,
    limit: () => self,
    or: (filter: string, options?: unknown) => {
      captured.push({ filter, options });
      return self;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [], count: 0, error: null })
  };
  return self;
}

vi.mock('@/lib/supabase/data', () => ({
  createDataClient: async () => ({ from: () => builder() })
}));

import { searchVisibleJobs } from '../search';

describe('searchVisibleJobs', () => {
  it('matches customer name, postcode AND address, and the job/previous reference', async () => {
    captured.length = 0;
    await searchVisibleJobs('13 Rivendell Way');

    const customerFilter = captured.find((c) => c.options)?.filter ?? '';
    for (const field of [
      'first_name',
      'last_name',
      'postcode',
      'address_line1',
      'town'
    ]) {
      expect(customerFilter, `customer search must include ${field}`).toContain(
        `${field}.ilike.`
      );
    }

    const refFilter = captured.find((c) => !c.options)?.filter ?? '';
    // An imported job is as likely to be looked up by its previous reference.
    expect(refFilter).toContain('job_ref.ilike.');
    expect(refFilter).toContain('source_reference.ilike.');
  });
});

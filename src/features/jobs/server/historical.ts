import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

/**
 * The staff names an imported job carries.
 *
 * These are historical facts recorded on the old Job Booking form, not current
 * allocations: nobody is scheduled on an archived job. A name is linked to a
 * person only where the import matched exactly one active member of staff, and
 * an ambiguous value is deliberately left unlinked rather than guessed.
 *
 * Visibility is the table's own RLS policy (app.can_read_job), so this sees
 * exactly the jobs the signed-in person may already see.
 */
export type HistoricalPersonRow = {
  role: string;
  /** Exactly as the legacy form recorded it. */
  source_value: string;
  match_kind: string;
  person: { display_name: string } | null;
};

export async function getHistoricalPeople(
  jobId: string
): Promise<HistoricalPersonRow[]> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('historical_job_people')
    .select('role, source_value, match_kind, person:people(display_name)')
    .eq('job_id', jobId)
    .order('role');
  if (error) throw new Error(`historical people: ${error.message}`);
  return (data ?? []) as unknown as HistoricalPersonRow[];
}

/** Whether the name was tied to a real person, and why it was or was not. */
export function historicalPersonNote(match: string): string {
  switch (match) {
    case 'ExactMatch':
    case 'SafeNormalisedMatch':
      return 'matched to a member of staff';
    case 'Ambiguous':
      return 'more than one person could have been meant, so it was not linked to anybody';
    case 'NoMatch':
      return 'no member of staff matched this name';
    default:
      return 'not a person (the old form allowed free text here)';
  }
}

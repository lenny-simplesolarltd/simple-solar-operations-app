import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

/**
 * Who a report can be sent to.
 *
 * Recipients are EXPLICIT PEOPLE, chosen when the schedule is configured, and
 * stored as an address alongside the person they belong to. Not a role: if a
 * report went to "whoever is in Office today", giving somebody the Office role
 * next month would quietly start sending them a client's programme report, and
 * nobody would have decided that. Membership changes must not change who
 * receives an existing report until a person edits it.
 *
 * "Send it to the office" is therefore a SELECTION request, not a stored rule.
 * It expands to the people currently in that role, those people are shown in
 * the confirmation, and what gets saved is them.
 *
 * Reading a colleague's work address is office-class only - the people_select
 * policy on public.people decides, not this module. A person with no address
 * on file cannot be a recipient, and is refused by name rather than guessed at:
 * there is no rule that turns "Dan Barnes" into an email address.
 */

export interface ReportPerson {
  personId: string;
  displayName: string;
  email: string;
  roles: string[];
}

/** A person with no usable address, so a caller can say which one and why. */
export interface UnreachablePerson {
  personId: string;
  displayName: string;
  reason: 'no email on file';
}

type PersonRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  notification_email: string | null;
  person_roles: { role_code: string }[] | null;
};

const SELECT =
  'id, display_name, email, notification_email, person_roles(role_code)';

/** The address to write to: their notification address, else their login one. */
const addressOf = (row: PersonRow) =>
  (row.notification_email ?? row.email ?? '').trim().toLowerCase() || null;

function split(rows: PersonRow[]) {
  const people: ReportPerson[] = [];
  const unreachable: UnreachablePerson[] = [];
  for (const row of rows) {
    const displayName = row.display_name?.trim() || 'Unnamed';
    const email = addressOf(row);
    if (!email) {
      unreachable.push({
        personId: row.id,
        displayName,
        reason: 'no email on file'
      });
      continue;
    }
    people.push({
      personId: row.id,
      displayName,
      email,
      roles: (row.person_roles ?? []).map((r) => r.role_code)
    });
  }
  return { people, unreachable };
}

/**
 * Active staff who could receive a report, optionally narrowed by name.
 *
 * RLS decides what comes back: someone who may not read the directory sees
 * only themselves, which is the correct answer rather than an error.
 */
export async function listReportPeople(query?: string): Promise<{
  people: ReportPerson[];
  unreachable: UnreachablePerson[];
}> {
  const supabase = await createDataClient();
  let request = supabase
    .from('people')
    .select(SELECT)
    .eq('active', true)
    .order('display_name');
  const text = query?.trim();
  if (text) request = request.ilike('display_name', `%${text}%`);
  const { data, error } = await request.limit(200);
  if (error) return { people: [], unreachable: [] };
  return split((data ?? []) as unknown as PersonRow[]);
}

/** The people currently holding a role, for expanding "the office". */
export async function listPeopleInRole(roleCode: string): Promise<{
  people: ReportPerson[];
  unreachable: UnreachablePerson[];
}> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('people')
    .select(SELECT)
    .eq('active', true)
    .eq('person_roles.active', true)
    .eq('person_roles.role_code', roleCode)
    .order('display_name')
    .limit(200);
  if (error) return { people: [], unreachable: [] };
  // The embedded filter keeps non-members in the result with an empty roles
  // array, so membership is decided here rather than assumed from the join.
  const rows = ((data ?? []) as unknown as PersonRow[]).filter(
    (row) => (row.person_roles ?? []).length > 0
  );
  return split(rows);
}

/** The words people use for the Office group, mapped to the canonical role. */
export const GROUP_ROLES: Record<string, string> = {
  office: 'Office',
  'the office': 'Office',
  'office staff': 'Office',
  'office team': 'Office'
};

export const groupRoleFor = (phrase: string): string | null =>
  GROUP_ROLES[phrase.trim().toLowerCase()] ?? null;

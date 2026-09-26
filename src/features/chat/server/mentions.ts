import 'server-only';

import { searchVisibleJobs } from '@/features/jobs/server/search';
import { createDataClient } from '@/lib/supabase/data';
import { listChatPeople } from '../queries';

// What "@" offers: colleagues, and the work itself - jobs, tasks, forms,
// responses, booked visits and scaffold.
//
// Every one of them is searched through a path that already applies this
// person's own visibility - CHAT_PEOPLE for colleagues, searchVisibleJobs for
// jobs, and a plain select under RLS for the rest. So the menu can only ever
// suggest something the person could have found anyway, and "@" never becomes
// a way to discover that a job, a form or a booking exists.
//
// The menu is NOT where the security decision is made. What it offers is a
// convenience; what survives is decided again by app.chat_tag_refs when the
// message is sent, and a third time for the reader. A search that was too
// generous would still tag nothing it should not.

export type { MentionKind, MentionSuggestion } from './mention-types';
import type { MentionSuggestion } from './mention-types';

/** Per kind, so one busy noun cannot fill the menu. */
const PER_KIND = 4;
/** How far back a kind matched in this process looks before giving up. */
const RECENT = 40;

export async function searchMentions(
  query: string,
  limit = 6
): Promise<MentionSuggestion[]> {
  const q = query.trim();

  // With nothing typed, the menu is a shortlist: colleagues and open tasks.
  // Searching every table for the empty string would be six reads to show
  // whatever happened to sort first.
  const [people, jobs, tasks, forms, responses, visits, scaffold] =
    await Promise.all([
      listChatPeople(q || undefined),
      q
        ? searchVisibleJobs(q, limit).catch(() => ({ hits: [] }))
        : { hits: [] },
      searchVisibleTasks(q, limit),
      q ? searchVisibleForms(q) : [],
      q ? searchVisibleResponses(q) : [],
      q ? searchVisibleWorkPackages(q) : [],
      q ? searchVisibleScaffold(q) : []
    ]);

  const out: MentionSuggestion[] = [];

  if (people.ok)
    for (const p of people.data.slice(0, limit))
      out.push({
        kind: 'person',
        id: p.personId,
        // The name goes in as text; the id travels beside the message.
        insert: `@${p.displayName}`,
        label: p.displayName,
        detail: p.roles.join(', ') || null
      });

  for (const j of jobs.hits.slice(0, limit))
    out.push({
      kind: 'job',
      id: j.id,
      // The reference itself, because that is what makes it a link: the
      // database and the renderer both recognise SS-XXXX-0000 on sight, and
      // the same resolution puts a card on the message.
      insert: j.jobRef,
      label: j.jobRef,
      detail: [j.customerName, j.postcode].filter(Boolean).join(' · ') || null
    });

  for (const t of tasks)
    out.push({
      kind: 'task',
      id: t.id,
      // A task has no textual handle, so the words go in the message and the
      // id travels beside it as a tag. Every kind below works the same way.
      insert: t.title,
      label: t.title,
      detail: [t.templateCode, t.jobRef, t.status].filter(Boolean).join(' · ')
    });

  out.push(...forms, ...responses, ...visits, ...scaffold);

  return out;
}

interface TaskHit {
  id: string;
  title: string;
  templateCode: string | null;
  status: string | null;
  jobRef: string | null;
}

/** Open tasks this person can see, matched on title or template code. */
async function searchVisibleTasks(
  query: string,
  limit: number
): Promise<TaskHit[]> {
  const supabase = await createDataClient();
  let request = supabase
    .from('tasks')
    .select('id, title, template_code, status, jobs(job_ref)')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (query) {
    const safe = like(query);
    if (safe)
      request = request.or(
        `title.ilike.%${safe}%,template_code.ilike.%${safe}%`
      );
  }

  const { data, error } = await request;
  if (error) return [];
  return (data ?? []).map((row) => {
    const job = row.jobs as { job_ref?: string } | null;
    return {
      id: String(row.id),
      title: String(row.title ?? 'Task'),
      templateCode: (row.template_code as string) ?? null,
      status: (row.status as string) ?? null,
      jobRef: job?.job_ref ?? null
    };
  });
}

/**
 * Search text safe to put inside a PostgREST filter. Commas, brackets and
 * percent signs are filter syntax there, so they are removed rather than
 * escaped: a stray bracket must never be able to change which rows come back.
 */
function like(query: string): string {
  return query.replace(/[%,()*]/g, ' ').trim();
}

const jobRefOf = (row: { jobs?: unknown }): string | null => {
  const job = row.jobs as { job_ref?: string } | null;
  return job?.job_ref ?? null;
};

const detail = (...parts: (string | null | undefined)[]): string | null =>
  parts.filter(Boolean).join(' · ') || null;

/** Forms, by title. Refused outright unless this person holds forms.read. */
async function searchVisibleForms(query: string): Promise<MentionSuggestion[]> {
  const safe = like(query);
  if (!safe) return [];
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id, title, status, jobs(job_ref)')
    .eq('kind', 'form')
    .ilike('title', `%${safe}%`)
    .order('updated_at', { ascending: false })
    .limit(PER_KIND);
  if (error) return [];
  return (data ?? []).map((row) => ({
    kind: 'form' as const,
    id: String(row.id),
    insert: String(row.title),
    label: String(row.title),
    detail: detail('Form', row.status as string, jobRefOf(row))
  }));
}

/** Submitted responses, by the title of the form they answered. */
async function searchVisibleResponses(
  query: string
): Promise<MentionSuggestion[]> {
  const safe = like(query);
  if (!safe) return [];
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('form_submissions')
    .select('id, submitted_at, forms!inner(title)')
    .ilike('forms.title', `%${safe}%`)
    .order('submitted_at', { ascending: false })
    .limit(PER_KIND);
  if (error) return [];
  return (data ?? []).map((row) => {
    const form = row.forms as { title?: string } | null;
    const title = form?.title ?? 'Response';
    return {
      kind: 'form_submission' as const,
      id: String(row.id),
      insert: title,
      label: title,
      detail: detail(
        'Response',
        row.submitted_at
          ? new Date(String(row.submitted_at)).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short'
            })
          : null
      )
    };
  });
}

/**
 * Booked work, by job reference or trade.
 *
 * The job reference lives on the joined row, and an `or` across a join is not
 * something PostgREST expresses, so the recent visits are fetched and matched
 * here. Bounded by the same RLS as everything else, and by a small ceiling.
 */
async function searchVisibleWorkPackages(
  query: string
): Promise<MentionSuggestion[]> {
  const safe = like(query).toLowerCase();
  if (!safe) return [];
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('work_packages')
    .select('id, trade, status, planned_start, jobs!inner(job_ref)')
    .order('planned_start', { ascending: false, nullsFirst: false })
    .limit(RECENT);
  if (error) return [];
  return (data ?? [])
    .filter(
      (row) =>
        String(row.trade).toLowerCase().includes(safe) ||
        (jobRefOf(row) ?? '').toLowerCase().includes(safe)
    )
    .slice(0, PER_KIND)
    .map((row) => {
      const label = `${row.trade} visit`;
      return {
        kind: 'work_package' as const,
        id: String(row.id),
        insert: label,
        label,
        detail: detail(
          jobRefOf(row),
          row.planned_start
            ? new Date(String(row.planned_start)).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })
            : 'Unscheduled',
          row.status as string
        )
      };
    });
}

/** Scaffold bookings, by job reference or scaffolder. */
async function searchVisibleScaffold(
  query: string
): Promise<MentionSuggestion[]> {
  const safe = like(query);
  if (!safe) return [];
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('scaffold_bookings')
    .select(
      'id, status, erect_planned_at, companies(name), jobs!inner(job_ref)'
    )
    .order('erect_planned_at', { ascending: false, nullsFirst: false })
    .limit(RECENT);
  if (error) return [];
  const wanted = safe.toLowerCase();
  return (data ?? [])
    .filter((row) => {
      const company = (row.companies as { name?: string } | null)?.name ?? '';
      return (
        company.toLowerCase().includes(wanted) ||
        (jobRefOf(row) ?? '').toLowerCase().includes(wanted)
      );
    })
    .slice(0, PER_KIND)
    .map((row) => {
      const company =
        (row.companies as { name?: string } | null)?.name ?? 'Scaffold';
      return {
        kind: 'scaffold_booking' as const,
        id: String(row.id),
        insert: `${company} scaffold`,
        label: company,
        detail: detail(
          'Scaffold',
          jobRefOf(row),
          row.erect_planned_at
            ? `Erect ${new Date(
                String(row.erect_planned_at)
              ).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })}`
            : null,
          row.status as string
        )
      };
    });
}

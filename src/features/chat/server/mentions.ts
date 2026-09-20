import 'server-only';

import { searchVisibleJobs } from '@/features/jobs/server/search';
import { createDataClient } from '@/lib/supabase/data';
import { listChatPeople } from '../queries';

// What "@" offers: colleagues, jobs and tasks.
//
// Every one of the three is searched through a path that already applies this
// person's own visibility — CHAT_PEOPLE for colleagues, searchVisibleJobs for
// jobs, and a plain select on tasks under RLS. So the menu can only ever
// suggest something the person could have found anyway, and "@" never becomes
// a way to discover that a job or a task exists.

export type { MentionKind, MentionSuggestion } from './mention-types';
import type { MentionSuggestion } from './mention-types';

export async function searchMentions(
  query: string,
  limit = 6
): Promise<MentionSuggestion[]> {
  const q = query.trim();

  const [people, jobs, tasks] = await Promise.all([
    listChatPeople(q || undefined),
    q ? searchVisibleJobs(q, limit).catch(() => ({ hits: [] })) : { hits: [] },
    searchVisibleTasks(q, limit)
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
      // database and the renderer both recognise SS-XXXX-0000 on sight.
      insert: j.jobRef,
      label: j.jobRef,
      detail: [j.customerName, j.postcode].filter(Boolean).join(' · ') || null
    });

  for (const t of tasks)
    out.push({
      kind: 'task',
      id: t.id,
      // A task has no textual handle, so the words go in the message and the
      // id travels beside it as a tag.
      insert: t.title,
      label: t.title,
      detail: [t.templateCode, t.jobRef, t.status].filter(Boolean).join(' · ')
    });

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
    const safe = query.replace(/[%,()]/g, ' ').trim();
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

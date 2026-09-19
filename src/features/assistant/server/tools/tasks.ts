import 'server-only';

import { dueState } from '@/features/jobs/format';
import {
  getOpenTasks,
  type TaskListItem
} from '@/features/jobs/server/queries';
import { z } from 'zod';
import type { TaskCardData } from '../../protocol';
import type { ReadTool } from '../registry';

const RLS =
  'RLS on tasks: own/backup tasks, or every task with task.read.all (session-bound Supabase client)';

export const toTaskCard = (t: TaskListItem): TaskCardData => ({
  id: t.id,
  code: t.code,
  title: t.title,
  status: t.status,
  dueAt: t.dueAt,
  ownerName: t.ownerName,
  backupName: t.backupName,
  blockingReason: t.blockingReason,
  jobId: t.jobId,
  jobRef: t.jobRef,
  jobName: t.jobName
});

export const taskForModel = (t: TaskListItem) => ({
  task_id: t.id,
  code: t.code,
  title: t.title,
  status: t.status,
  priority: t.priority,
  due_at: t.dueAt,
  due_state: dueState(t.dueAt),
  owner: t.ownerName,
  backup: t.backupName,
  blocking_reason: t.blockingReason,
  job_id: t.jobId,
  job_ref: t.jobRef
});

const dueFilter = z
  .enum(['any', 'overdue', 'today'])
  .default('any')
  .describe(
    "'overdue' or 'today' narrow by due date (Europe/London day); 'any' returns all open tasks"
  );

const matchesDue = (t: TaskListItem, due: 'any' | 'overdue' | 'today') =>
  due === 'any' || dueState(t.dueAt) === due;

const MODEL_LIMIT = 40;

function taskResult(title: string, tasks: TaskListItem[], extra: object) {
  return {
    ok: true as const,
    data: {
      ...extra,
      order: 'priority, then due date (the order the Tasks page uses)',
      total: tasks.length,
      tasks: tasks.slice(0, MODEL_LIMIT).map(taskForModel),
      truncated: tasks.length > MODEL_LIMIT
    },
    display: {
      kind: 'task_list' as const,
      title,
      total: tasks.length,
      tasks: tasks.slice(0, 12).map(toTaskCard)
    }
  };
}

export const getMyTasksTool: ReadTool<{ due: 'any' | 'overdue' | 'today' }> = {
  name: 'get_my_tasks',
  summary: 'List your open tasks, optionally only overdue or due today',
  description:
    "List the signed-in staff member's open tasks (tasks they own or are the backup for), ordered by priority then due date. 'Mine' always means the signed-in person - there is no way to ask for another person's list with this tool.",
  domain: 'tasks',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ due: dueFilter }),
  authorization: { permissions: [], enforcedBy: RLS },
  async execute({ due }, { actor }) {
    const me = actor.user.id;
    const tasks = (await getOpenTasks()).filter(
      (t) => (t.ownerId === me || t.backupId === me) && matchesDue(t, due)
    );
    const label =
      due === 'overdue'
        ? 'Your overdue tasks'
        : due === 'today'
          ? 'Your tasks due today'
          : 'Your open tasks';
    return taskResult(label, tasks, { due });
  }
};

export const getTeamTasksTool: ReadTool<{
  ownerName?: string;
  due: 'any' | 'overdue' | 'today';
}> = {
  name: 'get_team_tasks',
  summary:
    "List the team's open tasks, optionally for one person or only overdue",
  description:
    "List open tasks across the team, optionally filtered to one owner/backup by name (e.g. 'Tanya') and/or to overdue or due-today tasks. Only offered to staff who hold task.read.all.",
  domain: 'tasks',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    ownerName: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe("Part of the owner's or backup's name"),
    due: dueFilter
  }),
  authorization: { permissions: ['task.read.all'], enforcedBy: RLS },
  async execute({ ownerName, due }) {
    const needle = ownerName?.toLowerCase();
    const tasks = (await getOpenTasks()).filter(
      (t) =>
        matchesDue(t, due) &&
        (!needle ||
          t.ownerName.toLowerCase().includes(needle) ||
          (t.backupName ?? '').toLowerCase().includes(needle))
    );
    const who = ownerName ? `${ownerName}'s` : 'Team';
    const label =
      due === 'overdue'
        ? `${who} overdue tasks`
        : due === 'today'
          ? `${who} tasks due today`
          : `${who} open tasks`;
    return taskResult(label, tasks, { owner_name: ownerName ?? null, due });
  }
};

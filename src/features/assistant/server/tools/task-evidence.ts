import 'server-only';

import { runCommand } from '@/lib/backend/command';
import { createDataClient } from '@/lib/supabase/data';
import { z } from 'zod';
import type { MutationContext, MutationTool, ToolResult } from '../registry';
import { resolveJobReference } from './resolve-job';

/**
 * Attaching the signed contract to a job's PRE02 task.
 *
 * This was registered as permanently app-only for a good reason, and the
 * reason has to survive the tool: a file is uploaded from the browser straight
 * to storage and the person attests to it, so a path a MODEL supplied would be
 * an unattested record - nobody has said "this is the signed contract", and
 * the job would carry a contract on the strength of a sentence.
 *
 * So this tool cannot upload anything, and does not take a path. It links a
 * file that is ALREADY STORED on the job - uploaded by a person, through the
 * ordinary Files path, where somebody chose it - to the contract task that has
 * none. The attestation already happened; what was missing was the link, and
 * that is the thing staff actually ask for ("the contract is in the job's
 * files, it just isn't on the task").
 *
 * Three consequences shape the code:
 *
 *   - The model never sees or sends a storage path. It names a file by the id
 *     list_job_files already gave it, or by filename, and the path is looked
 *     up on the server, under this person's own session.
 *   - The file must belong to this job. app.evidence_attach refuses a
 *     cross-job path (R1A_CROSS_JOB_EVIDENCE) and this refuses it earlier, so
 *     the confirmation card can say which file by name.
 *   - It attaches; it does not complete. TASK_EVIDENCE_ATTACH on an open PRE02
 *     stores the contract against the task and leaves it open, exactly as the
 *     task screen does, and the description says so.
 */

const ENFORCED =
  'app.cmd_task_evidence_attach via public.execute_command (PRE02 only; attachability, job scope and expected_version are the database’s) + RLS on public.evidence';

/** The one task the command accepts. Anything else raises R1A_TASK_NOT_ATTACHABLE. */
const CONTRACT_TASK = 'PRE02';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AttachInput {
  job: string;
  file: string;
}

interface Target {
  jobId: string;
  jobRef: string;
  taskId: string;
  taskVersion: number;
  /** Complete-with-no-evidence is a repair; open is an ordinary attach. */
  repair: boolean;
  file: {
    id: string;
    storagePath: string;
    filename: string;
    category: string;
    addedAt: string | null;
  };
}

type Loaded =
  | { ok: true; target: Target }
  | { ok: false; code: string; message: string };

type TaskRow = {
  id: string;
  version: number;
  status: string;
  evidence_id: string | null;
  revision_required: boolean | null;
};

type EvidenceRow = {
  id: string;
  storage_path: string | null;
  filename: string | null;
  category: string;
  upload_status: string;
  created_at: string | null;
};

const refuse = (code: string, message: string) => ({
  ok: false as const,
  code,
  message
});

async function load(input: AttachInput): Promise<Loaded> {
  const resolved = await resolveJobReference(input.job);
  if (!resolved.ok) {
    const r = resolved.result as Extract<ToolResult, { ok: false }>;
    return refuse(r.code, r.message);
  }
  const supabase = await createDataClient();

  const { data: jobData, error: jobError } = await supabase
    .from('jobs')
    .select('id, job_ref, record_class')
    .eq('id', resolved.jobId)
    .maybeSingle();
  if (jobError) throw new Error(`attach evidence job: ${jobError.message}`);
  const job = jobData as { job_ref: string; record_class: string } | null;
  if (!job) {
    return refuse(
      'NOT_FOUND',
      'No job the signed-in staff member can see matched.'
    );
  }
  const jobRef = job.job_ref;
  if (job.record_class === 'HistoricalImport') {
    return refuse(
      'HISTORICAL_IMPORT',
      `${jobRef} is an imported historical record. Its tasks are an archive of what the previous system held and cannot be changed.`
    );
  }

  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select('id, version, status, evidence_id, revision_required')
    .eq('job_id', resolved.jobId)
    .eq('template_code', CONTRACT_TASK)
    .maybeSingle();
  if (taskError) throw new Error(`attach evidence task: ${taskError.message}`);
  const task = taskData as TaskRow | null;
  if (!task) {
    return refuse(
      'TASK_NOT_FOUND',
      `${jobRef} has no ${CONTRACT_TASK} contract task that this staff member can see. Attaching a signed contract is only possible on that task.`
    );
  }
  // The same three cases app.cmd_task_evidence_attach recognises, refused here
  // so the person is told why instead of being shown a card that will fail.
  const open =
    ['Open', 'Waiting', 'InProgress'].includes(task.status) &&
    !task.revision_required;
  const repair = task.status === 'Complete' && task.evidence_id === null;
  if (task.evidence_id !== null) {
    return refuse(
      'EVIDENCE_ALREADY_ATTACHED',
      `${CONTRACT_TASK} on ${jobRef} already has a contract attached. A second one is not attached over it - if the wrong file is on there, that is a job for the task screen.`
    );
  }
  if (!open && !repair) {
    return refuse(
      'TASK_NOT_ATTACHABLE',
      `${CONTRACT_TASK} on ${jobRef} is ${task.status}${task.revision_required ? ' and awaiting a revision' : ''}, so a contract cannot be attached to it now.`
    );
  }

  // The file, among the ones already stored on THIS job. RLS decides what
  // comes back, so a file this person may not see is simply not found.
  const { data: evidenceData, error: evidenceError } = await supabase
    .from('evidence')
    .select('id, storage_path, filename, category, upload_status, created_at')
    .eq('job_id', resolved.jobId);
  if (evidenceError)
    throw new Error(`attach evidence files: ${evidenceError.message}`);
  const stored = ((evidenceData ?? []) as unknown as EvidenceRow[]).filter(
    (e) => e.upload_status !== 'Pending' && e.storage_path
  );

  const wanted = input.file.trim();
  const matches = UUID.test(wanted)
    ? stored.filter((e) => e.id.toLowerCase() === wanted.toLowerCase())
    : stored.filter((e) =>
        (e.filename ?? '').toLowerCase().includes(wanted.toLowerCase())
      );

  if (matches.length === 0) {
    return refuse(
      'FILE_NOT_FOUND',
      `No file called "${wanted}" is stored on ${jobRef} for this staff member to see. The contract has to be uploaded on the job first - use list_job_files to see what is there.`
    );
  }
  if (matches.length > 1) {
    return refuse(
      'AMBIGUOUS_FILE',
      `"${wanted}" matches ${matches.length} files on ${jobRef} (${matches
        .slice(0, 5)
        .map((e) => e.filename ?? 'unnamed')
        .join('; ')}). Ask which one they mean.`
    );
  }
  const file = matches[0];

  return {
    ok: true,
    target: {
      jobId: resolved.jobId,
      jobRef,
      taskId: task.id,
      taskVersion: task.version,
      repair,
      file: {
        id: file.id,
        storagePath: file.storage_path as string,
        filename: file.filename ?? 'File',
        category: file.category,
        addedAt: file.created_at
      }
    }
  };
}

export const attachTaskEvidenceTool: MutationTool<AttachInput> = {
  name: 'attach_task_evidence',
  summary: 'Attach a signed contract already on file to a job’s contract task',
  description:
    "Link a file ALREADY STORED on a job to its PRE02 contract task, for when the signed contract was uploaded to the job but never attached to the task. Name the file by the id list_job_files returned, or by part of its filename; call list_job_files first so you can say which file you mean. You cannot upload anything - if the contract is not on the job yet, say so and send them to the job's Files tab, because the person uploading is the person attesting that it IS the signed contract. Attaching does not complete the task: on an open PRE02 it stores the contract and leaves the task open, and they complete it on the task screen. If the task already has a contract on it, nothing is attached over the top.",
  domain: 'evidence',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe(
        'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, or a customer name that identifies one job'
      ),
    file: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe(
        'The stored file: its id from list_job_files, or enough of its filename to identify one file on this job'
      )
  }),
  authorization: {
    // app.authorize_command requires app.is_office for every task command,
    // and there is no permission code that stands in for it. These are the
    // roles is_office names; the command re-decides it whatever this says.
    permissions: [],
    roles: ['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const loaded = await load(input);
    if (!loaded.ok) return loaded;
    const t = loaded.target;
    return {
      ok: true,
      preview: {
        title: 'Attach the signed contract',
        summary: t.repair
          ? `${CONTRACT_TASK} on ${t.jobRef} is already complete but has no contract on it. This attaches one that is already stored on the job and re-runs the job's prebooking checks.`
          : `This attaches a file already stored on ${t.jobRef} to its ${CONTRACT_TASK} contract task. The task stays open.`,
        changes: [
          {
            label: 'Signed contract',
            from: 'Nothing attached',
            to: t.file.filename
          }
        ],
        warnings: [
          'Nothing is uploaded. This links a file somebody has already stored on this job - check it is the right one before confirming.',
          ...(t.repair
            ? [
                'This also records the contract against the job and re-evaluates its prebooking readiness.'
              ]
            : ['The task is not completed. Complete it on the task screen.'])
        ],
        confirmLabel: 'Attach contract',
        expectedVersion: t.taskVersion
      }
    };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await load(input);
    if (!loaded.ok) return loaded;
    const t = loaded.target;

    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'TASK_EVIDENCE_ATTACH',
      task_id: t.taskId,
      expected_version: ctx.expectedVersion ?? t.taskVersion,
      // The already-registered path of a file on this job. The command
      // resolves it back to the same evidence row rather than making another.
      payload: { evidence_path: t.file.storagePath }
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
        job_ref: t.jobRef,
        task: CONTRACT_TASK,
        attached: t.file.filename,
        open_url: `/api/evidence/${t.file.id}`,
        note: t.repair
          ? 'Attached to the completed contract task, recorded against the job, and the prebooking checks have been re-evaluated.'
          : 'Attached. The task is still open - it is completed on the task screen.'
      }
    };
  }
};

export const TASK_EVIDENCE_MUTATION_TOOLS = [attachTaskEvidenceTool];

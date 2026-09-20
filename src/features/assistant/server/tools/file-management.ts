import 'server-only';

import {
  createFolder,
  moveFiles as moveFilesCommand
} from '@/features/files/actions';
import { listFolderTargets } from '@/features/files/folder-targets';
import { browseFiles, searchFiles } from '@/features/files/queries';
import { nameProblem } from '@/features/files/names';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * SimpleBot's file-management tools.
 *
 * There is no bot-only path. Creating a folder calls public.file_folder_create
 * and moving documents calls public.file_move - the same commands the file
 * manager calls, under the signed-in person's own session, with the same
 * permissions, the same cross-job refusal and the same audit. The model cannot
 * name a table, a storage path, an actor or a job it has not already read.
 *
 * Deliberately absent: anything that removes a document. Trashing, restoring
 * and permanent deletion are not offered to the model at all - not gated, not
 * planned-but-registered, simply not here. Deleting business records is a
 * decision a person makes in front of the file manager, where the retention
 * rules and the evidence warnings are visible.
 */

const ENFORCED =
  'public.file_folder_create / public.file_move (app.file_authorize_write: file.manage or file.library.manage, job assignment, HistoricalImport refused); session-bound client; audited as FileFolder/Evidence';

/**
 * The coarse pre-check for offering these at all. file.manage is the real,
 * enforced permission the commands themselves require for a job's documents;
 * the commands re-check it, plus assignment and the job's state, whatever the
 * registry lets through.
 */
const MANAGE = ['file.manage'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, or a customer name that identifies exactly one job'
  );

type Resolved =
  | { ok: true; jobId: string; jobRef: string | null }
  | { ok: false; result: ToolResult };

async function resolveJob(job: string): Promise<Resolved> {
  if (UUID.test(job)) return { ok: true, jobId: job, jobRef: null };
  const { hits } = await searchVisibleJobs(job);
  const exact = hits.filter(
    (h) => h.jobRef.toUpperCase() === job.toUpperCase()
  );
  const match =
    exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (match) return { ok: true, jobId: match.id, jobRef: match.jobRef };
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
              .join('; ')}). Ask which one, or use find_job.`
          : 'No job the signed-in staff member can see matched. It may not exist, or they may not have access to it.'
    }
  };
}

// -- Read: the folders that exist ---------------------------------------------

export const listFileFoldersTool: ReadTool<{ job?: string }> = {
  name: 'list_file_folders',
  summary: 'List the folders documents are filed in, for a job or the company',
  description:
    "List the folders a job's documents are filed in (Contracts, Surveys, Photos, Commissioning, Finance, and any others staff have made), or the company document folders when no job is given. Returns each folder with how many documents and subfolders it holds. Use it before moving documents, to check a folder already exists before suggesting a new one, or to answer 'where do the contracts for SS-XXXX go'.",
  domain: 'evidence',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput.optional().describe('Omit for the company document folders')
  }),
  authorization: {
    permissions: [],
    enforcedBy:
      'public.file_browse / RLS on public.file_folders (app.can_read_folder)'
  },
  async execute({ job }) {
    if (!job) {
      const folders = await listFolderTargets({ scope: 'Library' });
      return {
        ok: true,
        data: {
          scope: 'company documents',
          folders: folders.map((f) => ({ name: f.name, depth: f.depth })),
          note:
            folders.length === 0
              ? 'There are no company document folders yet.'
              : undefined
        }
      };
    }
    const resolved = await resolveJob(job);
    if (!resolved.ok) return resolved.result;

    const result = await browseFiles({ scope: 'Job', jobId: resolved.jobId });
    if (!result)
      return {
        ok: false,
        code: 'NOT_FOUND',
        message:
          'That job’s files could not be read: it may not exist, or this staff member may not have access.'
      };
    const folders = await listFolderTargets({
      scope: 'Job',
      jobId: resolved.jobId
    });
    return {
      ok: true,
      data: {
        job_id: resolved.jobId,
        job_ref: result.job?.jobRef ?? resolved.jobRef,
        can_manage: result.canManage,
        top_level_documents: result.totalFiles,
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          depth: f.depth
        })),
        note:
          folders.length === 0
            ? 'This job has no folders yet; its documents sit at the top level.'
            : undefined,
        visibility_note:
          'Only folders this staff member may see are listed. Creating or moving needs them to be assigned to the job, and an imported historical job is read-only.'
      }
    };
  }
};

// -- Mutation: create a folder -------------------------------------------------

interface CreateFolderInput {
  job?: string;
  name: string;
  parent_folder?: string;
}

export const createFileFolderTool: MutationTool<CreateFolderInput> = {
  name: 'create_file_folder',
  summary: 'Create a folder for filing documents',
  description:
    "Create a folder to file documents in - on a job ('make a DNO Documents folder for SS-ABCD-1234') or among the company documents when no job is given. Optionally inside an existing folder. It only creates the folder; it never moves anything into it. Check list_file_folders first so you do not propose a folder that already exists.",
  domain: 'evidence',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput
      .optional()
      .describe('Omit to create a company document folder'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('What to call the folder, e.g. "DNO Documents"'),
    parent_folder: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe(
        'The name of an existing folder to create this one inside. Omit for the top level.'
      )
  }),
  authorization: { permissions: MANAGE, enforcedBy: ENFORCED },

  async prepare(input) {
    const problem = nameProblem(input.name.trim());
    if (problem)
      return { ok: false, code: 'FILE_NAME_INVALID', message: problem };

    const scope = input.job ? 'Job' : 'Library';
    let jobId: string | null = null;
    let jobRef: string | null = null;
    if (input.job) {
      const resolved = await resolveJob(input.job);
      if (!resolved.ok)
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: 'That job could not be identified.'
        };
      jobId = resolved.jobId;
      jobRef = resolved.jobRef;
    }

    const folders = await listFolderTargets({ scope, jobId });
    const where = jobRef ?? (input.job ? 'the job' : 'company documents');

    let parentId: string | null = null;
    if (input.parent_folder) {
      const matches = folders.filter(
        (f) =>
          f.name.toLowerCase() === input.parent_folder!.trim().toLowerCase()
      );
      if (matches.length !== 1)
        return {
          ok: false,
          code: 'FILE_FOLDER_NOT_FOUND',
          message:
            matches.length === 0
              ? `There is no folder called "${input.parent_folder}" in ${where}.`
              : `More than one folder is called "${input.parent_folder}". Ask which one.`
        };
      parentId = matches[0].id;
    }

    const clash = folders.find(
      (f) =>
        f.parentId === parentId &&
        f.name.toLowerCase() === input.name.trim().toLowerCase()
    );
    if (clash)
      return {
        ok: false,
        code: 'FILE_NAME_TAKEN',
        message: `A folder called "${clash.name}" is already there.`
      };

    const preview: ActionPreview = {
      title: 'Create a folder',
      summary: `Create the folder "${input.name.trim()}" in ${
        input.parent_folder ? `${input.parent_folder} (${where})` : where
      }.`,
      changes: [
        { label: 'Folder', to: input.name.trim() },
        {
          label: 'Location',
          to: input.parent_folder ? `${where} / ${input.parent_folder}` : where
        }
      ],
      warnings: [],
      confirmLabel: 'Create folder',
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input) {
    const scope = input.job ? 'Job' : 'Library';
    let jobId: string | null = null;
    if (input.job) {
      const resolved = await resolveJob(input.job);
      if (!resolved.ok) return resolved.result;
      jobId = resolved.jobId;
    }
    const folders = await listFolderTargets({ scope, jobId });
    const parentId = input.parent_folder
      ? (folders.find(
          (f) =>
            f.name.toLowerCase() === input.parent_folder!.trim().toLowerCase()
        )?.id ?? null)
      : null;

    const result = await createFolder({
      scope,
      jobId,
      parentId,
      name: input.name.trim()
    });
    if (!result.ok)
      return { ok: false, code: result.code, message: result.message };
    return {
      ok: true,
      data: {
        created: input.name.trim(),
        scope: scope === 'Library' ? 'company documents' : 'job',
        job_id: jobId
      }
    };
  }
};

// -- Mutation: move documents into a folder ------------------------------------

interface MoveFilesInput {
  job: string;
  folder: string;
  filename_contains?: string;
  category?: string;
}

export const moveFilesToFolderTool: MutationTool<MoveFilesInput> = {
  name: 'move_files_to_folder',
  summary: 'File a job’s documents into one of its folders',
  description:
    "File documents of ONE job into one of that job's folders - 'move the contracts for SS-ABCD-1234 into Contracts'. Choose which documents with filename_contains and/or category. Moving is filing only: it never changes which job a document belongs to and never breaks the link from a task, commissioning record or issue to it. Documents can never be moved to a different job. Always say which documents will move before asking to confirm.",
  domain: 'evidence',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    folder: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('The name of the folder on that job to file them into'),
    filename_contains: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe('Only documents whose name contains this'),
    category: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .optional()
      .describe(
        'Only documents of this category, e.g. Contract, CustomerDetails, Commissioning, DeliveryNote'
      )
  }),
  authorization: { permissions: MANAGE, enforcedBy: ENFORCED },

  async prepare(input) {
    const chosen = await choose(input);
    if (!chosen.ok)
      return { ok: false, code: chosen.code, message: chosen.message };

    const preview: ActionPreview = {
      title: 'File documents',
      summary: `Move ${chosen.files.length} document${
        chosen.files.length === 1 ? '' : 's'
      } on ${chosen.jobRef} into "${chosen.folderName}".`,
      changes: chosen.files.slice(0, 12).map((f) => ({
        label: f.name,
        from: f.location?.folderPath ?? 'Top level',
        to: chosen.folderName
      })),
      warnings: [
        ...(chosen.files.length > 12
          ? [`and ${chosen.files.length - 12} more`]
          : []),
        'Filing does not change which job a document belongs to, and does not affect any task or commissioning record that uses it.'
      ],
      confirmLabel: `Move ${chosen.files.length} document${chosen.files.length === 1 ? '' : 's'}`,
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input) {
    const chosen = await choose(input);
    if (!chosen.ok)
      return { ok: false, code: chosen.code, message: chosen.message };

    const result = await moveFilesCommand({
      fileIds: chosen.files.map((f) => f.id),
      folderId: chosen.folderId,
      expected: Object.fromEntries(
        chosen.files.map((f) => [f.id, f.filingVersion])
      )
    });
    if (!result.ok)
      return { ok: false, code: result.code, message: result.message };
    return {
      ok: true,
      data: {
        moved: result.data?.moved ?? chosen.files.length,
        unchanged: result.data?.unchanged ?? 0,
        folder: chosen.folderName,
        job_ref: chosen.jobRef,
        note: 'Filing only: every document is still on the same job, and every link to it still works.'
      }
    };
  }
};

/** The documents a move would touch, resolved the same way twice. */
async function choose(input: MoveFilesInput) {
  const resolved = await resolveJob(input.job);
  if (!resolved.ok)
    return {
      ok: false as const,
      code: 'NOT_FOUND',
      message: 'That job could not be identified.'
    };

  const folders = await listFolderTargets({
    scope: 'Job',
    jobId: resolved.jobId
  });
  const matches = folders.filter(
    (f) => f.name.toLowerCase() === input.folder.trim().toLowerCase()
  );
  if (matches.length !== 1)
    return {
      ok: false as const,
      code: 'FILE_FOLDER_NOT_FOUND',
      message:
        matches.length === 0
          ? `That job has no folder called "${input.folder}". Use list_file_folders to see its folders, or create_file_folder to make one.`
          : `More than one folder on that job is called "${input.folder}". Ask which one.`
    };
  const folder = matches[0];

  const search = await searchFiles({
    scope: 'Job',
    jobId: resolved.jobId,
    category: input.category ?? null,
    limit: 200
  });
  if (!search)
    return {
      ok: false as const,
      code: 'SEARCH_FAILED',
      message: 'The documents on that job could not be read.'
    };

  const needle = input.filename_contains?.toLowerCase();
  const files = search.files.filter(
    (f) =>
      f.folderId !== folder.id &&
      (!needle || f.name.toLowerCase().includes(needle))
  );
  if (files.length === 0)
    return {
      ok: false as const,
      code: 'NOTHING_TO_MOVE',
      message:
        'No document on that job matches, or they are all in that folder already.'
    };

  return {
    ok: true as const,
    jobRef: search.files[0]?.jobRef ?? resolved.jobRef ?? 'the job',
    folderId: folder.id,
    folderName: folder.name,
    files
  };
}

export const FILE_MANAGEMENT_TOOLS = [
  listFileFoldersTool,
  createFileFolderTool,
  moveFilesToFolderTool
];

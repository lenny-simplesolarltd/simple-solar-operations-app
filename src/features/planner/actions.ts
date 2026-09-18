'use server';

import { readOps } from '@/lib/backend/read';
import type { ReadResult } from '@/lib/backend/types';
import type {
  Candidate,
  ChangeInstallerOptions,
  MoveJobPreview
} from './types';

// Reads a dialog needs only once it opens (candidates for a date range, the
// effect of a move). They go through the same read boundary as pages: the
// database decides who may call them and what they return.

export async function assessInstallers(input: {
  trade: 'Roof' | 'Electrical';
  start_at: string;
  end_at: string;
}): Promise<ReadResult<{ candidates: Candidate[]; ready_count: number }>> {
  return readOps('RP_ASSESS', input);
}

export async function changeInstallerOptions(input: {
  work_package_id: string;
  old_allocation_id?: string;
}): Promise<ReadResult<ChangeInstallerOptions>> {
  return readOps('RP_CHANGE_INSTALLER_OPTIONS', input);
}

export async function previewMoveJob(input: {
  job_id: string;
  activities: string[];
  planned_start?: string;
  planned_end?: string;
  scaffold_erect?: string;
  scaffold_strip?: string;
}): Promise<ReadResult<MoveJobPreview>> {
  return readOps('RP_MOVE_JOB_PREVIEW', input);
}

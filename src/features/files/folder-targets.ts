'use server';

import { createDataClient } from '@/lib/supabase/data';
import type { FileScope } from './types';

// The folders a move can land in, for the Move dialog - the keyboard-reachable
// way to do everything dragging does.
//
// Read straight from public.file_folders under the person's own session: the
// table's RLS policy (app.can_read_folder) already decides what they may see,
// so this cannot show a folder they could not otherwise reach. The command
// checks again when the move actually happens.

export interface FolderTarget {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  /** Outermost first, for indenting and for hiding a folder's own subtree. */
  pathIds: string[];
}

export async function listFolderTargets(input: {
  scope: FileScope;
  jobId?: string | null;
}): Promise<FolderTarget[]> {
  const supabase = await createDataClient();
  let query = supabase
    .from('file_folders')
    .select('id, name, parent_id, depth, path_ids')
    .eq('scope', input.scope)
    .is('trashed_at', null)
    .order('depth')
    .order('name')
    .limit(2000);
  query =
    input.scope === 'Job' && input.jobId
      ? query.eq('job_id', input.jobId)
      : query.is('job_id', null);

  const { data, error } = await query;
  if (error) {
    console.error('listFolderTargets failed', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      name: string;
      parent_id: string | null;
      depth: number | null;
      path_ids: string[] | null;
    };
    return {
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      depth: r.depth ?? 0,
      pathIds: r.path_ids ?? []
    };
  });
}

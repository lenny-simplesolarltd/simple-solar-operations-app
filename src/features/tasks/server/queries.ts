import 'server-only';

import type { TasksRead } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { ReadResult } from '@/lib/backend/types';
import { createDataClient } from '@/lib/supabase/data';
import type { TaskFilters } from '../filters';

/** The TASKS read model for the filters in the URL. */
export function getTasks(filters: TaskFilters): Promise<ReadResult<TasksRead>> {
  return readOps<TasksRead>('TASKS', {
    scope: filters.scope,
    status: filters.status,
    due: filters.due,
    queue: filters.queue,
    owner_id: filters.owner,
    q: filters.q
  });
}

export interface StaffOption {
  id: string;
  name: string;
}

/** Active staff for owner filters (canonical people table, under RLS). */
export async function getStaffOptions(): Promise<StaffOption[]> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name')
    .eq('active', true)
    .order('display_name');
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, name: p.display_name }));
}

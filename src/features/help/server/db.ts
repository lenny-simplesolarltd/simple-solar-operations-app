import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

// The Help Center tables and functions are deliberately not spliced into the
// generated src/types/database.ts (regenerating that file rewrites other
// streams' types). This is the one narrow, typed-at-the-edge way in.

type QueryResult<T> = PromiseLike<{
  data: T | null;
  error: { code?: string; message: string; details?: string | null } | null;
}>;

interface Filterable<T> extends QueryResult<T> {
  eq(column: string, value: unknown): Filterable<T>;
  order(column: string, opts?: { ascending?: boolean }): Filterable<T>;
  limit(n: number): Filterable<T>;
  maybeSingle(): QueryResult<T extends (infer R)[] ? R : T>;
}

export interface HelpDb {
  from<T>(table: string): { select(columns: string): Filterable<T[]> };
  rpc<T>(fn: string, args?: Record<string, unknown>): QueryResult<T>;
}

/** The session-bound (RLS) client, typed only for what Help uses. */
export async function helpDb(): Promise<HelpDb> {
  return (await createDataClient()) as unknown as HelpDb;
}

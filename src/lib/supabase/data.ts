import 'server-only';

import { PREVIEW_READ_ONLY_MESSAGE } from '@/lib/preview/config';
import { getActivePreview } from '@/lib/preview/context';
import type { Database } from '@/types/database';
import {
  createClient as createPlainClient,
  type SupabaseClient
} from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';
import { createClient } from './server';

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);
// Read-only database functions a preview may call. They resolve the actor from
// the token (the preview target) and never write; execute_command is absent.
const READ_RPCS = new Set([
  'current_actor',
  'execute_read',
  'execute_operations_read',
  'describe_command_error',
  'describe_command_result',
  // Evidence metadata a person may see (no storage paths). Opening a file is
  // refused while previewing: Storage is not reachable with a preview token.
  'list_evidence'
]);

/** A client that carries the preview token and physically cannot write. */
export function createPreviewReadClient(jwt: string): SupabaseClient<Database> {
  const { url, anonKey } = getSupabaseEnv();
  const client = createPlainClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const refuse = () => {
    throw new Error(PREVIEW_READ_ONLY_MESSAGE);
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) =>
          new Proxy(target.from(table as never), {
            get: (builder, method, r) =>
              WRITE_METHODS.has(String(method))
                ? refuse
                : Reflect.get(builder, method, r)
          });
      }
      if (prop === 'rpc') {
        return (fn: string, ...rest: unknown[]) =>
          READ_RPCS.has(fn)
            ? (target.rpc as (...a: unknown[]) => unknown)(fn, ...rest)
            : refuse();
      }
      if (prop === 'auth' || prop === 'storage' || prop === 'functions')
        return refuse();
      return Reflect.get(target, prop, receiver);
    }
  });
}

/**
 * The client every READ query should use. Normally the signed-in user's own
 * session (RLS as them). While previewing, a read-only client whose token makes
 * the database evaluate the very same RLS policies as the preview target.
 * Commands keep using createClient() and must call previewWriteBlock() first.
 */
export async function createDataClient(): Promise<SupabaseClient<Database>> {
  const preview = await getActivePreview();
  return preview ? createPreviewReadClient(preview.jwt) : createClient();
}

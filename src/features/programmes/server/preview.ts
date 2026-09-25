'use server';

import { z } from 'zod';
import type { ImportRow } from '../types';
import { importRows } from './queries';

/**
 * The staged import rows, read back for the preview.
 *
 * A read, deliberately not in `actions.ts` (the write boundary). What it returns
 * is what the DATABASE decided each row will do - the browser never recomputes
 * it - so the preview a person approves is the import that will happen.
 */
export async function loadImportRowsAction(
  importId: string,
  options: { invalidOnly?: boolean; limit?: number } = {}
): Promise<{ ok: true; rows: ImportRow[] } | { ok: false; message: string }> {
  if (!z.uuid().safeParse(importId).success)
    return { ok: false, message: 'That import could not be found.' };
  try {
    return {
      ok: true,
      rows: await importRows(importId, {
        invalidOnly: options.invalidOnly === true,
        limit: Math.min(Math.max(Number(options.limit) || 200, 1), 2000)
      })
    };
  } catch {
    return { ok: false, message: 'The staged rows could not be read.' };
  }
}

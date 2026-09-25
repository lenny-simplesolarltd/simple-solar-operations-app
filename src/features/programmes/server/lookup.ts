'use server';

import { z } from 'zod';
import type { ProgrammeProperty } from '../types';
import { searchProperties } from './queries';

/**
 * The property search the installer's lookup calls.
 *
 * Its own file because `actions.ts` is the write boundary and this is a read:
 * keeping them apart means nothing here has to be checked against the preview
 * write guard, and nothing there is reachable by a search box.
 *
 * It decides nothing about visibility. The query runs as the signed-in person
 * under RLS, so the results are already only the properties they may visit.
 */
export async function searchPropertiesAction(
  programmeId: string,
  query: string
): Promise<
  { ok: true; properties: ProgrammeProperty[] } | { ok: false; message: string }
> {
  if (!z.uuid().safeParse(programmeId).success)
    return { ok: false, message: 'That programme could not be found.' };
  const text = String(query ?? '').slice(0, 80);
  if (text.trim().length < 2) return { ok: true, properties: [] };
  try {
    return {
      ok: true,
      properties: await searchProperties(programmeId, {
        query: text,
        limit: 20
      })
    };
  } catch {
    return { ok: false, message: 'The search could not run. Try again.' };
  }
}

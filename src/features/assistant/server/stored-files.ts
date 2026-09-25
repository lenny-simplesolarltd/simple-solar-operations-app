import 'server-only';

import { MAX_IMPORT_BYTES } from '@/features/programmes/server/import-plan';
import { createDataClient } from '@/lib/supabase/data';
import { getFileDetails } from '@/features/files/queries';
import { z } from 'zod';
import { IMAGE_MEDIA_TYPES, TEXT_MEDIA_TYPES } from '../protocol';

/**
 * Attaching something already in Files & documents.
 *
 * A screenshot or a register a colleague filed last week is exactly what a
 * person wants to put in front of SimpleBot, and making them download it and
 * upload it again was the only way to do it.
 *
 * Nothing here is a second attachment path. It hands the browser the bytes and
 * the filename, the browser rebuilds an ordinary File, and that File goes
 * through readAttachments like any other - so the size caps, the accepted
 * types, and the property-list staging seam all apply unchanged, and there is
 * one place where those rules live.
 *
 * Authorisation is the file library's own: getFileDetails and file_search run
 * as the signed-in person under RLS, so this reaches exactly the documents that
 * person could already open, and a guessed id is refused the same as ever.
 */

const uuid = z.uuid();

const ATTACHABLE = [...IMAGE_MEDIA_TYPES, ...TEXT_MEDIA_TYPES] as const;

/** A .csv filed with an Excel or empty mime type is still a .csv. */
const attachableType = (mimeType: string | null, name: string) => {
  if (mimeType && (ATTACHABLE as readonly string[]).includes(mimeType))
    return mimeType;
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.txt$/i.test(name)) return 'text/plain';
  return null;
};

export interface AttachableFile {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number | null;
  category: string;
  addedAt: string | null;
  addedByName: string | null;
}

/**
 * The files this person could attach, newest first.
 *
 * Only the kinds an attachment can actually be: offering a 40 MB PDF that the
 * next step would refuse is a worse answer than not offering it.
 */
export async function searchAttachableFiles(
  query: string
): Promise<
  { ok: true; files: AttachableFile[] } | { ok: false; message: string }
> {
  const parsed = z.string().max(120).safeParse(query);
  if (!parsed.success)
    return { ok: false, message: 'That search could not be read.' };

  // file_search is called directly rather than through searchFiles, which
  // answers null for every failure alike. A refusal here has a code and a
  // sentence behind it - "you are not signed in" and "that field is wrong" are
  // different problems - and a picker that cannot say which is a picker nobody
  // can get past. Over-fetched because the type filter below is the client's
  // idea, not something file_search can be asked about.
  const supabase = await createDataClient();
  const { data, error } = await supabase.rpc('file_search', {
    p_request: {
      ...(parsed.data.trim() && { q: parsed.data.trim() }),
      limit: 60
    }
  });
  if (error) {
    console.error('stored-file search failed', error.code, error.message);
    return {
      ok: false,
      // The code is shown, not just logged: a refusal nobody can read is a
      // refusal nobody can fix, and this one is only ever seen by staff.
      message:
        error.code === 'P0001'
          ? `The file library refused the search: ${error.message}`
          : `The file library could not be searched (${error.code ?? 'no code'}: ${error.message}).`
    };
  }

  const result = {
    files: (((data ?? {}) as { files?: unknown }).files ?? []) as {
      id: string;
      name?: string | null;
      mime_type?: string | null;
      size_bytes?: number | null;
      category?: string | null;
      added_at?: string | null;
      added_by_name?: string | null;
    }[]
  };

  const files: AttachableFile[] = [];
  for (const row of result.files) {
    const name = row.name ?? '';
    if (!name) continue;
    const mediaType = attachableType(row.mime_type ?? null, name);
    if (!mediaType) continue;
    if ((row.size_bytes ?? 0) > MAX_IMPORT_BYTES) continue;
    files.push({
      id: row.id,
      name,
      mediaType,
      sizeBytes: row.size_bytes ?? null,
      category: row.category ?? '',
      addedAt: row.added_at ?? null,
      addedByName: row.added_by_name ?? null
    });
    if (files.length === 20) break;
  }
  return { ok: true, files };
}

/**
 * One stored file's bytes, base64, for the browser to rebuild as a File.
 *
 * Base64 rather than handing the signed URL to the page: the URL is a bearer
 * token for somebody's document, and it has no business being in client state
 * or a network log when the bytes are what is wanted.
 */
export async function readStoredFile(
  fileId: string
): Promise<
  | { ok: true; name: string; mediaType: string; base64: string }
  | { ok: false; message: string }
> {
  if (!uuid.safeParse(fileId).success)
    return { ok: false, message: 'That file could not be found.' };

  const details = await getFileDetails(fileId);
  if (!details)
    return {
      ok: false,
      message: 'That file could not be found, or you cannot open it.'
    };

  const { file } = details;
  const mediaType = attachableType(file.mimeType, file.name);
  if (!mediaType)
    return {
      ok: false,
      message: `${file.name} is not a kind of file SimpleBot can read.`
    };
  if ((file.sizeBytes ?? 0) > MAX_IMPORT_BYTES)
    return { ok: false, message: `${file.name} is too large to attach.` };

  let response: Response;
  try {
    response = await fetch(file.downloadUrl);
  } catch {
    return { ok: false, message: `${file.name} could not be fetched.` };
  }
  if (!response.ok)
    return { ok: false, message: `${file.name} could not be fetched.` };

  const bytes = Buffer.from(await response.arrayBuffer());
  // The stored size is metadata; this is what actually arrived.
  if (bytes.byteLength > MAX_IMPORT_BYTES)
    return { ok: false, message: `${file.name} is too large to attach.` };

  return {
    ok: true,
    name: file.uploadedFilename ?? file.name,
    mediaType,
    base64: bytes.toString('base64')
  };
}

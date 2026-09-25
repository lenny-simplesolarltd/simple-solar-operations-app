import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TEXT,
  MAX_ATTACHMENTS,
  TEXT_MEDIA_TYPES,
  type Attachment
} from '../protocol';

/**
 * Turning a dropped file into something the model can read.
 *
 * Runs in the browser, before anything is sent. Two kinds are accepted and
 * nothing else: pictures, which the model looks at, and text or CSV, whose
 * contents travel inside a marked envelope. A PDF, a spreadsheet binary or a
 * Word document is refused by name rather than silently ignored - the staff
 * member should know their file was not read, not wonder why the answer is
 * vague.
 *
 * Refusing here is a convenience, not a control: the server validates the same
 * shapes again, and attached content can never cause a change on its own.
 *
 * One kind of file does NOT travel inside the message: a property list for a
 * programme import. Those run to well over a thousand rows, so inlining one
 * would truncate it at MAX_ATTACHMENT_TEXT and leave the model holding a
 * partial copy of somebody's property register. When the caller passes
 * `programmeImport`, a .csv is posted to /api/assistant/programme-import
 * instead, staged there through the canonical import commands, and only the
 * bounded summary that route returns is put in front of the model.
 */

/** What the file picker offers, and what a drop is filtered against. */
export const ACCEPTED_MEDIA_TYPES = [
  ...IMAGE_MEDIA_TYPES,
  ...TEXT_MEDIA_TYPES
] as const;

export const ACCEPT_ATTRIBUTE = [...ACCEPTED_MEDIA_TYPES, '.csv', '.txt'].join(
  ','
);

export type AttachmentRejection = { name: string; reason: string };

export interface ReadResult {
  attachments: Attachment[];
  rejected: AttachmentRejection[];
}

const isImage = (type: string): type is (typeof IMAGE_MEDIA_TYPES)[number] =>
  (IMAGE_MEDIA_TYPES as readonly string[]).includes(type);

const isText = (type: string): type is (typeof TEXT_MEDIA_TYPES)[number] =>
  (TEXT_MEDIA_TYPES as readonly string[]).includes(type);

/**
 * A browser File's type is whatever the OS guessed, and for a .csv dragged out
 * of a spreadsheet that is often empty or an Excel type. Fall back to the
 * extension so the common case - a CSV row someone exported - just works.
 */
function mediaTypeOf(file: File): string {
  if (isImage(file.type) || isText(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.tsv')) return 'text/tab-separated-values';
  if (name.endsWith('.txt') || name.endsWith('.md')) return 'text/plain';
  if (name.endsWith('.json')) return 'application/json';
  return file.type || 'application/octet-stream';
}

function describe(type: string): string {
  if (type === 'application/pdf') return 'PDFs cannot be read yet';
  if (type.startsWith('video/')) return 'videos cannot be read';
  if (type.startsWith('audio/')) return 'audio cannot be read';
  if (type.includes('sheet') || type.includes('excel')) {
    return 'save it as CSV and attach that';
  }
  if (type.includes('word') || type.includes('document')) {
    return 'paste the text instead';
  }
  return 'this kind of file cannot be read';
}

/** base64 without the data: prefix, which is what both providers want. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: a single spread of a few million bytes blows the call stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  return btoa(binary);
}

/** Upload route for a property list. The bytes go here, never into the model request. */
const PROGRAMME_IMPORT_ROUTE = '/api/assistant/programme-import';

/** The bounded summary the upload route answers with. No row of the file is in it. */
interface StagedImport {
  import_id: string;
  filename: string;
  row_count: number;
  [key: string]: unknown;
}

export interface ProgrammeImportOptions {
  /** Optional: which programme. The server resolves it when there is only one. */
  programmeId?: string;
}

export interface ReadOptions {
  /**
   * When set, a .csv is sent to the server to be staged as a property import
   * instead of being read into the message. Pass it only for someone who may
   * import (the capabilities response lists apply_programme_import for them);
   * the server checks programme.manage again and refuses otherwise.
   */
  programmeImport?: ProgrammeImportOptions;
}

type StageOutcome =
  | { ok: true; summary: StagedImport }
  | { ok: false; code: string; message: string };

/**
 * Sends the file's own bytes to the server and gets a summary back.
 *
 * This is the whole point of the seam. The alternative - the path just below
 * for ordinary text files - reads the file in the browser and inlines it into
 * the model request, capped at MAX_ATTACHMENT_TEXT. Dan's property list is
 * around 1,400 rows: inlining it would truncate it, and would make the model
 * the thing that "read" a housing association's property register. Here the
 * model is told only what was staged.
 */
async function stageProgrammeImport(
  file: File,
  options: ProgrammeImportOptions
): Promise<StageOutcome> {
  const body = new FormData();
  body.append('file', file);
  if (options.programmeId) body.append('programmeId', options.programmeId);
  try {
    const response = await fetch(PROGRAMME_IMPORT_ROUTE, {
      method: 'POST',
      body
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      summary?: StagedImport;
      error?: { code?: string; message?: string };
    };
    if (response.ok && payload.ok && payload.summary)
      return { ok: true, summary: payload.summary };
    return {
      ok: false,
      code: payload.error?.code ?? 'UPLOAD_FAILED',
      message: payload.error?.message ?? 'that file could not be staged'
    };
  } catch {
    return {
      ok: false,
      code: 'UPLOAD_FAILED',
      message: 'that file could not be sent to the server'
    };
  }
}

/**
 * What the model is given about a staged import: the summary, marked as the
 * result of an upload rather than as the file. Sent as an attachment so it
 * travels in the same data-not-instructions envelope as anything else the
 * staff member put in front of it.
 */
function stagedAttachment(summary: StagedImport): Attachment {
  return {
    kind: 'text',
    name: `${summary.filename} (staged import)`.slice(0, 200),
    mediaType: 'text/plain',
    data:
      'This CSV was uploaded to the server and staged as a property import. ' +
      'Its contents were NOT read here; what follows is the summary the ' +
      'import pipeline returned.\n' +
      JSON.stringify(summary, null, 2)
  };
}

export async function readAttachments(
  files: File[],
  alreadyAttached = 0,
  options: ReadOptions = {}
): Promise<ReadResult> {
  const attachments: Attachment[] = [];
  const rejected: AttachmentRejection[] = [];
  let room = Math.max(0, MAX_ATTACHMENTS - alreadyAttached);

  for (const file of files) {
    if (room === 0) {
      rejected.push({
        name: file.name,
        reason: `only ${MAX_ATTACHMENTS} files at a time`
      });
      continue;
    }
    const mediaType = mediaTypeOf(file);

    // A property list goes to the server whole. NOT_A_PROPERTY_LIST is the one
    // refusal that falls through to the ordinary reading path: it means the
    // file is a CSV of something else entirely - a rota, an export someone
    // wants explained - and refusing to read those would be a regression.
    if (
      options.programmeImport &&
      file.name.toLowerCase().endsWith('.csv') &&
      file.size > 0
    ) {
      const staged = await stageProgrammeImport(file, options.programmeImport);
      if (staged.ok) {
        attachments.push(stagedAttachment(staged.summary));
        room -= 1;
        continue;
      }
      if (staged.code !== 'NOT_A_PROPERTY_LIST') {
        rejected.push({ name: file.name, reason: staged.message });
        continue;
      }
    }

    if (!isImage(mediaType) && !isText(mediaType)) {
      rejected.push({ name: file.name, reason: describe(mediaType) });
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({
        name: file.name,
        reason: `too big (limit ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)}MB)`
      });
      continue;
    }
    try {
      if (isImage(mediaType)) {
        attachments.push({
          kind: 'image',
          name: file.name,
          mediaType,
          data: toBase64(await file.arrayBuffer())
        });
      } else {
        const text = (await file.text()).slice(0, MAX_ATTACHMENT_TEXT);
        if (text.trim() === '') {
          rejected.push({ name: file.name, reason: 'the file is empty' });
          continue;
        }
        attachments.push({
          kind: 'text',
          name: file.name,
          mediaType,
          data: text
        });
      }
      room -= 1;
    } catch {
      rejected.push({ name: file.name, reason: 'it could not be read' });
    }
  }
  return { attachments, rejected };
}

/** Files from a drop or a paste, as a plain array. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []);
}

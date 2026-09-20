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

export async function readAttachments(
  files: File[],
  alreadyAttached = 0
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

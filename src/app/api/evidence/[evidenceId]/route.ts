import {
  EVIDENCE_UUID,
  evidenceDownloadName,
  evidenceOpensInline
} from '@/features/operations/evidence-rules';
import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';

// Opens or downloads one evidence file.
//
//   browser -> this route -> public.evidence_open (who may read it, decided
//   from the evidence row: job, work package, category - never the path)
//   -> a signed URL that lives for one minute, minted under the person's own
//   session so Storage applies the same rule again -> redirect.
//
// Nothing permanent is ever handed out or stored, and the signed URL is never
// logged or audited. "Not found" and "not yours" look the same from outside.

const BUCKET = 'evidence';
const URL_SECONDS = 60;

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

type OpenResult = {
  evidence_id: string;
  storage_path: string;
  filename: string | null;
  safe_filename: string;
  mime_type: string | null;
};

const REFUSALS: Record<string, [number, string]> = {
  EVIDENCE_NOT_FOUND: [404, 'That file could not be found.'],
  EVIDENCE_ACCESS_DENIED: [404, 'That file could not be found.'],
  EVIDENCE_NOT_READY: [
    409,
    'That file is still uploading. Try again in a moment.'
  ],
  EVIDENCE_FILE_MISSING: [
    410,
    'The record exists but the stored file is missing. Tell an administrator.'
  ],
  R1A_AUTHENTICATED_EMAIL_REQUIRED: [401, 'Sign in to open this file.'],
  R1A_UNKNOWN_OR_DUPLICATE_ACTOR: [403, 'Your account cannot open files.'],
  R1A_INACTIVE_ACTOR: [403, 'Your account cannot open files.'],
  R1A_NO_ACTIVE_ROLE: [403, 'Your account cannot open files.']
};

const say = (status: number, message: string) =>
  new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> }
) {
  const { evidenceId } = await params;
  if (!EVIDENCE_UUID.test(evidenceId))
    return say(404, REFUSALS.EVIDENCE_NOT_FOUND[1]);
  // A "view as user" preview reads through a token that may not touch Storage.
  if (await previewWriteBlock())
    return say(403, 'Files cannot be opened while previewing another user.');

  const supabase = await createClient();
  const rpc = supabase as unknown as RpcClient;
  const { data, error } = await rpc.rpc('evidence_open', {
    p_evidence_id: evidenceId
  });
  if (error) {
    const code =
      error.code === 'P0001' ? error.message.split(':')[0].trim() : '';
    const refusal = REFUSALS[code];
    if (!refusal)
      console.error('evidence_open failed', error.code, error.message);
    return refusal
      ? say(...refusal)
      : say(500, 'The file could not be opened. Try again.');
  }

  const file = data as OpenResult;
  const download =
    request.nextUrl.searchParams.get('download') === '1' ||
    !evidenceOpensInline(file.mime_type);
  const signed = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      file.storage_path,
      URL_SECONDS,
      download
        ? { download: evidenceDownloadName(file.filename, file.safe_filename) }
        : undefined
    );
  if (signed.error || !signed.data?.signedUrl) {
    // Metadata without a file must not pass silently: the database checks
    // Storage itself and records the finding once.
    const report = await rpc.rpc('evidence_report_missing', {
      p_evidence_id: evidenceId
    });
    const present = (report.data as { file_present?: boolean } | null)
      ?.file_present;
    if (present === false) return say(...REFUSALS.EVIDENCE_FILE_MISSING);
    console.error('evidence signed url failed', signed.error?.message);
    return say(502, 'Storage is unavailable. Try again.');
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: signed.data.signedUrl,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

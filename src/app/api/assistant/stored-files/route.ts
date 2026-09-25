import {
  readStoredFile,
  searchAttachableFiles
} from '@/features/assistant/server/stored-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Attaching a document that is already in Files & documents.
 *
 * Two questions, one handler: `?q=` lists what this person could attach, and
 * `?id=` returns one file's bytes for the browser to rebuild as a File. That
 * File then goes through readAttachments exactly as a dropped one does, so
 * nothing about limits, accepted types or property-list staging is decided
 * twice.
 *
 * A route rather than a server action because assistant client code never
 * imports assistant server code - the boundary is asserted by
 * server/__tests__/security.test.ts, and it is what keeps provider SDKs and
 * storage credentials out of the browser bundle.
 *
 * Authorisation is the file library's own, under the signed-in session: this
 * handler reads no actor, no permission and no storage path from the request.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fileId = params.get('id');

  const body = fileId
    ? await readStoredFile(fileId)
    : await searchAttachableFiles(params.get('q') ?? '');

  return Response.json(body, {
    // A signed download turned into bytes: never store it anywhere.
    status: 'ok' in body && body.ok ? 200 : 400,
    headers: { 'Cache-Control': 'no-store' }
  });
}

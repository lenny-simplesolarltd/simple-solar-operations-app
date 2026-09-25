import { stageProgrammeImport } from '@/features/programmes/server/import-from-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A property list attached in SimpleBot, staged without the model reading it.
 *
 * The bytes arrive here as multipart form data, straight from the browser's
 * File, and go into the PROGRAMME_IMPORT_* commands. They are never put in a
 * model request: the answer is a bounded summary - counts, headings, the
 * mapping and the import id - which is all the model needs to talk about the
 * import and confirm it through apply_programme_import.
 *
 * Everything that decides anything happens in stageProgrammeImport, under the
 * signed-in session. This handler only unpacks the form: no actor, no
 * programme and no permission is read from the request body.
 */

const MAX_FIELD = 300;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'The upload was not valid form data.'
        }
      },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'NO_FILE',
          message: 'Attach the property list as a CSV file.'
        }
      },
      { status: 400 }
    );
  }
  const programmeField = form.get('programmeId');
  const programmeId =
    typeof programmeField === 'string' &&
    programmeField.trim() !== '' &&
    programmeField.length <= MAX_FIELD
      ? programmeField.trim()
      : undefined;

  const result = await stageProgrammeImport({
    filename: file.name.slice(0, MAX_FIELD),
    text: await file.text(),
    sizeBytes: file.size,
    programmeId
  });

  if (!result.ok) {
    const { status, code, message, programmes } = result;
    return Response.json(
      {
        ok: false,
        error: { code, message, ...(programmes && { programmes }) }
      },
      { status }
    );
  }
  return Response.json(
    { ok: true, summary: result.summary },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

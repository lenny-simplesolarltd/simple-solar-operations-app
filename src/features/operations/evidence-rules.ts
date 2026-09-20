// Evidence file rules shared by the upload field and the server boundary.
// They mirror app.evidence_file_types() / app.evidence_max_bytes(); the
// database (and the storage bucket) enforce them - this is only early feedback.

export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

export const EVIDENCE_FILE_TYPES: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic', 'heif'],
  'image/heif': ['heif', 'heic'],
  'application/pdf': ['pdf']
};

export const EVIDENCE_ACCEPT = [
  ...Object.keys(EVIDENCE_FILE_TYPES),
  ...Object.values(EVIDENCE_FILE_TYPES)
    .flat()
    .map((ext) => `.${ext}`)
]
  .filter((v, i, all) => all.indexOf(v) === i)
  .join(',');

/**
 * What an upload is being registered against. The server derives the job (and
 * so the storage path) from it - never from anything the browser names.
 * 'Library' is the one context with no domain object behind it: a company
 * document belongs to no job, and the file.library.manage permission is the
 * whole authorization.
 */
export type EvidenceContext =
  | { type: 'Task' | 'WorkPackage' | 'Delivery' | 'Job'; id: string }
  | { type: 'Library'; id?: undefined };

export const EVIDENCE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extensionOf = (name: string) =>
  /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? null;

/**
 * The MIME type to declare for a chosen file. Some devices report no type for
 * HEIC photos, so an allowed extension may stand in for a missing type - never
 * for a type that is present and not allowed.
 */
export function evidenceMimeType(file: {
  name: string;
  type: string;
}): string | null {
  const declared = file.type.trim().toLowerCase();
  const ext = extensionOf(file.name);
  if (declared) {
    return EVIDENCE_FILE_TYPES[declared]?.includes(ext ?? '') ? declared : null;
  }
  if (!ext) return null;
  return (
    Object.keys(EVIDENCE_FILE_TYPES).find(
      (mime) => EVIDENCE_FILE_TYPES[mime][0] === ext
    ) ??
    Object.keys(EVIDENCE_FILE_TYPES).find((mime) =>
      EVIDENCE_FILE_TYPES[mime].includes(ext)
    ) ??
    null
  );
}

/** Why a chosen file cannot be uploaded, or null when it can. */
export function evidenceFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name.trim()) return 'Choose a file with a name.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > EVIDENCE_MAX_BYTES) return 'Files must be 25 MB or smaller.';
  if (!evidenceMimeType(file))
    return 'Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added.';
  return null;
}

/** Files a browser can show in a tab without running anything. */
export function evidenceOpensInline(mimeType: string | null | undefined) {
  return !!mimeType && mimeType.toLowerCase() in EVIDENCE_FILE_TYPES;
}

/** A download name that cannot break out of a Content-Disposition header. */
export function evidenceDownloadName(
  name: string | null | undefined,
  fallback: string
) {
  const clean = (name ?? '')
    .replace(/^.*[/\\]/, '')
    .replace(/[\u0000-\u001f\u007f"\\;%]+/g, '')
    .trim()
    .slice(-150);
  return clean || fallback;
}

const CATEGORY_LABELS: Record<string, string> = {
  Contract: 'Signed contract',
  CustomerDetails: 'Customer details',
  FinanceAgreement: 'Finance agreement',
  TaskEvidence: 'Task evidence',
  DeliveryNote: 'Delivery note',
  Progress: 'Progress photo',
  Completion: 'Completion photo',
  Commissioning: 'Commissioning',
  Problem: 'Problem',
  Variation: 'Variation',
  Return: 'Return visit',
  Other: 'Other'
};

export const evidenceCategoryLabel = (category: string) =>
  CATEGORY_LABELS[category] ?? category;

export function formatBytes(size: number | null | undefined) {
  if (!size || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

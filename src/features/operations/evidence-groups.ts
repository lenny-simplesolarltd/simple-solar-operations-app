// Staff-facing groups for evidence files. The database stores one category per
// file (app.evidence_categories()); staff think in a handful of groups, so the
// Files library, the job Files tab and SimpleBot all sort files the same way.
// Safe to import from client components.

export const EVIDENCE_GROUPS = [
  { key: 'contracts', label: 'Contracts', categories: ['Contract'] },
  {
    key: 'customer-finance',
    label: 'Customer & finance',
    categories: ['CustomerDetails', 'FinanceAgreement']
  },
  { key: 'task', label: 'Task documents', categories: ['TaskEvidence'] },
  {
    key: 'photos',
    label: 'Photos & installation',
    categories: ['Progress', 'Completion', 'Variation', 'Return']
  },
  {
    key: 'commissioning',
    label: 'Commissioning',
    categories: ['Commissioning']
  },
  { key: 'issues', label: 'Issues', categories: ['Problem'] },
  {
    key: 'materials',
    label: 'Materials & delivery',
    categories: ['DeliveryNote']
  },
  { key: 'other', label: 'Other', categories: ['Other'] }
] as const satisfies readonly {
  key: string;
  label: string;
  categories: readonly string[];
}[];

export type EvidenceGroupKey = (typeof EVIDENCE_GROUPS)[number]['key'];

const GROUP_BY_KEY = new Map(EVIDENCE_GROUPS.map((g) => [g.key, g]));

/**
 * The group a file belongs to. A file raised against an issue is an Issues
 * file whatever its category; an unknown category falls into Other.
 */
export function evidenceGroupKey(file: {
  category: string | null | undefined;
  issue_id?: string | null;
}): EvidenceGroupKey {
  if (file.issue_id) return 'issues';
  const group = EVIDENCE_GROUPS.find((g) =>
    (g.categories as readonly string[]).includes(file.category ?? '')
  );
  return group?.key ?? 'other';
}

export const evidenceGroupLabel = (key: EvidenceGroupKey) =>
  GROUP_BY_KEY.get(key)?.label ?? 'Other';

/** A group key from a search parameter, or null when it is not one. */
export function parseEvidenceGroup(
  value: string | null | undefined
): EvidenceGroupKey | null {
  return value && GROUP_BY_KEY.has(value as EvidenceGroupKey)
    ? (value as EvidenceGroupKey)
    : null;
}

/** The categories of a group (what the Files library filters by). */
export const evidenceGroupCategories = (
  key: EvidenceGroupKey
): readonly string[] => GROUP_BY_KEY.get(key)?.categories ?? [];

/**
 * Files split into their groups, in the fixed group order, keeping each
 * group's files in the order given. Empty groups are left out.
 */
export function groupEvidence<
  T extends { category: string | null | undefined; issue_id?: string | null }
>(files: readonly T[]): { key: EvidenceGroupKey; label: string; files: T[] }[] {
  const buckets = new Map<EvidenceGroupKey, T[]>();
  for (const file of files) {
    const key = evidenceGroupKey(file);
    const list = buckets.get(key);
    if (list) list.push(file);
    else buckets.set(key, [file]);
  }
  return EVIDENCE_GROUPS.filter((g) => buckets.has(g.key)).map((g) => ({
    key: g.key,
    label: g.label,
    files: buckets.get(g.key)!
  }));
}

/**
 * Categories staff may choose when adding a file straight to a job
 * (evidence_upload_begin, Job context). Task evidence and return visits are
 * added from their own task or visit instead.
 */
export const JOB_UPLOAD_CATEGORIES = [
  'Contract',
  'CustomerDetails',
  'FinanceAgreement',
  'Progress',
  'Completion',
  'Commissioning',
  'Problem',
  'Variation',
  'DeliveryNote',
  'Other'
] as const;

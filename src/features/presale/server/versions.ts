import 'server-only';

import { readOps } from '@/lib/backend/read';
import { createDataClient } from '@/lib/supabase/data';

/**
 * A job's quote, version by version, with everything the customer was quoted.
 *
 * Two sources, deliberately:
 *
 *   PRESALE_VERSIONS  the registry read model. It owns the ORDER, the
 *                     customer-facing label ("Quote 2", "Quote 2c") and which
 *                     version is current, and it applies the job's own
 *                     visibility rules. Nothing here re-derives a label.
 *   public.presales   the columns the read model does not carry - the notes,
 *                     the computed total and the price breakdown - read under
 *                     the signed-in person's session, so presales_select
 *                     decides what comes back exactly as it does for the
 *                     presale screen.
 *
 * They are joined on presale_id. A row present in one and absent from the
 * other is dropped rather than half-filled: a quote shown with a blank price
 * breakdown reads like a quote with no extras on it.
 */

export interface QuoteBreakdownRow {
  key: string;
  label: string;
  pence: number;
}

export interface QuoteVersion {
  presaleId: string;
  /** "Quote 2" / "Quote 2c", as the read model labels it. */
  label: string;
  quoteNumber: number;
  correctionNumber: number;
  isCurrent: boolean;
  submittedAt: string;
  supersededAt: string | null;
  revisionReason: string | null;
  surveyor: string | null;
  systemKwp: number;
  netPanels: number;
  agreedPricePence: number;
  computedTotalPence: number | null;
  priceBreakdown: QuoteBreakdownRow[];
  roofNotes: string | null;
  electricalNotes: string | null;
  catalogueVersion: string | null;
  designSchemaVersion: number | null;
}

interface VersionsRead {
  versions: {
    presale_id: string;
    quote_number: number;
    correction_number: number;
    quote_label: string;
    is_current: boolean;
    submitted_at: string;
    system_kwp: number | string;
    net_panels: number;
    agreed_price_pence: number;
    revision_reason: string | null;
    superseded_at: string | null;
    surveyor: string | null;
  }[];
}

type PresaleRow = {
  id: string;
  computed_total_pence: number | null;
  price_breakdown: unknown;
  roof_notes: string | null;
  electrical_notes: string | null;
  catalogue_version: string | null;
  design_schema_version: number | null;
};

const breakdown = (raw: unknown): QuoteBreakdownRow[] =>
  Array.isArray(raw)
    ? (raw as QuoteBreakdownRow[]).filter(
        (r) => r && typeof r.label === 'string' && typeof r.pence === 'number'
      )
    : [];

export type QuoteVersionsResult =
  | { ok: true; versions: QuoteVersion[] }
  | { ok: false; code: string; message: string };

/** Every version of a job's quote, newest first. Empty when the job has no presale. */
export async function getQuoteVersions(
  jobId: string
): Promise<QuoteVersionsResult> {
  const read = await readOps<VersionsRead>('PRESALE_VERSIONS', {
    job_id: jobId
  });
  if (!read.ok) {
    return {
      ok: false,
      code: read.error.code ?? 'PRESALE_READ_FAILED',
      message: read.error.message
    };
  }
  const versions = read.data.versions ?? [];
  if (versions.length === 0) return { ok: true, versions: [] };

  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('presales')
    .select(
      'id, computed_total_pence, price_breakdown, roof_notes, electrical_notes, catalogue_version, design_schema_version'
    )
    .in(
      'id',
      versions.map((v) => v.presale_id)
    );
  if (error) throw new Error(`quote versions: ${error.message}`);
  const details = new Map(
    ((data ?? []) as unknown as PresaleRow[]).map((r) => [r.id, r])
  );

  return {
    ok: true,
    versions: versions.flatMap((v) => {
      const d = details.get(v.presale_id);
      if (!d) return [];
      return [
        {
          presaleId: v.presale_id,
          label: v.quote_label,
          quoteNumber: v.quote_number,
          correctionNumber: v.correction_number,
          isCurrent: v.is_current,
          submittedAt: v.submitted_at,
          supersededAt: v.superseded_at,
          revisionReason: v.revision_reason,
          surveyor: v.surveyor,
          systemKwp: Number(v.system_kwp),
          netPanels: v.net_panels,
          agreedPricePence: v.agreed_price_pence,
          computedTotalPence: d.computed_total_pence,
          priceBreakdown: breakdown(d.price_breakdown),
          roofNotes: d.roof_notes,
          electricalNotes: d.electrical_notes,
          catalogueVersion: d.catalogue_version,
          designSchemaVersion: d.design_schema_version
        } satisfies QuoteVersion
      ];
    })
  };
}

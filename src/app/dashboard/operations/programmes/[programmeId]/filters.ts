import type { VisitFilters } from '@/features/programmes/types';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  VISIT_OUTCOMES
} from '@/features/programmes/types';

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

const one = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The filters the URL is carrying.
 *
 * Read here rather than in each page so the dashboard, the list, the board and
 * the CSV export all read the same query string the same way - and so an
 * unrecognised value is dropped rather than passed to the database, which would
 * refuse the whole read.
 */
export function filtersFromParams(
  params: Record<string, string | string[] | undefined>
): VisitFilters {
  const filters: VisitFilters = {};
  const from = one(params.from);
  const to = one(params.to);
  const installer = one(params.installer);
  const outcome = one(params.outcome);
  const disposition = one(params.disposition);
  const signal = one(params.signal);
  const portal = one(params.portal);
  const postcode = one(params.postcode);

  if (DATE.test(from)) filters.from = from;
  if (DATE.test(to)) filters.to = to;
  if (UUID.test(installer)) filters.installer_id = installer;
  if ((VISIT_OUTCOMES as readonly string[]).includes(outcome))
    filters.outcome = outcome as VisitFilters['outcome'];
  if ((DISPOSITIONS as readonly string[]).includes(disposition))
    filters.disposition = disposition as VisitFilters['disposition'];
  if (['Good', 'Advisory', 'Bad'].includes(signal))
    filters.signal_classification =
      signal as VisitFilters['signal_classification'];
  if ((PORTAL_VERIFICATIONS as readonly string[]).includes(portal))
    filters.portal_verification = portal as VisitFilters['portal_verification'];
  if (/^[A-Za-z0-9 ]{1,8}$/.test(postcode)) filters.postcode = postcode;
  return filters;
}

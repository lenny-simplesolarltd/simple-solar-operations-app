import type { VisitFilters, VisitListQuery } from '@/features/programmes/types';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  REVIEW_STATUSES,
  VISIT_OUTCOMES
} from '@/features/programmes/types';

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

const one = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/** Rows per page. Small enough to render, large enough to work a day from. */
export const PAGE_SIZE = 100;

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
): VisitListQuery {
  const filters: VisitListQuery = {};
  const from = one(params.from);
  const to = one(params.to);
  const installer = one(params.installer);
  const outcome = one(params.outcome);
  const disposition = one(params.disposition);
  const signal = one(params.signal);
  const portal = one(params.portal);
  const postcode = one(params.postcode);
  const status = one(params.status);
  const text = one(params.q);
  const page = Number.parseInt(one(params.page), 10);

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
  // Review status was reachable only from inside the review screen, so "show me
  // everything still awaiting review" could not be linked to or bookmarked.
  if ((REVIEW_STATUSES as readonly string[]).includes(status))
    filters.review_status = status as VisitFilters['review_status'];
  if (text) filters.query = text.slice(0, 80);
  filters.limit = PAGE_SIZE;
  filters.offset =
    Number.isFinite(page) && page > 1 ? (page - 1) * PAGE_SIZE : 0;
  return filters;
}

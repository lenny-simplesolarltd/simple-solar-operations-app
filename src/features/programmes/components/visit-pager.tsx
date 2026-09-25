import { PAGE_SIZE } from '@/app/dashboard/operations/programmes/[programmeId]/filters';
import type { VisitPage } from '../types';
import Link from 'next/link';

/**
 * "Showing 1–100 of 1,427", and the way to the rest of it.
 *
 * The count is the database's count of the rows matching these filters, not the
 * length of the page — the two used to be conflated, so a programme with 1,400
 * visits reported 500 and nobody could tell it was lying.
 *
 * Every link carries the current filters forward, because a page number without
 * its filters points at a different set of rows.
 */
export function VisitPager({
  page,
  params
}: {
  page: VisitPage;
  params: Record<string, string | string[] | undefined>;
}) {
  const { total, offset, visits } = page;
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + visits.length;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const current = Math.floor(offset / PAGE_SIZE) + 1;

  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const one = Array.isArray(v) ? v[0] : v;
      if (one && k !== 'page') q.set(k, one);
    }
    if (n > 1) q.set('page', String(n));
    const s = q.toString();
    return s ? `?${s}` : '?';
  };

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-3'>
      <p className='text-muted-foreground text-sm tabular-nums'>
        {total === 0
          ? 'No visits match these filters.'
          : `Showing ${first.toLocaleString('en-GB')}–${last.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`}
      </p>
      {pages > 1 && (
        <nav aria-label='Pages' className='flex items-center gap-2 text-sm'>
          {current > 1 ? (
            <Link
              href={href(current - 1)}
              className='hover:bg-accent rounded-md border px-3 py-1.5'
            >
              Previous
            </Link>
          ) : (
            <span className='text-muted-foreground rounded-md border px-3 py-1.5'>
              Previous
            </span>
          )}
          <span className='tabular-nums'>
            Page {current.toLocaleString('en-GB')} of{' '}
            {pages.toLocaleString('en-GB')}
          </span>
          {current < pages ? (
            <Link
              href={href(current + 1)}
              className='hover:bg-accent rounded-md border px-3 py-1.5'
            >
              Next
            </Link>
          ) : (
            <span className='text-muted-foreground rounded-md border px-3 py-1.5'>
              Next
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

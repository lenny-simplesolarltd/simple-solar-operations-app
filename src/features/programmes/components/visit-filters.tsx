'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  SIGNAL_LABEL
} from '../labels';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  REVIEW_STATUSES,
  VISIT_OUTCOMES
} from '../types';

/** Plain words for a review status; the enum names are not for reading. */
const REVIEW_LABEL: Record<string, string> = {
  Draft: 'Draft',
  AwaitingReview: 'Awaiting review',
  Reviewed: 'Reviewed'
};

/**
 * The filters, held in the URL.
 *
 * In the URL rather than in component state so a filtered view can be shared,
 * bookmarked and reloaded - and so the CSV export can be given exactly the
 * filters the screen is showing.
 *
 * Nine controls in one row meant the four that get used every day - search, the
 * dates, the installer, what happened - were no easier to find than the ones
 * used once a month. The rest are behind "More filters", which opens by itself
 * whenever one of them is actually set, so a shared link never hides the filter
 * that is shaping what you are looking at.
 */
export function VisitFilterBar({
  installers,
  showDisposition = true,
  /**
   * Off on the overview. The aggregate reads filter by column, not by free
   * text, so a search box there would quietly not be applied to the figures
   * beside it - and a filter that does not filter is worse than no filter.
   */
  showSearch = true
}: {
  installers: { id: string; name: string }[];
  showDisposition?: boolean;
  showSearch?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // A new question starts at its first page; keeping "page=7" would show an
      // empty screen and look like no results.
      next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const value = (key: string) => params.get(key) ?? '';
  const SECONDARY = ['signal', 'portal', 'status', 'postcode'];
  const secondaryActive = SECONDARY.filter((k) => params.get(k));
  const [showMore, setShowMore] = useState(false);
  const moreOpen = showMore || secondaryActive.length > 0;
  const active = [
    'from',
    'to',
    'installer',
    'outcome',
    'disposition',
    'signal',
    'portal',
    'postcode',
    'status',
    'q'
  ].some((k) => params.get(k));

  const select = (
    key: string,
    label: string,
    options: { value: string; label: string }[]
  ) => (
    <label className='flex flex-col gap-1'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      <select
        value={value(key)}
        onChange={(e) => set(key, e.target.value)}
        className='border-input bg-background h-10 min-w-36 rounded-md border px-2 text-sm'
      >
        <option value=''>Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className='flex flex-wrap items-end gap-3'>
      {/* One box for the things Office is actually handed on the phone: an
          address, a postcode, a PCH reference, a meter or SIM serial. */}
      {showSearch && (
        <label className='flex flex-col gap-1'>
          <span className='text-muted-foreground text-xs font-medium'>
            Search
          </span>
          <Input
            type='search'
            defaultValue={value('q')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') set('q', e.currentTarget.value.trim());
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== value('q'))
                set('q', e.currentTarget.value.trim());
            }}
            placeholder='Address, postcode, PCH ID, serial'
            className='h-10 w-60'
          />
        </label>
      )}
      <label className='flex flex-col gap-1'>
        <span className='text-muted-foreground text-xs font-medium'>From</span>
        <Input
          type='date'
          value={value('from')}
          onChange={(e) => set('from', e.target.value)}
          className='h-10 w-40'
        />
      </label>
      <label className='flex flex-col gap-1'>
        <span className='text-muted-foreground text-xs font-medium'>To</span>
        <Input
          type='date'
          value={value('to')}
          onChange={(e) => set('to', e.target.value)}
          className='h-10 w-40'
        />
      </label>
      {select(
        'installer',
        'Installer',
        installers.map((i) => ({ value: i.id, label: i.name }))
      )}
      {select(
        'outcome',
        'Outcome',
        VISIT_OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))
      )}
      {showDisposition &&
        select(
          'disposition',
          'Status',
          DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABEL[d] }))
        )}
      <Button
        type='button'
        variant='outline'
        className='h-10'
        aria-expanded={moreOpen}
        onClick={() => setShowMore((v) => !v)}
      >
        {moreOpen ? 'Fewer filters' : 'More filters'}
        {secondaryActive.length > 0 && ` (${secondaryActive.length})`}
      </Button>
      {active && (
        <Button
          type='button'
          variant='ghost'
          className='h-10'
          onClick={() => router.replace(pathname, { scroll: false })}
        >
          Clear filters
        </Button>
      )}

      {moreOpen && (
        <div className='flex w-full flex-wrap items-end gap-3 border-t pt-3'>
          {select(
            'signal',
            'CSQ band',
            (['Good', 'Advisory', 'Bad'] as const).map((s) => ({
              value: s,
              label: SIGNAL_LABEL[s]
            }))
          )}
          {showDisposition &&
            select(
              'status',
              'Review',
              REVIEW_STATUSES.map((r) => ({ value: r, label: REVIEW_LABEL[r] }))
            )}
          {select(
            'portal',
            'Portal',
            PORTAL_VERIFICATIONS.map((p) => ({
              value: p,
              label: PORTAL_LABEL[p]
            }))
          )}
          <label className='flex flex-col gap-1'>
            <span className='text-muted-foreground text-xs font-medium'>
              Postcode area
            </span>
            <Input
              value={value('postcode')}
              onChange={(e) => set('postcode', e.target.value)}
              placeholder='EX1'
              className='h-10 w-28'
            />
          </label>
        </div>
      )}
    </div>
  );
}

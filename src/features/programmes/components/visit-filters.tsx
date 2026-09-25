'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  SIGNAL_LABEL
} from '../labels';
import { DISPOSITIONS, PORTAL_VERIFICATIONS, VISIT_OUTCOMES } from '../types';

/**
 * The filters, held in the URL.
 *
 * In the URL rather than in component state so a filtered view can be shared,
 * bookmarked and reloaded - and so the CSV export can be given exactly the
 * filters the screen is showing.
 */
export function VisitFilterBar({
  installers,
  showDisposition = true
}: {
  installers: { id: string; name: string }[];
  showDisposition?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const value = (key: string) => params.get(key) ?? '';
  const active = [
    'from',
    'to',
    'installer',
    'outcome',
    'disposition',
    'signal',
    'portal',
    'postcode'
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
      {select(
        'signal',
        'CSQ band',
        (['Good', 'Advisory', 'Bad'] as const).map((s) => ({
          value: s,
          label: SIGNAL_LABEL[s]
        }))
      )}
      {select(
        'portal',
        'Portal',
        PORTAL_VERIFICATIONS.map((p) => ({ value: p, label: PORTAL_LABEL[p] }))
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
    </div>
  );
}

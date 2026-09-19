'use client';

import {
  SearchFilter,
  SegmentedFilter
} from '@/features/operations/filter-controls';
import { useUrlFilters } from '@/features/operations/use-url-filters';
import { IconLoader2 } from '@tabler/icons-react';
import { BOOKING_TABS } from '../tabs';

export function BookingTabs({
  counts
}: {
  counts: Partial<Record<string, number>>;
}) {
  const { get, set, pending } = useUrlFilters({ view: 'ready' });
  const view = get('view');
  return (
    <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
      <SegmentedFilter
        label='Booking step'
        value={view}
        onChange={(v) => set({ view: v, q: null })}
        options={BOOKING_TABS.map((t) => ({
          ...t,
          count: counts[t.value] ?? null
        }))}
      />
      <div className='flex items-center gap-2'>
        {pending && (
          <IconLoader2 className='text-muted-foreground size-4 animate-spin' />
        )}
        <SearchFilter
          className='w-full lg:w-72'
          placeholder='Search job, customer, postcode'
          value={get('q')}
          onCommit={(q) => set({ q })}
        />
      </div>
    </div>
  );
}

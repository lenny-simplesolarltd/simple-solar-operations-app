'use client';

import { Button } from '@/components/ui/button';
import {
  SearchFilter,
  SegmentedFilter,
  SelectFilter
} from '@/features/operations/filter-controls';
import { useUrlFilters } from '@/features/operations/use-url-filters';
import { WORKFLOW_STAGES, type JobsView } from '@/lib/backend/models';
import { IconLoader2, IconX } from '@tabler/icons-react';
import { STAGE_LABEL } from '../stages';

export function JobFilterBar({
  counts
}: {
  counts?: Record<JobsView, number>;
}) {
  const { get, set, pending } = useUrlFilters();
  const stage = get('stage');
  const view = (get('view') || 'active') as JobsView;
  // A comma list (e.g. from an Office Home card) shows as a custom choice.
  const custom = stage.includes(',');
  return (
    <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center'>
      <SegmentedFilter
        label='Which jobs'
        value={view}
        // Changing view resets paging; the stage filter only means something
        // for live work, so it is cleared when leaving the operational queue.
        onChange={(v) =>
          set({
            view: v === 'active' ? null : v,
            page: null,
            ...(v === 'active' ? {} : { stage: null })
          })
        }
        options={[
          { value: 'active', label: 'Active', count: counts?.active },
          {
            value: 'historical',
            label: 'Historical',
            count: counts?.historical
          },
          { value: 'all', label: 'All', count: counts?.all }
        ]}
      />
      <SearchFilter
        className='sm:w-80'
        placeholder='Job ref, customer, postcode, quote, phone'
        value={get('q')}
        onCommit={(q) => set({ q })}
      />
      {/* Workflow stage is a property of live work; archived records sit
          outside it, so the filter is offered only on the operational queue. */}
      {view === 'active' && (
        <SelectFilter
          label='Stage'
          allLabel='All stages'
          className='sm:w-56'
          value={stage}
          onChange={(v) => set({ stage: v })}
          options={[
            ...(custom ? [{ value: stage, label: 'Selected stages' }] : []),
            ...WORKFLOW_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))
          ]}
        />
      )}
      {(get('q') || stage) && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => set({ q: null, stage: null })}
        >
          <IconX /> Clear
        </Button>
      )}
      {pending && (
        <IconLoader2 className='text-muted-foreground size-4 animate-spin' />
      )}
    </div>
  );
}

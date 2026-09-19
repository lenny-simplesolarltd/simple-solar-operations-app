'use client';

import { Button } from '@/components/ui/button';
import {
  SearchFilter,
  SegmentedFilter,
  SelectFilter
} from '@/features/operations/filter-controls';
import { useUrlFilters } from '@/features/operations/use-url-filters';
import { TASK_QUEUES } from '@/lib/backend/models';
import { IconLoader2, IconX } from '@tabler/icons-react';
import {
  DUE_OPTIONS,
  QUEUE_LABELS,
  STATUS_OPTIONS,
  TEAM_QUEUE_CHIPS
} from '../filters';

const DEFAULTS = { scope: 'my', status: 'open', due: 'any' };

export function TaskFilterBar({
  canViewTeam,
  staff
}: {
  canViewTeam: boolean;
  staff: { id: string; name: string }[];
}) {
  const { get, set, pending } = useUrlFilters(DEFAULTS);
  const scope = get('scope');
  const active =
    ['q', 'queue', 'owner'].some((k) => get(k)) ||
    get('status') !== 'open' ||
    get('due') !== 'any';

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {canViewTeam && (
          <SegmentedFilter
            label='Whose tasks'
            value={scope}
            onChange={(v) => set({ scope: v, owner: null })}
            options={[
              { value: 'my', label: 'My tasks' },
              { value: 'team', label: 'Team tasks' },
              { value: 'all', label: 'Everyone' }
            ]}
          />
        )}
        <SegmentedFilter
          label='Status'
          value={get('status')}
          onChange={(v) => set({ status: v })}
          options={STATUS_OPTIONS}
        />
        {pending && (
          <IconLoader2 className='text-muted-foreground size-4 animate-spin' />
        )}
      </div>
      {scope === 'all' && canViewTeam && (
        <SegmentedFilter
          label='Queue'
          value={get('queue')}
          onChange={(v) => set({ queue: v })}
          options={[
            { value: '', label: 'All queues' },
            ...TEAM_QUEUE_CHIPS.map((q) => ({
              value: q,
              label: QUEUE_LABELS[q]
            }))
          ]}
        />
      )}
      <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center'>
        <SearchFilter
          className='sm:w-64'
          placeholder='Search task, job, customer, postcode'
          value={get('q')}
          onCommit={(q) => set({ q })}
        />
        <SelectFilter
          label='Due'
          value={get('due')}
          onChange={(v) => set({ due: v || 'any' })}
          options={DUE_OPTIONS}
        />
        <SelectFilter
          label='Queue'
          allLabel='All queues'
          value={get('queue')}
          onChange={(v) => set({ queue: v })}
          options={TASK_QUEUES.map((q) => ({
            value: q,
            label: QUEUE_LABELS[q]
          }))}
        />
        {scope !== 'my' && staff.length > 0 && (
          <SelectFilter
            label='Owner'
            allLabel='Any owner'
            value={get('owner')}
            onChange={(v) => set({ owner: v })}
            options={staff.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        {active && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() =>
              set({
                q: null,
                queue: null,
                owner: null,
                status: null,
                due: null
              })
            }
          >
            <IconX /> Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

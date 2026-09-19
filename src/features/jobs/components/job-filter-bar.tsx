'use client';

import { Button } from '@/components/ui/button';
import {
  SearchFilter,
  SelectFilter
} from '@/features/operations/filter-controls';
import { useUrlFilters } from '@/features/operations/use-url-filters';
import { WORKFLOW_STAGES } from '@/lib/backend/models';
import { IconLoader2, IconX } from '@tabler/icons-react';
import { STAGE_LABEL } from '../stages';

export function JobFilterBar() {
  const { get, set, pending } = useUrlFilters();
  const stage = get('stage');
  // A comma list (e.g. from an Office Home card) shows as a custom choice.
  const custom = stage.includes(',');
  return (
    <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center'>
      <SearchFilter
        className='sm:w-80'
        placeholder='Job ref, customer, postcode, quote, phone'
        value={get('q')}
        onCommit={(q) => set({ q })}
      />
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

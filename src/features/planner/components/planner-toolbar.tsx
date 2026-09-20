'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconSearch,
  IconX
} from '@tabler/icons-react';
import type { EventKind, PlannerFilters } from '../calendar/events';
import {
  KIND_LABEL,
  SCAFFOLD_KINDS,
  WORK_KINDS,
  filtersActive
} from '../calendar/events';
import type { Day, ViewId } from '../calendar/range';
import { VIEWS, windowTitle } from '../calendar/range';

const STATUSES = [
  'Unscheduled',
  'Scheduled',
  'InProgress',
  'ReportedComplete',
  'ConfirmedComplete',
  'ReturnRequired'
];

/** Navigation, view choice and filters. Every control is a real button. */
export function PlannerToolbar({
  view,
  anchor,
  filters,
  people,
  onView,
  onAnchor,
  onToday,
  onStep,
  onFilters
}: {
  view: ViewId;
  anchor: Day;
  filters: PlannerFilters;
  people: { id: string; name: string }[];
  onView: (view: ViewId) => void;
  onAnchor: (day: Day) => void;
  onToday: () => void;
  onStep: (direction: 1 | -1) => void;
  onFilters: (filters: PlannerFilters) => void;
}) {
  const toggle = <K extends 'kinds' | 'statuses' | 'people'>(
    key: K,
    value: string
  ) => {
    const current = filters[key] as string[];
    onFilters({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
    });
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            size='icon'
            onClick={() => onStep(-1)}
            aria-label='Previous'
          >
            <IconChevronLeft />
          </Button>
          <Button variant='outline' onClick={onToday}>
            Today
          </Button>
          <Button
            variant='outline'
            size='icon'
            onClick={() => onStep(1)}
            aria-label='Next'
          >
            <IconChevronRight />
          </Button>
        </div>

        <label className='sr-only' htmlFor='planner-date'>
          Jump to date
        </label>
        <div className='relative'>
          <IconCalendar className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2' />
          <Input
            id='planner-date'
            type='date'
            value={anchor}
            onChange={(e) => e.target.value && onAnchor(e.target.value)}
            className='w-40 pl-8'
          />
        </div>

        <h2 className='text-base font-semibold'>{windowTitle(view, anchor)}</h2>

        <div
          role='tablist'
          aria-label='Planner view'
          className='bg-muted ml-auto flex rounded-lg p-0.5'
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role='tab'
              aria-selected={view === v.id}
              onClick={() => onView(v.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm transition-colors sm:px-3',
                view === v.id
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className='hidden sm:inline'>{v.label}</span>
              <span className='sm:hidden'>{v.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-48 flex-1 sm:max-w-xs'>
          <IconSearch className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2' />
          <Input
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
            placeholder='Customer, job reference, installer…'
            aria-label='Search the planner'
            className='pl-8'
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant='outline'>
              <IconFilter /> Filters
              {filtersActive(filters) && (
                <Badge variant='secondary' className='ml-1'>
                  on
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align='start' className='w-72'>
            <div className='flex flex-col gap-3 text-sm'>
              <FilterGroup label='Work type'>
                {[...WORK_KINDS, ...SCAFFOLD_KINDS].map((kind) => (
                  <Chip
                    key={kind}
                    active={filters.kinds.includes(kind)}
                    onClick={() => toggle('kinds', kind)}
                  >
                    {KIND_LABEL[kind as EventKind]}
                  </Chip>
                ))}
              </FilterGroup>

              <Separator />

              <FilterGroup label='Status'>
                {STATUSES.map((s) => (
                  <Chip
                    key={s}
                    active={filters.statuses.includes(s)}
                    onClick={() => toggle('statuses', s)}
                  >
                    {s}
                  </Chip>
                ))}
              </FilterGroup>

              {people.length > 0 && (
                <>
                  <Separator />
                  <FilterGroup label='Installer'>
                    {people.map((p) => (
                      <Chip
                        key={p.id}
                        active={filters.people.includes(p.id)}
                        onClick={() => toggle('people', p.id)}
                      >
                        {p.name}
                      </Chip>
                    ))}
                  </FilterGroup>
                </>
              )}

              <Separator />

              <FilterGroup label='Attention'>
                <Chip
                  active={filters.unallocatedOnly}
                  onClick={() =>
                    onFilters({
                      ...filters,
                      unallocatedOnly: !filters.unallocatedOnly
                    })
                  }
                >
                  Nobody allocated
                </Chip>
                <Chip
                  active={filters.scaffoldUnacknowledgedOnly}
                  onClick={() =>
                    onFilters({
                      ...filters,
                      scaffoldUnacknowledgedOnly:
                        !filters.scaffoldUnacknowledgedOnly
                    })
                  }
                >
                  Scaffold not acknowledged
                </Chip>
              </FilterGroup>
            </div>
          </PopoverContent>
        </Popover>

        {filtersActive(filters) && (
          <Button
            variant='ghost'
            onClick={() =>
              onFilters({
                query: '',
                people: [],
                kinds: [],
                statuses: [],
                unallocatedOnly: false,
                scaffoldUnacknowledgedOnly: false
              })
            }
          >
            <IconX /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className='flex flex-col gap-1.5'>
      <legend className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
        {label}
      </legend>
      <div className='flex flex-wrap gap-1'>{children}</div>
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

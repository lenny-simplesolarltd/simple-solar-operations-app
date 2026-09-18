'use client';

import { IconLoader2 } from '@tabler/icons-react';
import { SearchFilter, SegmentedFilter, SelectFilter } from './filter-controls';
import { useUrlFilters } from './use-url-filters';

type Option = { value: string; label: string; count?: number | null };

/**
 * The common list toolbar: URL tabs, optional selects and a search box. Every
 * value lives in the URL so the view can be bookmarked or linked to.
 */
export function ListFilters({
  defaults = {},
  tabs,
  selects = [],
  searchPlaceholder,
  searchKey = 'q'
}: {
  defaults?: Record<string, string>;
  tabs?: { key: string; label: string; options: Option[] };
  selects?: {
    key: string;
    label: string;
    allLabel?: string;
    options: Option[];
  }[];
  searchPlaceholder?: string;
  searchKey?: string;
}) {
  const { get, set, pending } = useUrlFilters(defaults);
  return (
    <div className='flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center'>
      {tabs && (
        <SegmentedFilter
          label={tabs.label}
          value={get(tabs.key)}
          onChange={(v) => set({ [tabs.key]: v })}
          options={tabs.options}
        />
      )}
      {selects.map((s) => (
        <SelectFilter
          key={s.key}
          label={s.label}
          allLabel={s.allLabel}
          value={get(s.key)}
          onChange={(v) => set({ [s.key]: v })}
          options={s.options}
        />
      ))}
      {searchPlaceholder && (
        <SearchFilter
          className='w-full lg:w-72'
          placeholder={searchPlaceholder}
          value={get(searchKey)}
          onCommit={(v) => set({ [searchKey]: v })}
        />
      )}
      {pending && (
        <IconLoader2 className='text-muted-foreground size-4 animate-spin' />
      )}
    </div>
  );
}

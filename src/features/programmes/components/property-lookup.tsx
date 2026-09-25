'use client';

import { Input } from '@/components/ui/input';
import type { FieldControlProps } from '@/features/forms/components/form-renderer';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { IconCheck, IconLoader2, IconSearch } from '@tabler/icons-react';
import { useEffect, useId, useState } from 'react';
import { searchPropertiesAction } from '../server/lookup';
import type { ProgrammeProperty } from '../types';

/**
 * The property lookup for a visit form.
 *
 * One box, matched against the address, the postcode, the client's reference and
 * the expected meter serial - whichever of the four the person happens to have in
 * front of them. The search runs under RLS, so it can only ever offer properties
 * this person is allowed to visit.
 *
 * Choosing a property is what a visit is FOR, so once it is chosen the form shows
 * what was chosen rather than leaving a search box that could be changed by
 * accident; "Change property" is a deliberate act.
 */
export function PropertyLookupField({
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  programmeId,
  initial,
  locked,
  onPick
}: FieldControlProps<string | undefined> & {
  programmeId: string;
  /** Already known (e.g. arrived from the property list), so no search is needed. */
  initial?: ProgrammeProperty | null;
  /** True once the visit has started: the property is fixed for this visit. */
  locked?: boolean;
  onPick?: (property: ProgrammeProperty | null) => void;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);
  const [results, setResults] = useState<ProgrammeProperty[] | null>(null);
  const [chosen, setChosen] = useState<ProgrammeProperty | null>(
    initial ?? null
  );
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (initial && initial.id !== chosen?.id) {
      setChosen(initial);
      onChange(initial.id);
    }
    // Only when the server hands down a different property.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);

  useEffect(() => {
    if (chosen || debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    setSearching(true);
    void searchPropertiesAction(programmeId, debounced.trim()).then((r) => {
      if (!live) return;
      setSearching(false);
      if (r.ok) setResults(r.properties);
      else setProblem(r.message);
    });
    return () => {
      live = false;
    };
  }, [debounced, programmeId, chosen]);

  function pick(property: ProgrammeProperty) {
    setChosen(property);
    setResults(null);
    setQuery('');
    onChange(property.id);
    onPick?.(property);
  }

  if (chosen)
    return (
      <div
        className={cn(
          'rounded-lg border p-3',
          invalid && 'border-destructive',
          !invalid && 'border-success/40 bg-success-soft/40'
        )}
      >
        <div className='flex items-start gap-2'>
          <IconCheck
            aria-hidden
            className='text-success mt-0.5 size-5 shrink-0'
          />
          <div className='min-w-0 flex-1'>
            <p className='font-semibold'>{chosen.addressLine1}</p>
            <p className='text-muted-foreground text-sm'>
              {[chosen.town, chosen.postcode].filter(Boolean).join(', ')}
            </p>
            <dl className='mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
              <dt className='text-muted-foreground'>Property ID</dt>
              <dd className='font-medium tabular-nums'>{chosen.externalRef}</dd>
              {chosen.expectedMeterSerial && (
                <>
                  <dt className='text-muted-foreground'>Expected meter</dt>
                  <dd className='font-medium'>{chosen.expectedMeterSerial}</dd>
                </>
              )}
            </dl>
            {chosen.notes && (
              <p className='text-muted-foreground mt-2 text-xs'>
                {chosen.notes}
              </p>
            )}
          </div>
        </div>
        {!locked && (
          <button
            type='button'
            onClick={() => {
              setChosen(null);
              onChange(undefined);
              onPick?.(null);
            }}
            className='text-muted-foreground hover:text-foreground mt-2 min-h-11 text-sm underline'
          >
            Change property
          </button>
        )}
        {locked && (
          <p className='text-muted-foreground mt-2 text-xs'>
            This visit was started for this property. To record a different one,
            start a new visit.
          </p>
        )}
      </div>
    );

  return (
    <div className='flex flex-col gap-2'>
      <div className='relative'>
        <IconSearch
          aria-hidden
          className='text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2'
        />
        <Input
          id={inputId}
          type='search'
          inputMode='search'
          autoComplete='off'
          enterKeyHint='search'
          placeholder='Address, postcode, property ID or meter serial'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-controls={listId}
          className='h-12 pl-9'
        />
        {searching && (
          <IconLoader2
            aria-hidden
            className='text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin'
          />
        )}
      </div>

      <div id={listId} aria-live='polite'>
        {results && results.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            No property in this programme matches “{debounced.trim()}”.
          </p>
        )}
        {results && results.length > 0 && (
          <ul className='divide-y rounded-lg border'>
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type='button'
                  onClick={() => pick(p)}
                  className='hover:bg-accent flex min-h-14 w-full flex-col items-start gap-0.5 px-3 py-2 text-left'
                >
                  <span className='font-medium'>{p.addressLine1}</span>
                  <span className='text-muted-foreground text-xs'>
                    {[p.town, p.postcode, p.externalRef]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {problem && (
        <p role='alert' className='text-destructive text-sm'>
          {problem}
        </p>
      )}
    </div>
  );
}

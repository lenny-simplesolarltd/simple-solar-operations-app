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

  // A property handed down by the server has to become the ANSWER, not just the
  // card on the screen.
  //
  // `chosen` starts as `initial`, so a condition of "initial differs from
  // chosen" was false on the very first render and onChange never ran: arriving
  // from the property list showed the right property, started the draft against
  // it, and then refused the submission with "This question is required" against
  // a question the installer could see was already answered. Comparing the
  // reported VALUE as well is what makes the first render count.
  useEffect(() => {
    if (!initial) return;
    if (initial.id !== chosen?.id) setChosen(initial);
    if (value !== initial.id) onChange(initial.id);
    // Only when the server hands down a different property, or the answer has
    // not caught up with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id, value]);

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
      // The confirmation card. Recording a visit against the wrong property is
      // the one mistake on this screen that nobody notices until the client
      // does, so the three things that identify the property - the address, the
      // client's own reference and the serial they expect to find - are stated
      // together, large enough to read at arm's length.
      <div
        className={cn(
          'rounded-xl border-2 p-3',
          invalid && 'border-destructive',
          !invalid && 'border-success/50 bg-success-soft/40'
        )}
      >
        <div className='flex items-start gap-2'>
          <IconCheck
            aria-hidden
            className='text-success mt-0.5 size-5 shrink-0'
          />
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
              Recording against
            </p>
            <p className='text-lg leading-tight font-semibold break-words'>
              {chosen.addressLine1}
            </p>
            {chosen.addressLine2 && (
              <p className='text-sm break-words'>{chosen.addressLine2}</p>
            )}
            <p className='text-muted-foreground text-sm break-words'>
              {[chosen.town, chosen.postcode].filter(Boolean).join(', ')}
            </p>
          </div>
        </div>
        {/* PCH's record of this property, labelled as theirs: everything the
            installer is about to type is a reading of the real world, and the
            two must never be mistaken for each other on a phone in a hallway.
            A value PCH did not supply says so rather than sitting blank. */}
        <div className='mt-3 border-t pt-3'>
          <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
            PCH baseline
          </p>
          <dl className='mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm'>
            {chosen.externalRef && (
              <>
                <dt className='text-muted-foreground'>PCH property ID</dt>
                <dd className='font-semibold break-all tabular-nums'>
                  {chosen.externalRef}
                </dd>
              </>
            )}
            <dt className='text-muted-foreground'>Expected meter</dt>
            <dd className='font-semibold break-all'>
              {chosen.expectedMeterSerial ?? (
                <span className='text-muted-foreground font-normal'>
                  Not recorded
                </span>
              )}
            </dd>
            <dt className='text-muted-foreground'>Existing SIM type</dt>
            <dd className='font-semibold break-all'>
              {chosen.existingSimType ?? (
                <span className='text-muted-foreground font-normal'>
                  Not recorded
                </span>
              )}
            </dd>
            <dt className='text-muted-foreground'>Existing SIM ICCID</dt>
            <dd className='font-semibold break-all'>
              {chosen.existingSimSerial ?? (
                <span className='text-muted-foreground font-normal'>
                  Not recorded
                </span>
              )}
            </dd>
          </dl>
        </div>
        {chosen.notes && (
          <p className='text-muted-foreground mt-2 text-xs break-words'>
            {chosen.notes}
          </p>
        )}
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
            Wrong property? Change it
          </button>
        )}
        {locked && (
          // There is no command that moves a draft visit to another property,
          // so this says what to do instead rather than offering a control that
          // would have to be refused.
          <p className='text-muted-foreground mt-3 text-xs'>
            This visit was started for this property. If it is the wrong one, go
            back to the property list and start a visit at the right one; this
            draft is on no board and in no count until it is submitted.
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

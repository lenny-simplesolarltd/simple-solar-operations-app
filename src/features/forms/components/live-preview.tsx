'use client';

import { cn } from '@/lib/utils';
import { IconDeviceDesktop, IconDeviceMobile } from '@tabler/icons-react';
import { useState } from 'react';
import type { FormDefinition } from '../definition';
import { FormRenderer } from './form-renderer';
import { PublicShell } from './public-shell';

/**
 * The recipient's view of the draft being edited, beside the editor.
 *
 * It renders from the builder's own state, not from what has been saved, so a
 * question changes here as it is typed. Previously the only way to see this
 * was to save and navigate to a separate page, which meant leaving the editor
 * to answer "what will they actually see?" — the question you ask most while
 * building a form.
 *
 * It is the SAME FormRenderer and PublicShell the recipient gets and the
 * full-page preview uses, so there is no second rendering of a form to drift.
 */
export function LivePreview({
  title,
  description,
  definition,
  /** What the reader is looking at: the live version, or unpublished edits. */
  state
}: {
  title: string;
  description: string | null;
  definition: FormDefinition;
  state: { label: string; tone: 'live' | 'draft' };
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <p
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium',
            state.tone === 'live'
              ? 'bg-success-soft text-success'
              : 'bg-warning-soft text-warning'
          )}
        >
          {state.label}
        </p>
        <div
          role='group'
          aria-label='Preview screen size'
          className='ml-auto flex rounded-md border p-0.5'
        >
          {(['desktop', 'mobile'] as const).map((d) => (
            <button
              key={d}
              type='button'
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                'focus-visible:ring-ring flex items-center gap-1 rounded px-2 py-0.5 text-xs outline-none focus-visible:ring-2',
                device === d
                  ? 'bg-foreground text-background'
                  : 'hover:bg-accent'
              )}
            >
              {d === 'desktop' ? (
                <IconDeviceDesktop aria-hidden className='size-3.5' />
              ) : (
                <IconDeviceMobile aria-hidden className='size-3.5' />
              )}
              {d === 'desktop' ? 'Desktop' : 'Phone'}
            </button>
          ))}
        </div>
      </div>

      <p className='text-muted-foreground text-xs'>
        What the recipient sees. Nothing typed here is saved or sent.
      </p>

      <div
        className={cn(
          'mx-auto w-full overflow-hidden rounded-xl border transition-[max-width]',
          device === 'mobile' ? 'max-w-[390px]' : 'max-w-none'
        )}
      >
        <PublicShell embedded>
          <FormRenderer
            // Remounting on device change resets any answers typed into the
            // preview, which are meaningless once the frame resizes.
            key={device}
            title={title}
            description={description}
            definition={definition}
            mode='preview'
          />
        </PublicShell>
      </div>
    </div>
  );
}

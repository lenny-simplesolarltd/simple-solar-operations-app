'use client';

import { cn } from '@/lib/utils';
import { IconDeviceDesktop, IconDeviceMobile } from '@tabler/icons-react';
import Link from 'next/link';
import { useState } from 'react';
import type { FormDefinition } from '../definition';
import { FormRenderer } from './form-renderer';
import { PublicShell } from './public-shell';

export function PreviewFrame({
  label,
  versions,
  formId,
  current,
  title,
  description,
  definition
}: {
  label: string;
  versions: number[];
  formId: string;
  current: number | null;
  title: string;
  description: string | null;
  definition: FormDefinition;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <p className='bg-info-soft text-info rounded-md px-2.5 py-1 text-sm font-medium'>
          Preview · {label} · nothing you enter is saved or sent
        </p>
        <nav aria-label='Versions' className='flex flex-wrap gap-1 text-sm'>
          <Link
            href={`/dashboard/forms/${formId}/preview`}
            aria-current={current === null ? 'page' : undefined}
            className={cn(
              'rounded-md px-2 py-1',
              current === null
                ? 'bg-foreground text-background'
                : 'hover:bg-accent'
            )}
          >
            Draft
          </Link>
          {versions.map((v) => (
            <Link
              key={v}
              href={`/dashboard/forms/${formId}/preview?version=${v}`}
              aria-current={current === v ? 'page' : undefined}
              className={cn(
                'rounded-md px-2 py-1',
                current === v
                  ? 'bg-foreground text-background'
                  : 'hover:bg-accent'
              )}
            >
              v{v}
            </Link>
          ))}
        </nav>
        <div
          role='group'
          aria-label='Screen size'
          className='ml-auto flex rounded-md border p-0.5'
        >
          {(['desktop', 'mobile'] as const).map((d) => (
            <button
              key={d}
              type='button'
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                'focus-visible:ring-ring flex items-center gap-1.5 rounded px-2.5 py-1 text-sm outline-none focus-visible:ring-2',
                device === d
                  ? 'bg-foreground text-background'
                  : 'hover:bg-accent'
              )}
            >
              {d === 'desktop' ? (
                <IconDeviceDesktop aria-hidden className='size-4' />
              ) : (
                <IconDeviceMobile aria-hidden className='size-4' />
              )}
              {d === 'desktop' ? 'Desktop' : 'Phone'}
            </button>
          ))}
        </div>
      </div>
      <div
        className={cn(
          'mx-auto w-full overflow-hidden rounded-xl border transition-[max-width]',
          device === 'mobile' ? 'max-w-[390px]' : 'max-w-4xl'
        )}
      >
        <PublicShell embedded>
          <FormRenderer
            key={`${current}-${device}`}
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

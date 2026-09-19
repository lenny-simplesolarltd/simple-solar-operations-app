'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { endPreview } from './actions';

/** Deliberately loud, fixed colours (not theme tokens) so it reads the same in light and dark. */
export function PreviewBanner({
  name,
  roles,
  realName
}: {
  name: string;
  roles: string[];
  realName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Fixed-position chrome (the docked assistant) sits below the header, so it
  // needs to know how tall the banner currently is (it wraps on narrow screens).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty('--preview-banner-h', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--preview-banner-h');
    };
  }, []);

  return (
    <div
      ref={ref}
      role='status'
      aria-live='polite'
      data-testid='preview-banner'
      className='flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-black bg-amber-400 px-3 py-2 text-center text-sm font-semibold text-black'
    >
      <span>
        <span className='tracking-wide'>PREVIEW MODE</span> — Viewing as {name}{' '}
        ({roles.join(', ')})
        <span className='hidden font-normal md:inline'>
          {' '}
          · read-only · signed in as {realName}
        </span>
      </span>
      <button
        type='button'
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await endPreview();
            router.refresh();
          })
        }
        className='rounded border-2 border-black bg-black px-2.5 py-0.5 text-xs font-bold text-amber-300 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-60'
      >
        Return to myself
      </button>
    </div>
  );
}

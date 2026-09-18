import { cn } from '@/lib/utils';

const WIDTH = 1500;
const HEIGHT = 299;

/**
 * The Simple Solar wordmark, as used in the website header. `tone` picks the
 * lettering colour for the surface it sits on; 'auto' follows the app theme.
 */
export function BrandLogo({
  className,
  tone = 'auto'
}: {
  className?: string;
  tone?: 'auto' | 'ink' | 'white';
}) {
  /* eslint-disable @next/next/no-img-element -- static brand mark; intrinsic size set */
  return (
    // The wrapper stops a flex parent stretching the image off its aspect ratio.
    <span className='inline-flex shrink-0 self-start'>
      {tone !== 'white' && (
        <img
          src='/brand/simple-solar-logo.webp'
          width={WIDTH}
          height={HEIGHT}
          alt='Simple Solar'
          className={cn(
            'h-6 w-auto max-w-none',
            tone === 'auto' && 'dark:hidden',
            className
          )}
        />
      )}
      {tone !== 'ink' && (
        <img
          src='/brand/simple-solar-logo-dark.webp'
          width={WIDTH}
          height={HEIGHT}
          alt='Simple Solar'
          className={cn(
            'h-6 w-auto max-w-none',
            tone === 'auto' && 'hidden dark:block',
            className
          )}
        />
      )}
    </span>
  );
  /* eslint-enable @next/next/no-img-element */
}

/** Compact mark for tight spaces: the logo's sun dot on ink. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'bg-brand-ink dark:bg-secondary flex size-8 shrink-0 items-center justify-center rounded-lg',
        className
      )}
    >
      <span className='bg-brand size-3 rounded-full' />
    </span>
  );
}

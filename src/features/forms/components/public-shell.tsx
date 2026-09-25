import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';

/**
 * The frame around a recipient's form: brand, the form, nothing else to click.
 *
 * On its own page it fills the window. Embedded in the builder's live preview or
 * the preview page it must not: min-h-dvh inside a scrolling dashboard page
 * makes the page taller than its content, which reads as a screen of dead space
 * below the last section.
 */
export function PublicShell({
  children,
  embedded = false
}: {
  children: React.ReactNode;
  /** True when this sits inside a dashboard page rather than filling the window. */
  embedded?: boolean;
}) {
  return (
    <div className={cn('bg-muted/40', !embedded && 'min-h-dvh')}>
      <header className='bg-background border-b'>
        <div className='mx-auto flex h-14 max-w-2xl items-center px-4'>
          <BrandLogo className='h-6' />
        </div>
      </header>
      <main className='mx-auto max-w-2xl px-4 py-6 sm:py-10'>
        <div className='bg-card rounded-xl border p-5 shadow-sm sm:p-8'>
          {children}
        </div>
        <p className='text-muted-foreground mt-6 text-center text-xs'>
          Sent to you by Simple Solar. Your answers go only to the Simple Solar
          team.
        </p>
      </main>
    </div>
  );
}

export function PublicNotice({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-2 py-4 text-center'>
      <h1 className='text-xl font-bold'>{title}</h1>
      <div className='text-muted-foreground text-sm'>{children}</div>
    </div>
  );
}

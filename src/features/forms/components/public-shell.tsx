import { BrandLogo } from '@/components/brand-logo';

/** The frame around a recipient's form: brand, the form, nothing else to click. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='bg-muted/40 min-h-dvh'>
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

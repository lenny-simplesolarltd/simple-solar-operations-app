import { BrandLogo } from '@/components/brand-logo';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

/**
 * Shared frame for every auth screen: brand panel on wide screens, the form
 * card beside it. Presentation only - the forms and their actions live with
 * each page.
 */
export function AuthShell({
  title,
  description,
  children
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className='bg-background grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'>
      <aside className='bg-brand-ink relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12'>
        <BrandLogo tone='white' className='h-9' />
        <div className='relative z-10 max-w-sm'>
          <p className='text-brand text-xs font-semibold tracking-[0.18em] uppercase'>
            Operations
          </p>
          <p className='mt-3 text-3xl leading-tight font-extrabold text-white'>
            Every job, from sold to switched on.
          </p>
          <p className='mt-3 text-sm text-white/70'>
            Staff access only. Sign in with your Simple Solar work email.
          </p>
        </div>
        {/* The website's rising-sun motif: a half circle on the horizon. */}
        <div
          aria-hidden='true'
          className='bg-brand absolute right-12 bottom-0 h-36 w-72 rounded-t-full'
        />
        <span aria-hidden='true' className='h-36' />
      </aside>

      <main className='flex flex-col items-center justify-center gap-8 p-4 sm:p-8'>
        <div className='flex flex-col items-center gap-2 lg:hidden'>
          <BrandLogo className='h-8' />
          <span className='text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase'>
            Operations
          </span>
        </div>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle className='text-xl font-bold'>
              <h1>{title}</h1>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          {children && <CardContent>{children}</CardContent>}
        </Card>
        <p className='text-muted-foreground text-center text-xs'>
          Simple Solar Ltd · Internal system
        </p>
      </main>
    </div>
  );
}

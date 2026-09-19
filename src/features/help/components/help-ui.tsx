import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { helpArticleHref, type PublishedArticle } from '../types';

// Small building blocks shared by the Help Center pages. Server-safe.

export function CategoryIcon({
  icon,
  className
}: {
  icon: string;
  className?: string;
}) {
  const Icon = Icons[icon as keyof typeof Icons] ?? Icons.help;
  return <Icon className={cn('size-5', className)} aria-hidden='true' />;
}

export function HelpSearchForm({
  defaultValue,
  autoFocus,
  size = 'lg'
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  size?: 'lg' | 'sm';
}) {
  return (
    <form
      action='/dashboard/help'
      method='get'
      role='search'
      className='flex w-full gap-2'
    >
      <label htmlFor='help-q' className='sr-only'>
        Search the Help Center
      </label>
      <div className='relative flex-1'>
        <Icons.search
          className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
          aria-hidden='true'
        />
        <Input
          id='help-q'
          name='q'
          type='search'
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          maxLength={200}
          autoComplete='off'
          placeholder='For example: move a job, customer cancelled, goods arrived'
          className={cn('pl-9', size === 'lg' && 'h-12 text-base')}
        />
      </div>
      <Button type='submit' className={cn(size === 'lg' && 'h-12 px-6')}>
        Search
      </Button>
    </form>
  );
}

/** Shown on an article whose procedure depends on a switched-off feature. */
export function ReleaseNote({ article }: { article: PublishedArticle }) {
  if (article.releaseOn) return null;
  return (
    <div
      role='note'
      className='bg-warning-soft border-warning/40 flex gap-3 rounded-md border px-4 py-3 text-sm'
    >
      <Icons.warning className='text-warning mt-0.5 size-4 shrink-0' />
      <p>
        <span className='font-semibold'>
          This feature is not currently switched on.
        </span>{' '}
        The steps below describe how it works once an administrator switches it
        on. Until then, carry on the way you do today, or ask an administrator.
      </p>
    </div>
  );
}

export function ArticleList({
  articles,
  empty,
  showCategory
}: {
  articles: PublishedArticle[];
  empty?: string;
  showCategory?: Map<string, string>;
}) {
  if (articles.length === 0)
    return empty ? (
      <p className='text-muted-foreground text-sm'>{empty}</p>
    ) : null;
  return (
    <ul className='divide-y rounded-lg border'>
      {articles.map((a) => (
        <li key={a.slug}>
          <Link
            href={helpArticleHref(a.slug)}
            className='hover:bg-accent/60 focus-visible:bg-accent/60 flex flex-col gap-1 px-4 py-3 outline-none'
          >
            <span className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>{a.title}</span>
              {!a.releaseOn && <Badge variant='warning'>Not switched on</Badge>}
              {showCategory && a.category && (
                <Badge variant='outline'>
                  {showCategory.get(a.category) ?? a.category}
                </Badge>
              )}
            </span>
            {a.summary && (
              <span className='text-muted-foreground text-sm'>{a.summary}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

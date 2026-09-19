import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { createToolRegistry } from '@/features/assistant/server/tools';
import {
  getHelpAccess,
  getHelpCategories,
  getHelpHealth,
  listAllArticles
} from '@/features/help/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Manage Help Center | Simple Solar Operations'
};

const STATUS = {
  published: { label: 'Published', variant: 'success' },
  draft: { label: 'Draft', variant: 'info' },
  archived: { label: 'Archived', variant: 'outline' }
} as const;

const SEVERITY = {
  error: 'danger',
  warning: 'warning',
  info: 'info'
} as const;

const date = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeZone: 'Europe/London'
      }).format(new Date(iso))
    : '-';

export default async function ManageHelpPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await getHelpAccess();
  if (!access) redirect('/auth/sign-in');
  if (!access.canEdit) notFound();
  const { status } = await searchParams;

  const registry = createToolRegistry({ forms: true });
  const [articles, categories] = await Promise.all([
    listAllArticles(),
    getHelpCategories()
  ]);
  const health = await getHelpHealth(articles, {
    known: new Set(registry.all().map((t) => t.name)),
    planned: new Set(registry.planned().map((t) => t.name))
  });
  const categoryTitle = new Map(categories.map((c) => [c.code, c.title]));
  const shown = articles
    .filter((a) => !status || a.status === status)
    .sort(
      (a, b) =>
        (a.category ?? '').localeCompare(b.category ?? '') ||
        a.sortOrder - b.sortOrder ||
        a.title.localeCompare(b.title)
    );
  const count = (s: string) => articles.filter((a) => a.status === s).length;
  const problems = health.issues.filter((i) => i.severity !== 'info');

  return (
    <PageContainer>
      <div className='flex flex-col gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <Link href='/dashboard/help' className='text-primary text-sm'>
              ← Help Center
            </Link>
            <h1 className='mt-1 text-2xl font-bold'>Manage articles</h1>
            <p className='text-muted-foreground mt-1 text-sm'>
              Edit a guide, then publish it: staff and SimpleBot see the new
              version at once.{' '}
              {!access.canPublish &&
                'You can write drafts; a manager or administrator publishes them.'}
            </p>
          </div>
          <Button asChild>
            <Link href='/dashboard/help/manage/new'>New article</Link>
          </Button>
        </div>

        <nav
          aria-label='Filter by status'
          className='flex flex-wrap gap-2 text-sm'
        >
          {[
            ['', `All (${articles.length})`],
            ['published', `Published (${count('published')})`],
            ['draft', `Drafts (${count('draft')})`],
            ['archived', `Archived (${count('archived')})`]
          ].map(([value, label]) => (
            <Link
              key={value}
              href={
                value
                  ? `/dashboard/help/manage?status=${value}`
                  : '/dashboard/help/manage'
              }
              aria-current={(status ?? '') === value ? 'page' : undefined}
              className='aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground rounded-full border px-3 py-1'
            >
              {label}
            </Link>
          ))}
        </nav>

        <section
          aria-labelledby='health'
          className='bg-card flex flex-col gap-3 rounded-lg border p-4'
        >
          <h2 id='health' className='font-semibold'>
            Help health{' '}
            <span className='text-muted-foreground text-sm font-normal'>
              {problems.length === 0
                ? '· no problems found'
                : `· ${problems.length} to look at`}
            </span>
          </h2>
          {health.issues.length > 0 && (
            <details open={problems.length > 0 && problems.length <= 12}>
              <summary className='cursor-pointer text-sm'>
                Show {health.issues.length} item
                {health.issues.length === 1 ? '' : 's'}
              </summary>
              <ul className='mt-2 flex flex-col gap-2 text-sm'>
                {health.issues.map((i, n) => {
                  const a = articles.find((x) => x.slug === i.slug);
                  return (
                    <li key={n} className='flex flex-wrap items-center gap-2'>
                      <Badge variant={SEVERITY[i.severity]}>{i.severity}</Badge>
                      {a ? (
                        <Link
                          href={`/dashboard/help/manage/${a.id}`}
                          className='font-medium underline-offset-4 hover:underline'
                        >
                          {i.title}
                        </Link>
                      ) : (
                        <span className='font-medium'>{i.title}</span>
                      )}
                      <span className='text-muted-foreground'>{i.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>

        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Article</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Last checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className='max-w-[420px]'>
                    <Link
                      href={`/dashboard/help/manage/${a.id}`}
                      className='font-medium underline-offset-4 hover:underline'
                    >
                      {a.title}
                    </Link>
                    <div className='text-muted-foreground truncate text-xs'>
                      {a.slug}
                    </div>
                  </TableCell>
                  <TableCell className='text-sm'>
                    {a.category ? categoryTitle.get(a.category) : '-'}
                  </TableCell>
                  <TableCell>
                    <span className='flex flex-wrap gap-1'>
                      <Badge variant={STATUS[a.status].variant}>
                        {STATUS[a.status].label}
                      </Badge>
                      {a.status === 'published' && a.hasUnpublishedChanges && (
                        <Badge variant='warning'>Changes</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {a.audienceRoles.length
                      ? a.audienceRoles.join(', ')
                      : 'Everyone'}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {date(a.reviewedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageContainer>
  );
}

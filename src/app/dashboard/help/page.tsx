import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import {
  ArticleList,
  CategoryIcon,
  HelpSearchForm
} from '@/features/help/components/help-ui';
import { isAppRoute } from '@/features/help/routes';
import {
  articlesForRouteIn,
  getHelpAccess,
  getHelpCategories,
  getPublishedArticles
} from '@/features/help/server/queries';
import { searchArticles } from '@/features/help/search';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Help Center | Simple Solar Operations'
};

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'Office home',
  '/dashboard/booking': 'Booking',
  '/dashboard/planner': 'Planner',
  '/dashboard/commissioning': 'Commissioning review',
  '/dashboard/materials': 'Materials',
  '/dashboard/tasks': 'Tasks',
  '/dashboard/jobs': 'Job search',
  '/dashboard/jobs/[jobId]': 'the job page'
};

export default async function HelpPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; route?: string }>;
}) {
  const access = await getHelpAccess();
  if (!access) redirect('/auth/sign-in');
  const { q, route } = await searchParams;
  const query = (q ?? '').trim().slice(0, 200);
  const [articles, categories] = await Promise.all([
    getPublishedArticles(),
    getHelpCategories()
  ]);
  const categoryTitles = new Map(categories.map((c) => [c.code, c.title]));

  const header = (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold'>Help Center</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            Short guides to how things work in Simple Solar Operations.
          </p>
        </div>
        {access.canEdit && (
          <Button asChild variant='outline' size='sm'>
            <Link href='/dashboard/help/manage'>Manage articles</Link>
          </Button>
        )}
      </div>
    </div>
  );

  // -- Search results --------------------------------------------------------
  if (query) {
    const hits = searchArticles(articles, query, 12);
    return (
      <PageContainer>
        <AssistantPageContext page={{ kind: 'help' }} />
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
          {header}
          <HelpSearchForm defaultValue={query} />
          <section aria-labelledby='results' className='flex flex-col gap-3'>
            <h2 id='results' className='text-sm font-semibold'>
              {hits.length
                ? `Results for “${query}”`
                : `No guides found for “${query}”`}
            </h2>
            {hits.length ? (
              <ArticleList
                articles={hits.map((h) => h.article)}
                showCategory={categoryTitles}
              />
            ) : (
              <div className='text-muted-foreground flex flex-col gap-2 text-sm'>
                <p>Try fewer or different words, for example “move job”.</p>
                <p>
                  You can also browse the categories below, or ask SimpleBot. If
                  a guide is missing, tell a manager so it can be written.
                </p>
              </div>
            )}
          </section>
          <Link href='/dashboard/help' className='text-primary text-sm'>
            ← Back to Help Center
          </Link>
        </div>
      </PageContainer>
    );
  }

  // -- Help with a page --------------------------------------------------------
  const forRoute =
    route && isAppRoute(route) ? articlesForRouteIn(articles, route) : null;

  const common = articles.filter((a) => a.commonTask).slice(0, 10);
  // Guides written for this person's roles, most specific first (a guide for
  // Installers only before one for five roles), not repeating common tasks.
  const mine = articles
    .filter(
      (a) =>
        a.audienceRoles.length > 0 &&
        a.audienceRoles.some((r) => access.user.roles.includes(r as never)) &&
        !common.includes(a)
    )
    .sort(
      (a, b) =>
        a.audienceRoles.length - b.audienceRoles.length ||
        a.sortOrder - b.sortOrder
    )
    .slice(0, 6);
  const recent = [...articles]
    .filter((a) => a.publishedAt)
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 5);
  const counts = new Map<string, number>();
  for (const a of articles)
    if (a.category) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'help' }} />
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-8'>
        {header}

        <section className='bg-card flex flex-col gap-3 rounded-xl border p-5 md:p-8'>
          <h2 className='text-xl font-semibold'>What do you need help with?</h2>
          <HelpSearchForm autoFocus={!forRoute} />
        </section>

        {forRoute && (
          <section aria-labelledby='page-help' className='flex flex-col gap-3'>
            <h2 id='page-help' className='text-lg font-semibold'>
              Help with {ROUTE_LABELS[route!] ?? 'this page'}
            </h2>
            <ArticleList
              articles={forRoute}
              empty='There is no guide for this page yet. Try searching above.'
            />
          </section>
        )}

        {articles.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            There are no guides yet.
          </p>
        ) : (
          <>
            {common.length > 0 && (
              <section aria-labelledby='common' className='flex flex-col gap-3'>
                <h2 id='common' className='text-lg font-semibold'>
                  Common tasks
                </h2>
                <ul className='grid gap-2 sm:grid-cols-2'>
                  {common.map((a) => (
                    <li key={a.slug}>
                      <Link
                        href={`/dashboard/help/${a.slug}`}
                        className='hover:bg-accent/60 bg-card flex h-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium'
                      >
                        {a.title}
                        <span
                          aria-hidden='true'
                          className='text-muted-foreground'
                        >
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {mine.length > 0 && (
              <section aria-labelledby='mine' className='flex flex-col gap-3'>
                <h2 id='mine' className='text-lg font-semibold'>
                  For your role
                </h2>
                <ArticleList articles={mine} />
              </section>
            )}

            <section
              aria-labelledby='categories'
              className='flex flex-col gap-3'
            >
              <h2 id='categories' className='text-lg font-semibold'>
                Browse by topic
              </h2>
              <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {categories
                  .filter((c) => counts.get(c.code))
                  .map((c) => (
                    <li key={c.code}>
                      <Link
                        href={`/dashboard/help/category/${c.code}`}
                        className='hover:bg-accent/60 bg-card flex h-full gap-3 rounded-lg border p-4'
                      >
                        <span className='bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
                          <CategoryIcon icon={c.icon} />
                        </span>
                        <span className='flex flex-col gap-0.5'>
                          <span className='font-medium'>{c.title}</span>
                          <span className='text-muted-foreground text-sm'>
                            {c.description}
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            {counts.get(c.code)}{' '}
                            {counts.get(c.code) === 1 ? 'guide' : 'guides'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>

            {recent.length > 0 && (
              <section aria-labelledby='recent' className='flex flex-col gap-3'>
                <h2 id='recent' className='text-lg font-semibold'>
                  Recently updated
                </h2>
                <ArticleList articles={recent} />
              </section>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

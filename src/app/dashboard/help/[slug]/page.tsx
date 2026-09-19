import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { ArticleList, ReleaseNote } from '@/features/help/components/help-ui';
import { MarkdownView } from '@/features/help/components/markdown-view';
import { helpDb } from '@/features/help/server/db';
import {
  getHelpAccess,
  getHelpCategories,
  getPublishedArticle,
  getRelatedArticles
} from '@/features/help/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = SLUG.test(slug) ? await getPublishedArticle(slug) : null;
  return {
    title: `${article?.title ?? 'Help Center'} | Simple Solar Operations`
  };
}

const date = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeZone: 'Europe/London'
      }).format(new Date(iso))
    : null;

export default async function HelpArticlePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const access = await getHelpAccess();
  if (!access) redirect('/auth/sign-in');
  const { slug } = await params;
  // Drafts, archived articles, articles for other roles and unknown slugs all
  // look the same from here: not found.
  const article = SLUG.test(slug) ? await getPublishedArticle(slug) : null;
  if (!article) notFound();

  const [related, categories] = await Promise.all([
    getRelatedArticles(article),
    getHelpCategories()
  ]);
  const category = categories.find((c) => c.code === article.category);

  let editId: string | null = null;
  if (access.canEdit) {
    const db = await helpDb();
    const { data } = await db
      .from<{ id: string }>('help_articles')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    editId = data?.id ?? null;
  }

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'help', slug: article.slug }} />
      <article className='mx-auto flex w-full max-w-3xl flex-col gap-5'>
        <nav
          aria-label='Breadcrumb'
          className='text-muted-foreground flex flex-wrap items-center gap-1 text-sm'
        >
          <Link href='/dashboard/help' className='hover:text-foreground'>
            Help Center
          </Link>
          {category && (
            <>
              <span aria-hidden='true'>/</span>
              <Link
                href={`/dashboard/help/category/${category.code}`}
                className='hover:text-foreground'
              >
                {category.title}
              </Link>
            </>
          )}
        </nav>

        <header className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <h1 className='text-2xl font-bold text-balance md:text-3xl'>
              {article.title}
            </h1>
            {editId && (
              <Button asChild variant='outline' size='sm'>
                <Link href={`/dashboard/help/manage/${editId}`}>Edit</Link>
              </Button>
            )}
          </div>
          {article.summary && (
            <p className='text-muted-foreground text-base text-pretty'>
              {article.summary}
            </p>
          )}
        </header>

        <ReleaseNote article={article} />

        <div className='bg-card rounded-xl border p-5 md:p-7'>
          <MarkdownView source={article.body} />
        </div>

        {related.length > 0 && (
          <section aria-labelledby='related' className='flex flex-col gap-3'>
            <h2 id='related' className='text-lg font-semibold'>
              Related
            </h2>
            <ArticleList articles={related} />
          </section>
        )}

        <footer className='text-muted-foreground border-t pt-4 text-xs'>
          Last updated {date(article.publishedAt)}
          {article.reviewedAt && (
            <> · Last checked {date(article.reviewedAt)}</>
          )}
          {' · '}If something here is wrong, tell a manager so it can be
          corrected.
        </footer>
      </article>
    </PageContainer>
  );
}

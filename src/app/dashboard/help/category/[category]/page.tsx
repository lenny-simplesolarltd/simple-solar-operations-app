import PageContainer from '@/components/layout/page-container';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import {
  ArticleList,
  CategoryIcon,
  HelpSearchForm
} from '@/features/help/components/help-ui';
import {
  getHelpAccess,
  getHelpCategories,
  getPublishedArticles
} from '@/features/help/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Help Center | Simple Solar Operations'
};

export default async function HelpCategoryPage({
  params
}: {
  params: Promise<{ category: string }>;
}) {
  if (!(await getHelpAccess())) redirect('/auth/sign-in');
  const { category } = await params;
  const [categories, articles] = await Promise.all([
    getHelpCategories(),
    getPublishedArticles()
  ]);
  const current = categories.find((c) => c.code === category);
  if (!current) notFound();
  const inCategory = articles.filter((a) => a.category === category);

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'help' }} />
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
        <Link href='/dashboard/help' className='text-primary text-sm'>
          ← Help Center
        </Link>
        <div className='flex items-center gap-3'>
          <span className='bg-accent text-primary flex size-10 items-center justify-center rounded-full'>
            <CategoryIcon icon={current.icon} />
          </span>
          <div>
            <h1 className='text-2xl font-bold'>{current.title}</h1>
            <p className='text-muted-foreground text-sm'>
              {current.description}
            </p>
          </div>
        </div>
        <ArticleList
          articles={inCategory}
          empty='There are no guides in this topic yet.'
        />
        <HelpSearchForm size='sm' />
      </div>
    </PageContainer>
  );
}

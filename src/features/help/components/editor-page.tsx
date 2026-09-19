import PageContainer from '@/components/layout/page-container';
import { createToolRegistry } from '@/features/assistant/server/tools';
import { ROLE_CODES } from '@/lib/roles';
import Link from 'next/link';
import { APP_ROUTES } from '../routes';
import { helpDb } from '../server/db';
import { getHelpCategories } from '../server/queries';
import type { ArticleRevision, EditableArticle } from '../types';
import { ArticleEditor } from './article-editor';

/** Shared shell of the new-article and edit-article pages (server component). */
export async function EditorPage({
  article,
  history,
  canPublish,
  done
}: {
  article: EditableArticle | null;
  history: ArticleRevision[];
  canPublish: boolean;
  done?: string;
}) {
  const categories = await getHelpCategories();
  // Offer only tools that can really run; planned ones would promise too much.
  const tools = createToolRegistry({ forms: true })
    .all()
    .filter((t) => t.status === 'available')
    .map((t) => ({ name: t.name, summary: t.summary }));
  const db = await helpDb();
  const { data: health } = await db.rpc<{ release_functions: string[] }>(
    'help_health'
  );

  return (
    <PageContainer>
      <div className='flex flex-col gap-4'>
        <div>
          <Link href='/dashboard/help/manage' className='text-primary text-sm'>
            ← Manage articles
          </Link>
          <h1 className='mt-1 text-2xl font-bold'>
            {article ? `Edit: ${article.title}` : 'New article'}
          </h1>
        </div>
        <ArticleEditor
          done={done}
          article={article}
          history={history}
          canPublish={canPublish}
          categories={categories}
          roles={ROLE_CODES}
          releaseFunctions={health?.release_functions ?? []}
          tools={tools}
          routes={APP_ROUTES}
        />
      </div>
    </PageContainer>
  );
}

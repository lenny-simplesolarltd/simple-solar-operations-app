import { EditorPage } from '@/features/help/components/editor-page';
import {
  getArticleHistory,
  getEditableArticle,
  getHelpAccess
} from '@/features/help/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Edit article | Simple Solar Operations'
};

export default async function EditHelpArticlePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const access = await getHelpAccess();
  if (!access) redirect('/auth/sign-in');
  if (!access.canEdit) notFound();
  const { id } = await params;
  // RLS returns nothing to non-editors; an unknown id is simply not found.
  const article = await getEditableArticle(id);
  if (!article) notFound();
  const history = await getArticleHistory(article.id);
  const { done } = await searchParams;
  return (
    <EditorPage
      // A new version (after save, publish, revert...) reloads the form.
      key={`${article.id}:${article.version}`}
      done={done}
      article={article}
      history={history}
      canPublish={access.canPublish}
    />
  );
}

import { EditorPage } from '@/features/help/components/editor-page';
import { getHelpAccess } from '@/features/help/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'New article | Simple Solar Operations'
};

export default async function NewHelpArticlePage() {
  const access = await getHelpAccess();
  if (!access) redirect('/auth/sign-in');
  if (!access.canEdit) notFound();
  return (
    <EditorPage article={null} history={[]} canPublish={access.canPublish} />
  );
}

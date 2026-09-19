import PageContainer from '@/components/layout/page-container';
import { PreviewFrame } from '@/features/forms/components/preview-frame';
import { getForm, getRevision } from '@/features/forms/server/service';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Preview | Simple Solar Operations'
};

/**
 * Staff preview: the saved draft, or a published version, rendered with the
 * recipient's component. Nothing here creates a link or a submission.
 */
export default async function PreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await getPermissions(user)).has('forms.read')) redirect('/dashboard');
  const { id } = await params;
  const { version } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const form = await getForm(id);
  if (!form) notFound();

  const wanted = version ? Number(version) : null;
  const revisionMeta = wanted
    ? form.revisions.find((r) => r.number === wanted)
    : null;
  if (wanted && !revisionMeta) notFound();
  const revision = revisionMeta ? await getRevision(revisionMeta.id) : null;

  const shown = revision
    ? {
        title: revision.title,
        description: revision.description,
        definition: revision.definition
      }
    : {
        title: form.title,
        description: form.description,
        definition: form.definition
      };

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <Link
          href={`/dashboard/forms/${form.id}`}
          className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-sm'
        >
          <IconArrowLeft aria-hidden className='size-4' />
          Back to the {form.kind === 'template' ? 'template' : 'form'}
        </Link>
        <PreviewFrame
          label={
            revision ? `Published version ${revision.number}` : 'Saved draft'
          }
          versions={form.revisions.map((r) => r.number)}
          formId={form.id}
          current={revision?.number ?? null}
          {...shown}
        />
      </div>
    </PageContainer>
  );
}

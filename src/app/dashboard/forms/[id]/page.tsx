import { formsEnabled } from '@/features/forms/server/service';
import { FormsNotEnabled } from '@/features/forms/components/forms-not-enabled';
import PageContainer from '@/components/layout/page-container';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { FormAccess } from '@/features/forms/components/form-access';
import { FormBuilder } from '@/features/forms/components/form-builder';
import { ShareLinks } from '@/features/forms/components/share-links';
import { getFormAccess } from '@/features/forms/server/access';
import { listRoleMembers } from '@/features/people/server/queries';
import { getForm, listInvitations } from '@/features/forms/server/service';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Form | Simple Solar Operations'
};

export default async function FormPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await formsEnabled())) return <FormsNotEnabled />;
  const permissions = await getPermissions(user);
  if (!permissions.has('forms.read')) redirect('/dashboard');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const form = await getForm(id);
  if (!form) notFound();
  const links =
    form.kind === 'form' ? await listInvitations({ formId: form.id }) : [];
  // Templates are never completed by anybody: a form is made from one first.
  const access = form.kind === 'form' ? await getFormAccess(form.id) : null;
  // Who holds each role, so choosing an audience shows the people in it. Read
  // under this person's own RLS, so it is empty for anyone who may not see the
  // directory and the section simply appears without faces.
  const roleMembers = access ? await listRoleMembers() : {};

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'form',
          formId: form.id,
          formKind: form.kind,
          title: form.title,
          status: form.status
        }}
      />
      <div className='flex w-full flex-col gap-6'>
        <Link
          href={`/dashboard/forms${form.kind === 'template' ? '?view=templates' : ''}`}
          className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-sm'
        >
          <IconArrowLeft aria-hidden className='size-4' />
          {form.kind === 'template' ? 'Templates' : 'Forms'}
        </Link>
        <FormBuilder
          form={form}
          can={{
            edit: permissions.has('forms.edit'),
            publish: permissions.has('forms.publish'),
            create: permissions.has('forms.create'),
            templates: permissions.has('forms.templates.manage')
          }}
        />
        {access && (
          <FormAccess
            formId={form.id}
            access={access}
            roleMembers={roleMembers}
            canEdit={
              permissions.has('forms.edit') && form.status !== 'archived'
            }
          />
        )}
        {form.kind === 'form' && (
          <ShareLinks
            formId={form.id}
            formStatus={form.status}
            revision={form.revision}
            links={links}
            canSend={permissions.has('forms.send')}
            canReadResponses={permissions.has('forms.responses.read')}
            defaultJob={
              form.jobId && form.jobRef
                ? { id: form.jobId, jobRef: form.jobRef }
                : null
            }
          />
        )}
        {form.revisions.length > 0 && (
          <section
            aria-labelledby='versions-heading'
            className='flex flex-col gap-2'
          >
            <h2 id='versions-heading' className='text-lg font-semibold'>
              Published versions
            </h2>
            <ul className='divide-y rounded-lg border'>
              {form.revisions.map((r) => (
                <li
                  key={r.id}
                  className='flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm'
                >
                  <span className='font-medium'>Version {r.number}</span>
                  <span className='text-muted-foreground flex-1'>
                    {formatDate(r.publishedAt)}
                    {r.publishedBy && ` · ${r.publishedBy}`}
                  </span>
                  <Link
                    className='underline-offset-4 hover:underline'
                    href={`/dashboard/forms/${form.id}/preview?version=${r.number}`}
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}

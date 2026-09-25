import PageContainer from '@/components/layout/page-container';
import { hasStaffOnlyField } from '@/features/forms/definition';
import { FillForm } from '@/features/forms/components/fill-form';
import { FormsNotEnabled } from '@/features/forms/components/forms-not-enabled';
import { getFormToComplete } from '@/features/forms/server/fill';
import { formsEnabled } from '@/features/forms/server/service';
import { getCurrentUser } from '@/lib/auth';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Complete a form | Simple Solar Operations'
};

/**
 * Filling in a form that names your role.
 *
 * This is the page "My Forms" links to for a Roles-mode form, and the ONE thing
 * it must not do is check a forms.* permission. Forms had permissions for
 * administering forms and none for filling one in, so the person sent to
 * complete a form was redirected away from it; the form's own access model is
 * the authority instead, and it lives in the database:
 * app.read_form_to_complete returns the questions only when
 * app.form_completion_route says this person may complete this form directly.
 * The submit asks the same function again, so nothing here is trusted twice.
 *
 * It is laid out as a field workflow rather than inside the recipient's
 * PublicShell: this person is signed in, and that shell tells the reader their
 * answers were sent to them by Simple Solar, which would not be true. The form
 * itself is the same FormRenderer the recipient and the preview get.
 */
export default async function FillFormPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await formsEnabled())) return <FormsNotEnabled />;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const result = await getFormToComplete(id);
  // Not entitled, not published, or owned by a programme: "not found" in every
  // case. Which of the three it was would tell somebody about forms they cannot
  // see, and there is nothing they could do with the answer.
  if (!result.ok && result.reason === 'denied') notFound();

  return (
    // scrollable={false}: the form is the page, and a nested scroll area on a
    // phone fights the browser's own scrolling.
    <PageContainer scrollable={false}>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-4'>
        <Link
          href='/dashboard/forms'
          className='text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 self-start text-sm'
        >
          <IconArrowLeft aria-hidden className='size-4' />
          Your forms
        </Link>

        {!result.ok ? (
          <p
            role='alert'
            className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm'
          >
            {result.message}
          </p>
        ) : hasStaffOnlyField(result.form.definition) ? (
          // A photo or lookup question needs a workflow that knows what is being
          // photographed, and what may be looked up. Rather than show questions
          // that cannot be answered and a Submit the database would refuse, say
          // so: the fix is a change to the form, and the office has to make it.
          <div className='bg-muted/60 rounded-lg px-4 py-3 text-sm'>
            <p className='font-medium'>{result.form.title}</p>
            <p className='text-muted-foreground mt-1'>
              This form has photo or record-lookup questions, which can only be
              answered inside the workflow that collects them. It cannot be
              completed from here. Tell the office.
            </p>
          </div>
        ) : (
          <FillForm form={result.form} />
        )}
      </div>
    </PageContainer>
  );
}

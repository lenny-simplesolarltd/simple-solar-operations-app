import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { ResponseAnswers } from '@/features/forms/components/response-answers';
import { getResponse } from '@/features/forms/server/service';
import { RECIPIENT_LABEL } from '@/features/forms/types';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Response | Simple Solar Operations'
};

/** One response, shown against the exact version the recipient answered. */
export default async function ResponsePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await getPermissions(user)).has('forms.responses.read'))
    redirect('/dashboard/forms');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const response = await getResponse(id);
  if (!response) notFound();
  const { invitation, revision } = response;

  return (
    <PageContainer>
      <div className='flex w-full max-w-3xl flex-col gap-5'>
        <Link
          href='/dashboard/forms?view=responses'
          className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-sm'
        >
          <IconArrowLeft aria-hidden className='size-4' />
          Responses
        </Link>
        <Heading
          title={revision.title}
          description={`${RECIPIENT_LABEL[invitation.recipientType]}: ${invitation.recipientName}${invitation.jobRef ? ` · ${invitation.jobRef}` : ''} · submitted ${formatDate(response.submittedAt)}`}
        />
        <p className='text-muted-foreground text-sm'>
          Answered on version {revision.number} of this form.{' '}
          <Link
            className='underline underline-offset-4'
            href={`/dashboard/forms/${invitation.formId}`}
          >
            Open the form
          </Link>
          {invitation.jobId && (
            <>
              {' · '}
              <Link
                className='underline underline-offset-4'
                href={`/dashboard/jobs/${invitation.jobId}`}
              >
                Open the job
              </Link>
            </>
          )}
        </p>
        <ResponseAnswers
          definition={revision.definition}
          answers={response.answers}
        />
      </div>
    </PageContainer>
  );
}

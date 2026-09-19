import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import {
  CreateHandover,
  ReviewActions
} from '@/features/installs/components/review-actions';
import type {
  HandoverReadiness,
  WorkflowRead
} from '@/features/installs/types';
import { getJobDetail } from '@/features/jobs/server/queries';
import { EvidenceList } from '@/features/operations/evidence-list';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Review commissioning | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answerText = (a: WorkflowRead['answers'][number]) =>
  a.not_applicable_reason
    ? `N/A – ${a.not_applicable_reason}`
    : (a.value_text ??
      (a.value_number != null ? String(a.value_number) : null) ??
      a.value_date ??
      (a.value_boolean != null ? (a.value_boolean ? 'Yes' : 'No') : '—'));

export default async function ReviewPage({
  params
}: {
  params: Promise<{ workPackageId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { workPackageId } = await params;
  if (!UUID.test(workPackageId)) notFound();

  const wf = await readOps<WorkflowRead>('INSTALLER_WORKFLOW', {
    work_package_id: workPackageId
  });
  const [readiness, job] = wf.ok
    ? await Promise.all([
        readOps<HandoverReadiness>('HANDOVER_READINESS', {
          job_id: wf.data.job_id
        }),
        getJobDetail(wf.data.job_id)
      ])
    : [null, null];
  const labels = wf.ok
    ? new Map(wf.data.questions.map((q) => [q.question_key, q.label]))
    : new Map();

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'commissioning-review',
          view: 'submission'
        }}
      />
      <div className='flex w-full max-w-4xl flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/commissioning'>
            <IconArrowLeft /> Commissioning review
          </Link>
        </Button>
        {!wf.ok ? (
          <ReadFailureState failure={wf.error} />
        ) : (
          <>
            <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
              <div>
                <h1 className='text-2xl font-bold'>
                  {wf.data.trade} commissioning · {wf.data.job_label}
                </h1>
                <p className='mt-1 flex flex-wrap items-center gap-2 text-sm'>
                  {wf.data.submission ? (
                    <Badge variant='outline'>{wf.data.submission.status}</Badge>
                  ) : (
                    <Badge variant='secondary'>Not started</Badge>
                  )}
                  <Link
                    href={`/dashboard/jobs/${wf.data.job_id}`}
                    className='underline underline-offset-4'
                  >
                    open job
                  </Link>
                </p>
              </div>
              {isOfficeManager(user) &&
                wf.data.submission &&
                ['Submitted', 'UnderReview'].includes(
                  wf.data.submission.status
                ) && (
                  <ReviewActions
                    jobId={wf.data.job_id}
                    workPackageId={wf.data.work_package_id}
                    submissionId={wf.data.submission.id}
                    version={wf.data.submission.expected_version}
                    templateConfigured={
                      wf.data.submission.template_version !== 'NOT_CONFIGURED'
                    }
                  />
                )}
            </div>
            {wf.data.submission?.review_notes && (
              <p className='bg-muted rounded-md px-3 py-2 text-sm'>
                Review notes: {wf.data.submission.review_notes}
              </p>
            )}
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Answers</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-1 text-sm'>
                {wf.data.answers.length === 0 && (
                  <p className='text-muted-foreground'>No answers recorded.</p>
                )}
                {wf.data.answers.map((a) => (
                  <div
                    key={a.question_key}
                    className='flex justify-between gap-4 border-b py-1.5 last:border-b-0'
                  >
                    <span className='text-muted-foreground'>
                      {labels.get(a.question_key) ?? a.question_key}
                    </span>
                    <span className='text-right font-medium'>
                      {answerText(a)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Photos and files</CardTitle>
              </CardHeader>
              <CardContent>
                <EvidenceList
                  scope={{ work_package_id: wf.data.work_package_id }}
                  empty='None attached.'
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
                  Handover
                  {isOfficeManager(user) && job && (
                    <CreateHandover
                      jobId={job.job.id}
                      jobVersion={job.job.version}
                    />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className='text-sm'>
                {!readiness ? null : readiness.ok ? (
                  <>
                    <p>
                      <Badge
                        variant={readiness.data.ready ? 'success' : 'warning'}
                      >
                        {readiness.data.ready
                          ? 'Ready for handover'
                          : 'Not ready yet'}
                      </Badge>{' '}
                      <span className='text-muted-foreground'>
                        {readiness.data.submissions_accepted}/
                        {readiness.data.submissions_count} commissioning
                        accepted · {readiness.data.equipment_count} equipment
                        recorded
                      </span>
                    </p>
                    {readiness.data.issues.length > 0 && (
                      <ul className='text-muted-foreground mt-1 list-disc pl-5'>
                        {readiness.data.issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className='text-muted-foreground'>
                    {readiness.error.message}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageContainer>
  );
}

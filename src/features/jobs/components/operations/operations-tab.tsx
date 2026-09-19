import { EmptyState } from '@/components/empty-state';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { JobOperationsRead, OpsFlag } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import { IconCheck, IconX } from '@tabler/icons-react';
import { formatDate, formatDateTime } from '../../format';
import {
  ChangeDates,
  ChangeInstaller,
  CompleteJob,
  IssueActions,
  LogJobCall,
  RaiseIssue,
  RecordCommissioning,
  ReinstateJob
} from './actions';
import { CancelJob } from './cancel-job';
import {
  CloseCancellation,
  CompleteReopenReview,
  ResolveCancellationTask
} from './cancellation-work';
import { flagText, gateReasonText } from './labels';

// Operating an R1 job after booking: completion checks, commissioning per
// work package, installer / date changes, issues, calls and cancellation. One
// read (JOB_OPERATIONS); every action is a command the server re-checks.

const day = (v: string | null | undefined) => (v ? formatDate(v) : '-');

/** Why an action is not offered, worded by its kind (mode vs role vs state). */
function Why({ flag }: { flag: OpsFlag }) {
  const text = flagText(flag);
  if (!text) return null;
  return (
    <p
      className={
        flag.denied === 'MODE'
          ? 'text-warning text-xs'
          : 'text-muted-foreground text-xs'
      }
    >
      {text}
    </p>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className='flex items-start gap-2 text-sm'>
      {ok ? (
        <IconCheck className='text-success mt-0.5 size-4 shrink-0' />
      ) : (
        <IconX className='text-destructive mt-0.5 size-4 shrink-0' />
      )}
      <span>{children}</span>
    </li>
  );
}

export async function OperationsTab({ jobId }: { jobId: string }) {
  const result = await readOps<JobOperationsRead>('JOB_OPERATIONS', {
    job_id: jobId
  });
  if (!result.ok) return <ReadFailureState failure={result.error} />;
  const {
    job,
    packages,
    issues,
    calls,
    installers,
    completion,
    actions,
    cancellation
  } = result.data;
  const reasons = completion.gate.reasons;
  const required = packages.filter(
    (p) => p.required && p.status !== 'Cancelled'
  );
  const cancelled =
    job.workflow_stage === 'Cancelled' ||
    job.workflow_stage === 'CancellationInProgress';

  return (
    <div className='flex flex-col gap-6'>
      {/* ------------------------------------------------ completion */}
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
            Completion
            {job.operational_complete_at ? (
              <Badge>
                Operationally complete {day(job.operational_complete_at)}
              </Badge>
            ) : (
              <Badge variant='outline'>
                {completion.gate.ready ? 'Ready to complete' : 'Not ready'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          {job.operational_complete_at ? (
            <p className='text-muted-foreground text-sm'>
              Completed by {job.operational_complete_by_name ?? 'staff'} on{' '}
              {formatDateTime(job.operational_complete_at)}.
            </p>
          ) : (
            <ul className='flex flex-col gap-1.5'>
              <Check ok={!reasons.includes('REQUIRED_WORK_UNCONFIRMED')}>
                Installer confirmed every required work package
              </Check>
              {required
                .filter((p) => p.commissioning.required)
                .map((p) => (
                  <Check key={p.id} ok={p.commissioning.accepted}>
                    {p.trade} commissioning recorded
                  </Check>
                ))}
              <Check ok={!reasons.includes('CUSTOMER_NOT_HAPPY')}>
                Customer happy call done
                {job.customer_happy_at && ` (${day(job.customer_happy_at)})`}
              </Check>
              <Check ok={!reasons.includes('BLOCKING_ISSUE_OPEN')}>
                No blocking issues open
              </Check>
            </ul>
          )}
          {!job.operational_complete_at && reasons.length > 0 && (
            <ul className='text-muted-foreground list-disc pl-5 text-xs'>
              {reasons.map((r) => (
                <li key={r}>{gateReasonText(r, packages)}</li>
              ))}
            </ul>
          )}
          {!job.operational_complete_at && (
            <div className='flex flex-col gap-1'>
              <div>
                <CompleteJob
                  jobId={job.id}
                  jobVersion={job.version}
                  flag={completion.action}
                />
              </div>
              <Why flag={completion.action} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ work packages */}
      <section className='flex flex-col gap-3'>
        <h2 className='text-base font-semibold'>Work and commissioning</h2>
        {packages.length === 0 ? (
          <EmptyState
            title='Not planned yet'
            description='Work packages appear once the booking is confirmed.'
          />
        ) : (
          <div className='grid gap-4 lg:grid-cols-2'>
            {packages.map((p) => {
              const office = p.commissioning.current.find(
                (s) => s.source_system === 'R1A-office-manual'
              );
              return (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
                      {p.trade}
                      <Badge variant='outline'>{p.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3 text-sm'>
                    <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
                      <dt className='text-muted-foreground'>Planned</dt>
                      <dd>
                        {day(p.planned_start)}
                        {p.planned_end &&
                          p.planned_end !== p.planned_start &&
                          ` – ${day(p.planned_end)}`}
                      </dd>
                      <dt className='text-muted-foreground'>Team</dt>
                      <dd>
                        {p.allocations.length
                          ? p.allocations
                              .map(
                                (a) =>
                                  `${a.person_name ?? 'Unknown'} (${a.role})`
                              )
                              .join(', ')
                          : 'Unallocated'}
                      </dd>
                      <dt className='text-muted-foreground'>Confirmed</dt>
                      <dd>{day(p.installer_confirmation_at)}</dd>
                      <dt className='text-muted-foreground'>Commissioning</dt>
                      <dd>
                        {!p.commissioning.required
                          ? 'Not required'
                          : p.commissioning.installer_accepted
                            ? 'Installer form accepted'
                            : office
                              ? `Recorded by ${office.reviewed_by_name ?? 'office'} ${day(office.reviewed_at)}${office.office_reference ? ` · ${office.office_reference}` : ''}`
                              : 'Not recorded'}
                        {office?.evidence.map((e) => (
                          <span
                            key={e.id}
                            className='text-muted-foreground block text-xs'
                          >
                            {e.filename}
                          </span>
                        ))}
                      </dd>
                    </dl>
                    <div className='flex flex-wrap gap-2'>
                      {p.commissioning.required && (
                        <RecordCommissioning jobId={job.id} pkg={p} />
                      )}
                      <ChangeDates jobId={job.id} pkg={p} />
                      <ChangeInstaller
                        jobId={job.id}
                        pkg={p}
                        installers={installers}
                      />
                    </div>
                    {p.commissioning.required && (
                      <Why flag={p.actions.commissioning_record} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ issues */}
      <section className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h2 className='text-base font-semibold'>Issues</h2>
          <div className='flex flex-col items-end gap-1'>
            <RaiseIssue
              jobId={job.id}
              jobVersion={job.version}
              flag={actions.issue_create}
            />
            <Why flag={actions.issue_create} />
          </div>
        </div>
        {issues.length === 0 ? (
          <EmptyState title='No issues' />
        ) : (
          <ul className='flex flex-col gap-3'>
            {issues.map((i) => (
              <li key={i.id} className='bg-card rounded-lg border p-4 text-sm'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{i.category}</span>
                  <Badge variant='outline'>{i.type}</Badge>
                  <Badge
                    variant={
                      i.status === 'Resolved' || i.status === 'Closed'
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {i.status}
                  </Badge>
                  {i.blocks_completion &&
                    i.status !== 'Resolved' &&
                    i.status !== 'Closed' && (
                      <Badge variant='destructive'>Blocks completion</Badge>
                    )}
                </div>
                <p className='mt-1 break-words'>{i.description}</p>
                <p className='text-muted-foreground mt-1 text-xs'>
                  Raised {formatDateTime(i.raised_at)} by{' '}
                  {i.raised_by_name ?? 'staff'} · owner {i.owner_name ?? '-'}
                </p>
                {i.resolution && (
                  <p className='mt-1 text-xs'>Resolution: {i.resolution}</p>
                )}
                <div className='mt-2'>
                  <IssueActions jobId={job.id} issue={i} />
                  {!i.actions.resolve.available &&
                    !i.actions.close.available &&
                    i.status !== 'Closed' && <Why flag={i.actions.resolve} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ calls */}
      <section className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h2 className='text-base font-semibold'>Calls</h2>
          <div className='flex flex-col items-end gap-1'>
            <LogJobCall
              jobId={job.id}
              jobVersion={job.version}
              packages={packages.filter((p) => p.status !== 'Cancelled')}
              flag={actions.call_record}
            />
            <Why flag={actions.call_record} />
          </div>
        </div>
        {calls.length === 0 ? (
          <EmptyState title='No calls logged' />
        ) : (
          <ul className='flex flex-col gap-2'>
            {calls.map((c) => (
              <li key={c.id} className='border-b pb-2 text-sm last:border-b-0'>
                <p className='font-medium'>
                  {c.type} · {c.outcome}
                  <span className='text-muted-foreground font-normal'>
                    {' '}
                    ·{' '}
                    {c.job_level
                      ? 'job call'
                      : (c.task_title ?? c.task_code ?? 'task call')}
                    {c.work_package_trade && ` · ${c.work_package_trade}`}
                  </span>
                </p>
                <p className='text-muted-foreground text-xs'>
                  {formatDateTime(c.attempted_at)} ·{' '}
                  {c.attempted_by_name ?? 'staff'}
                  {c.next_attempt_at &&
                    ` · try again ${formatDateTime(c.next_attempt_at)}`}
                </p>
                {c.notes && <p className='mt-0.5 break-words'>{c.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ cancellation */}
      <section className='flex flex-col gap-3'>
        <h2 className='text-base font-semibold'>Cancellation</h2>
        {cancelled ? (
          <Card>
            <CardContent className='flex flex-col gap-2 pt-6 text-sm'>
              <p>
                {job.workflow_stage === 'Cancelled'
                  ? 'Cancelled'
                  : 'Cancellation in progress'}{' '}
                · {day(job.cancellation_at)} by{' '}
                {job.cancellation_by_name ?? 'staff'}
              </p>
              {job.cancellation_reason && <p>{job.cancellation_reason}</p>}
              {cancellation.tasks.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  No cancellation tasks open.
                </p>
              ) : (
                <ul className='flex flex-col gap-2'>
                  {cancellation.tasks.map((t) => (
                    <li
                      key={t.id}
                      className='flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0'
                    >
                      <span>
                        {t.title}
                        <span className='text-muted-foreground block text-xs'>
                          {t.status}
                          {t.confirmation && ' · needs their confirmation'}
                          {t.owner_name && ` · ${t.owner_name}`}
                          {!t.resolvable && ' · track it when closing'}
                        </span>
                      </span>
                      {t.resolvable && (
                        <ResolveCancellationTask
                          jobId={job.id}
                          jobVersion={job.version}
                          task={t}
                          flag={cancellation.actions.resolve}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {job.workflow_stage === 'CancellationInProgress' && (
                <div className='flex flex-col gap-1'>
                  <div>
                    <CloseCancellation
                      jobId={job.id}
                      jobVersion={job.version}
                      tasks={cancellation.tasks}
                      flag={cancellation.actions.close}
                    />
                  </div>
                  <Why flag={cancellation.actions.close} />
                </div>
              )}
              {job.workflow_stage === 'Cancelled' && (
                <div className='flex flex-col gap-1'>
                  <div>
                    <ReinstateJob
                      jobId={job.id}
                      jobVersion={job.version}
                      flag={actions.reinstate_job}
                    />
                  </div>
                  <Why flag={actions.reinstate_job} />
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className='flex flex-col gap-3'>
            {cancellation.reopen_review && (
              <Card>
                <CardContent className='flex flex-col gap-2 pt-6 text-sm'>
                  <p>
                    Reinstated. Normal work is paused until the reopen review is
                    complete.
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {cancellation.reopen_review.title}
                  </p>
                  <div>
                    <CompleteReopenReview
                      jobId={job.id}
                      review={cancellation.reopen_review}
                      flag={cancellation.actions.reopen_review_complete}
                    />
                  </div>
                  <Why flag={cancellation.actions.reopen_review_complete} />
                </CardContent>
              </Card>
            )}
            <div>
              <CancelJob
                jobId={job.id}
                jobVersion={job.version}
                flag={actions.cancel_job}
              />
            </div>
            <Why flag={actions.cancel_job} />
          </div>
        )}
      </section>
    </div>
  );
}

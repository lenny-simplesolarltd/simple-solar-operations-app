import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDateTime } from '@/features/jobs/format';
import {
  RecordOperationalEvidence,
  ResolveCalendar,
  ResolveOutbox
} from '@/features/system/components/system-actions';
import {
  normalizeOperational,
  STATE_LABEL,
  STATE_VARIANT
} from '@/features/system/operational-health';
import { getCurrentUser } from '@/lib/auth';
import { readOps, readR1 } from '@/lib/backend/read';
import { isAdmin, isDirectorClass, isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'System health | Simple Solar Operations'
};

interface SystemStatus {
  generated_at: string;
  health: {
    latest_check: {
      checked_at: string;
      outcome: string;
      error_code: string | null;
      integration: string;
    } | null;
    total_checks: number;
  };
  /** app.operational_health(): absent until its migration is applied. */
  operational?: unknown;
  commit_journal: { stalled: number; recovery_required: number };
  outbox: { uncertain: number; uncertain_ids: string[] };
  not_configured: { area: string; detail: string }[];
}
interface ReleaseMode {
  function_id: string;
  function_name: string;
  target_release: string;
  mode: string;
  authorised_job_scope: string;
}
interface CalendarStatus {
  calendar_mode: string;
  live_ready: boolean;
  outbox: { total: number; due_now: number };
  needs_review: { outbox_id: string; action: string; summary: string | null }[];
}

const MODE_VARIANT: Record<string, 'success' | 'warning' | 'outline'> = {
  Automated: 'success',
  Manual: 'warning',
  Disabled: 'outline'
};

export default async function SystemPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const admin = isAdmin(user);
  const canResolve = isOfficeManager(user);
  // Director reads System Health to record backup evidence; the calendar
  // outbox is office work (CALENDAR_STATUS: Admin / Manager / Office).
  const [status, modes, calendar] = await Promise.all([
    readR1<SystemStatus>('SYSTEM_STATUS'),
    admin
      ? readR1<ReleaseMode[]>('RELEASE_MODE_STATUS')
      : Promise.resolve(null),
    canResolve
      ? readOps<CalendarStatus>('CALENDAR_STATUS')
      : Promise.resolve(null)
  ]);
  const canRecordEvidence = isDirectorClass(user);
  const operational = normalizeOperational(
    status.ok ? status.data.operational : undefined
  );
  const healthCheck = operational.items.find((i) => i.key === 'HealthCheck');

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'operations', surface: 'system' }} />
      <div className='flex w-full flex-col gap-5'>
        <Heading
          title='System health'
          description='Background checks, integrations that need a person, and which parts of the system are switched on.'
        />
        {!status.ok ? (
          <ReadFailureState failure={status.error} />
        ) : (
          <div className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Health</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-1 text-sm'>
                {/* A recorded row is not health: the state says whether the
                    latest check is recent enough to mean anything. */}
                <p className='flex flex-wrap items-center gap-2'>
                  <Badge
                    variant={STATE_VARIANT[healthCheck?.state ?? 'Unknown']}
                  >
                    {STATE_LABEL[healthCheck?.state ?? 'Unknown']}
                  </Badge>
                  {status.data.health.latest_check ? (
                    <span>
                      Last check{' '}
                      {formatDateTime(
                        status.data.health.latest_check.checked_at
                      )}
                      :{' '}
                      <span className='font-medium'>
                        {status.data.health.latest_check.outcome}
                      </span>
                      {status.data.health.latest_check.error_code && (
                        <span className='text-destructive'>
                          {' '}
                          · {status.data.health.latest_check.error_code}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className='text-muted-foreground'>
                      No system health check has been recorded.
                    </span>
                  )}
                </p>
                {healthCheck?.detail && (
                  <p className='text-muted-foreground'>{healthCheck.detail}</p>
                )}
                <p>
                  Unfinished commits: {status.data.commit_journal.stalled}
                  {status.data.commit_journal.recovery_required > 0 && (
                    <span className='text-destructive'>
                      {' '}
                      · {status.data.commit_journal.recovery_required} need
                      recovery
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Not configured yet</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-1 text-sm'>
                {status.data.not_configured.map((n) => (
                  <p key={n.area}>
                    <span className='font-medium'>{n.area}</span>
                    <span className='text-muted-foreground'> · {n.detail}</span>
                  </p>
                ))}
              </CardContent>
            </Card>
            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
                  <span className='flex items-center gap-2'>
                    Operational evidence
                    <Badge variant={STATE_VARIANT[operational.overallState]}>
                      {STATE_LABEL[operational.overallState]}
                    </Badge>
                  </span>
                  {canRecordEvidence && operational.reported && (
                    <RecordOperationalEvidence
                      monitoringEnabled={operational.monitoringEnabled}
                    />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-2 text-sm'>
                <p className='text-muted-foreground text-xs'>
                  Verified means recent proof exists. Stale means the proof is
                  too old to rely on. Unknown means there is no proof - it is
                  not a pass. Backups are made by the hosting platform; this app
                  only records that someone checked them.
                </p>
                {operational.items.map((i) => (
                  <div
                    key={i.key}
                    className='flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t pt-2'
                  >
                    <div className='flex min-w-0 flex-col'>
                      <span className='font-medium'>{i.label}</span>
                      <span className='text-muted-foreground'>
                        {i.detail}
                        {i.live && <> Checked just now.</>}
                        {!i.live && i.evidenceAt && (
                          <> Last evidence {formatDateTime(i.evidenceAt)}</>
                        )}
                        {i.recordedBy && <> by {i.recordedBy}</>}
                        {!i.recordedBy && i.source === 'Automation' && (
                          <> by an automated check</>
                        )}
                        {i.evidenceReference && <> · {i.evidenceReference}</>}
                        {i.state !== 'Verified' && i.lastVerifiedAt && (
                          <>
                            {' '}
                            · last verified {formatDateTime(i.lastVerifiedAt)}
                          </>
                        )}
                      </span>
                    </div>
                    <Badge variant={STATE_VARIANT[i.state]}>
                      {STATE_LABEL[i.state]}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle className='text-base'>
                  Integrations needing a decision{' '}
                  <Badge
                    variant={
                      status.data.outbox.uncertain ? 'warning' : 'success'
                    }
                  >
                    {status.data.outbox.uncertain}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-2 text-sm'>
                {status.data.outbox.uncertain_ids.length === 0 && (
                  <p className='text-muted-foreground'>Nothing waiting.</p>
                )}
                {status.data.outbox.uncertain_ids.map((id) => (
                  <div
                    key={id}
                    className='flex items-center justify-between gap-2 border-b pb-2 last:border-b-0'
                  >
                    <span className='text-muted-foreground font-mono text-xs'>
                      {id}
                    </span>
                    {canResolve && <ResolveOutbox outboxId={id} />}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {calendar && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Calendar sync</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2 text-sm'>
              {!calendar.ok ? (
                <p className='text-muted-foreground'>
                  {calendar.error.message}
                </p>
              ) : (
                <>
                  <p>
                    Mode{' '}
                    <span className='font-medium'>
                      {calendar.data.calendar_mode}
                    </span>
                    {calendar.data.live_ready
                      ? ' · live'
                      : ' · entries are captured, not sent'}{' '}
                    · {calendar.data.outbox.due_now} due now
                  </p>
                  {calendar.data.needs_review.map((n) => (
                    <div
                      key={n.outbox_id}
                      className='flex items-center justify-between gap-2 border-t pt-2'
                    >
                      <span>
                        {n.action}
                        {n.summary && (
                          <span className='text-muted-foreground'>
                            {' '}
                            · {n.summary}
                          </span>
                        )}
                      </span>
                      {canResolve && <ResolveCalendar outboxId={n.outbox_id} />}
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {modes &&
          (modes.ok ? (
            <section className='flex flex-col gap-2'>
              <h2 className='text-lg font-semibold'>Release modes</h2>
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Function</TableHead>
                      <TableHead>Release</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Scope</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modes.data.map((m) => (
                      <TableRow key={m.function_id}>
                        <TableCell className='whitespace-normal'>
                          <span className='text-muted-foreground font-mono text-xs'>
                            {m.function_id}
                          </span>{' '}
                          {m.function_name}
                        </TableCell>
                        <TableCell>{m.target_release}</TableCell>
                        <TableCell>
                          <Badge variant={MODE_VARIANT[m.mode] ?? 'outline'}>
                            {m.mode}
                          </Badge>
                        </TableCell>
                        <TableCell>{m.authorised_job_scope}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className='text-muted-foreground text-xs'>
                Release modes are changed by an administrator in the database.
              </p>
            </section>
          ) : (
            <ReadFailureState failure={modes.error} />
          ))}
      </div>
    </PageContainer>
  );
}

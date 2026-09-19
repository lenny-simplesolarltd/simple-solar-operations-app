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
  ResolveCalendar,
  ResolveOutbox
} from '@/features/system/components/system-actions';
import { getCurrentUser } from '@/lib/auth';
import { readOps, readR1 } from '@/lib/backend/read';
import { isAdmin, isOfficeManager } from '@/lib/roles';
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
  const [status, modes, calendar] = await Promise.all([
    readR1<SystemStatus>('SYSTEM_STATUS'),
    admin
      ? readR1<ReleaseMode[]>('RELEASE_MODE_STATUS')
      : Promise.resolve(null),
    readOps<CalendarStatus>('CALENDAR_STATUS')
  ]);
  const canResolve = isOfficeManager(user);

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
                {status.data.health.latest_check ? (
                  <p>
                    Last check{' '}
                    {formatDateTime(status.data.health.latest_check.checked_at)}
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
                  </p>
                ) : (
                  <p className='text-muted-foreground'>
                    No health checks recorded yet.
                  </p>
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

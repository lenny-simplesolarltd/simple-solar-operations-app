import { EmptyState } from '@/components/empty-state';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { getStaffOptions } from '@/features/tasks/server/queries';
import type { AuditHistoryRead, JobOverviewRead } from '@/lib/backend/models';
import { readR1 } from '@/lib/backend/read';
import Link from 'next/link';
import { formatDate, formatDateTime, pounds } from '../format';

// Job Detail tabs backed by the R1 read models (execute_read). Each tab reads
// only what it shows; a refusal renders the failure state for that tab only.

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0'>
      <span className='text-muted-foreground shrink-0'>{label}</span>
      <span className='min-w-0 text-right font-medium break-words'>
        {children}
      </span>
    </div>
  );
}

const day = (v: string | null | undefined) => (v ? formatDate(v) : '-');
const money = (pence: number | null | undefined) =>
  pounds.format((pence ?? 0) / 100);

export async function WorkTab({ jobId }: { jobId: string }) {
  const result = await readR1<JobOverviewRead>('JOB_OVERVIEW', {
    job_id: jobId
  });
  if (!result.ok) return <ReadFailureState failure={result.error} />;
  const { work, materials, scaffold, commissioning, handover } = result.data;
  const allocations = new Map<string, typeof work.allocations>();
  for (const a of work.allocations) {
    allocations.set(a.work_package_id, [
      ...(allocations.get(a.work_package_id) ?? []),
      a
    ]);
  }
  return (
    <div className='flex flex-col gap-4'>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-semibold'>Work packages</h2>
        {work.packages.length === 0 ? (
          <EmptyState
            title='Not planned yet'
            description='Work packages appear once the booking is confirmed.'
          />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Team</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {work.packages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.trade}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{p.status}</Badge>
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {day(p.planned_start)}
                      {p.planned_end &&
                        p.planned_end !== p.planned_start &&
                        ` – ${day(p.planned_end)}`}
                    </TableCell>
                    <TableCell>
                      {(allocations.get(p.id) ?? [])
                        .map((a) => a.person_name ?? 'Unknown')
                        .join(', ') || (
                        <span className='text-warning'>Unallocated</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Install</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label='Calls logged'>{work.calls_count}</Row>
            <Row label='Unresolved issues'>{work.unresolved_issues}</Row>
            <Row label='Operationally complete'>
              {day(work.operational_complete_at)}
            </Row>
            <Row label='Customer happy'>{day(work.customer_happy_at)}</Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-between text-base'>
              Materials
              <Link
                href={`/dashboard/materials/${jobId}`}
                className='text-xs font-normal underline underline-offset-4'
              >
                open
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Row label='Lines'>{materials.materials_count}</Row>
            <Row label='Required qty'>{materials.required_quantity}</Row>
            <Row label='Reserved'>{materials.active_reservations}</Row>
            <Row label='Orders'>
              {materials.orders.length === 0
                ? 'None'
                : materials.orders.map((o) => o.status).join(', ')}
            </Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Scaffold</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label='Required'>
              {scaffold.scaffold_required ? 'Yes' : 'No'}
            </Row>
            {scaffold.bookings.map((b) => (
              <Row key={b.id} label={b.status}>
                erect {day(b.erect_actual_at ?? b.erect_planned_at)}
                {b.strip_actual_at && ` · struck ${day(b.strip_actual_at)}`}
              </Row>
            ))}
            {scaffold.scaffold_required && scaffold.bookings.length === 0 && (
              <Row label='Booking'>Not booked</Row>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              Commissioning & handover
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Row label='Submissions'>
              {commissioning.submissions.length === 0
                ? 'None'
                : commissioning.submissions.map((s) => s.status).join(', ')}
            </Row>
            <Row label='Equipment recorded'>
              {commissioning.equipment_count}
            </Row>
            <Row label='Handover'>{handover.status ?? '-'}</Row>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export async function MoneyTab({ jobId }: { jobId: string }) {
  const result = await readR1<JobOverviewRead>('JOB_OVERVIEW', {
    job_id: jobId
  });
  if (!result.ok) return <ReadFailureState failure={result.error} />;
  const { finance, booking } = result.data;
  return (
    <div className='flex flex-col gap-4'>
      <dl className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        {[
          ['Contract value', money(finance.original_gross_pence)],
          ['Invoiced', money(finance.total_invoiced)],
          ['Paid', money(finance.total_paid)],
          ['Outstanding', money(finance.total_outstanding)]
        ].map(([label, value]) => (
          <div key={label} className='bg-card rounded-lg border px-4 py-3'>
            <dt className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
              {label}
            </dt>
            <dd className='mt-1 text-xl font-bold tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Deposit & contract</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label='Deposit in bank'>
              {finance.deposit_confirmed
                ? `Confirmed ${day(finance.deposit_confirmed_at)}`
                : 'Not confirmed'}
            </Row>
            <Row label='Contract'>{finance.contract_status ?? '-'}</Row>
            <Row label='Booking details match'>
              {booking.sold_booking_match_status ?? '-'}
            </Row>
            <Row label='Booking approved'>
              {day(booking.booking_approved_at)}
            </Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Invoice stages</CardTitle>
          </CardHeader>
          <CardContent>
            {finance.stages.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                No invoice stages yet.
              </p>
            ) : (
              finance.stages.map((s) => (
                <Row key={s.stage_id} label={s.stage}>
                  {money(s.gross_pence)}
                  <span className='text-muted-foreground ml-2 text-xs font-normal'>
                    {s.status ?? '-'}
                    {s.outstanding_pence > 0 &&
                      ` · ${money(s.outstanding_pence)} due`}
                  </span>
                </Row>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const EVENT_TYPE: Record<string, string> = {
  audit: 'Record',
  task_event: 'Task',
  issue_event: 'Issue'
};

export async function HistoryTab({ jobId }: { jobId: string }) {
  const [result, people] = await Promise.all([
    readR1<AuditHistoryRead>('AUDIT_HISTORY', { job_id: jobId }),
    getStaffOptions()
  ]);
  if (!result.ok) return <ReadFailureState failure={result.error} />;
  const names = new Map(people.map((p) => [p.id, p.name]));
  // Oldest first from the read; show newest first.
  const events = [...result.data.events].reverse();
  if (events.length === 0) return <EmptyState title='No history yet' />;
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-sm'>
        {result.data.total_events} events
        {result.data.total_events > events.length &&
          ` · showing the first ${events.length}`}
      </p>
      <ol className='flex flex-col gap-3 border-l pl-4'>
        {events.map((e, i) => (
          <li key={`${e.timestamp}-${i}`} className='relative text-sm'>
            <span
              aria-hidden='true'
              className='bg-brand absolute top-1.5 -left-[21px] size-2 rounded-full'
            />
            <p className='font-medium'>
              <span className='text-muted-foreground mr-1.5 text-xs font-semibold uppercase'>
                {EVENT_TYPE[e.type] ?? e.type}
              </span>
              {e.action}
              {e.entity_type && e.type === 'audit' && (
                <span className='text-muted-foreground font-normal'>
                  {' '}
                  · {e.entity_type}
                </span>
              )}
              {e.new_status && e.old_status !== e.new_status && (
                <span className='text-muted-foreground font-normal'>
                  {' '}
                  · {e.old_status ?? '-'} → {e.new_status}
                </span>
              )}
            </p>
            <p className='text-muted-foreground text-xs'>
              {formatDateTime(e.timestamp)} ·{' '}
              {e.actor ? (names.get(e.actor) ?? 'Staff') : 'System'}
            </p>
            {(e.reason || e.note) && (
              <p className='mt-0.5 break-words'>{e.reason ?? e.note}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

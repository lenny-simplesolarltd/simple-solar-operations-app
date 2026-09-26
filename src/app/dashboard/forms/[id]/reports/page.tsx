import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { FormsNotEnabled } from '@/features/forms/components/forms-not-enabled';
import { getForm } from '@/features/forms/server/service';
import { formsEnabled } from '@/features/forms/server/service';
import { ReportSchedules } from '@/features/programmes/components/report-schedules';
import { addDays, localNow } from '@/features/programmes/report-period';
import {
  getFormResponseReport,
  getReportSubscriptions
} from '@/features/programmes/server/queries';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Automated reports | Simple Solar Operations'
};

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * A form's responses, and who they are emailed to.
 *
 * Its own page rather than another block on the builder: setting up a standing
 * instruction to email a client is not part of editing questions, and the
 * builder is crowded enough.
 *
 * The preview is the SAME canonical report the scheduler builds, so what is
 * read here and what is sent cannot differ. Nothing on this page sends
 * anything.
 */
/**
 * The last seven days ending today, so "weekly" previews a week rather than a
 * day. Today is the UK's today, not the server's: a report built just after
 * midnight in British Summer Time would otherwise preview the wrong day.
 *
 * Outside the component, because reading the clock is not something a render
 * may do - and here it also keeps the page's one impure call in one place.
 */
function lastSevenDays() {
  const to = localNow(new Date()).date;
  return { from: addDays(to, -6), to };
}

export default async function FormReportsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await formsEnabled())) return <FormsNotEnabled />;
  const permissions = await getPermissions(user);
  if (!permissions.has('forms.read')) redirect('/dashboard');

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const form = await getForm(id);
  if (!form || form.kind !== 'form') notFound();

  const query = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? '';
  const weekly = one(query.period) === 'weekly';
  const from = isDate(one(query.from)) ? one(query.from) : undefined;
  const to = isDate(one(query.to)) ? one(query.to) : undefined;

  const [report, schedules] = await Promise.all([
    getFormResponseReport(
      id,
      weekly && !from && !to
        ? lastSevenDays()
        : { ...(from ? { from } : {}), ...(to ? { to } : {}) }
    ),
    getReportSubscriptions('Form', id)
  ]);

  return (
    <PageContainer>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6'>
        <div className='flex flex-col gap-1'>
          <Button asChild variant='ghost' size='sm' className='w-fit px-2'>
            <Link href={`/dashboard/forms/${id}`}>
              <IconArrowLeft aria-hidden />
              {form.title}
            </Link>
          </Button>
          <h1 className='text-2xl font-bold'>Automated reports</h1>
          <p className='text-muted-foreground text-sm'>
            What this form collected, and who it is emailed to. Nothing on this
            page sends anything.
          </p>
        </div>

        <section className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-lg font-semibold'>Preview</h2>
            <div className='ml-auto flex gap-1'>
              <Button
                asChild
                size='sm'
                variant={weekly ? 'outline' : 'default'}
              >
                <Link href='?period=daily'>Today</Link>
              </Button>
              <Button
                asChild
                size='sm'
                variant={weekly ? 'default' : 'outline'}
              >
                <Link href='?period=weekly'>Last 7 days</Link>
              </Button>
            </div>
          </div>

          {!report ? (
            <p className='text-muted-foreground text-sm'>
              You do not have access to this form&rsquo;s responses.
            </p>
          ) : (
            <div className='flex flex-col gap-3 rounded-lg border p-4'>
              <div className='flex flex-wrap items-baseline gap-x-4 gap-y-1'>
                <span className='text-2xl font-bold'>{report.responses}</span>
                <span className='text-muted-foreground text-sm'>
                  {report.responses === 1 ? 'response' : 'responses'} ·{' '}
                  {report.from === report.to
                    ? formatDate(report.from)
                    : `${formatDate(report.from)} – ${formatDate(report.to)}`}
                </span>
              </div>

              {report.responses === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  Nothing was submitted in this period.
                </p>
              ) : (
                <ul className='divide-y'>
                  {report.lines.slice(0, 50).map((line, i) => (
                    <li key={i} className='flex flex-col gap-1 py-3'>
                      <p className='text-muted-foreground text-xs'>
                        {formatDate(line.submittedAt)} · answered on version{' '}
                        {line.version}
                        {line.recipient && ` · ${line.recipient}`}
                        {line.jobRef && ` · ${line.jobRef}`}
                      </p>
                      {/* Each answer under the wording of the revision it was
                          actually answered on, never today's wording. */}
                      <dl className='grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-0.5 text-sm'>
                        {(line.fields ?? []).map((field, n) => (
                          <div key={n} className='contents'>
                            <dt className='text-muted-foreground truncate'>
                              {field.label}
                            </dt>
                            <dd className='break-words'>
                              {field.value ?? '—'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}

              {report.lines.length > 50 && (
                <p className='text-muted-foreground text-xs'>
                  Showing the first 50 of {report.lines.length}. Photographs and
                  signatures are never included in a report.
                </p>
              )}
            </div>
          )}
        </section>

        {schedules && (
          <ReportSchedules
            sourceKind='Form'
            sourceId={id}
            subscriptions={schedules.subscriptions}
            runs={schedules.runs}
            canManage={permissions.has('forms.send')}
            previewHref={(type) =>
              type === 'Weekly' ? '?period=weekly' : '?period=daily'
            }
          />
        )}
      </div>
    </PageContainer>
  );
}

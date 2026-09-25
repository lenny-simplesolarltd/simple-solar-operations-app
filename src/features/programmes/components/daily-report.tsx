import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  SIGNAL_LABEL
} from '../labels';
import type { DailyReport } from '../types';

/**
 * A day of a programme, written so it can be read.
 *
 * The summary comes first because that is what the client asks for - how many
 * were attended, how many SIMs went in, how many were nobody home, how many
 * meters need replacing, how many are confirmed live, how many are not, and
 * what is still with the office. Every one of those figures is counted by the
 * database in the same read that produces the lines, so the summary and the
 * detail cannot disagree with each other.
 *
 * They were already being counted before this existed; the only consumer was a
 * CSV, which used the lines and discarded the counters.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

function readableDate(iso: string) {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed) ? iso : DATE.format(parsed);
}

function Figure({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad' | 'info';
}) {
  const tones = {
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-destructive',
    info: 'text-info'
  };
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs font-medium'>{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          // A zero is not a problem, whatever the figure means, so it is not
          // coloured as one.
          tone && value > 0 && tones[tone]
        )}
      >
        {value.toLocaleString('en-GB')}
      </p>
      {hint && <p className='text-muted-foreground mt-0.5 text-xs'>{hint}</p>}
    </div>
  );
}

export function DailyReportView({ report }: { report: DailyReport }) {
  const attended = report.properties_attended;

  return (
    <div className='flex flex-col gap-5'>
      <section className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 className='text-base font-semibold'>
            {readableDate(report.date)}
          </h2>
          <DatePicker date={report.date} />
        </div>

        {attended === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No visits were submitted for this date. That is not the same as no
            work having happened: a visit appears here once the installer has
            submitted it.
          </p>
        ) : (
          <>
            <p className='text-sm'>
              {report.properties_attended.toLocaleString('en-GB')}{' '}
              {attended === 1 ? 'property was' : 'properties were'} attended
              across {report.visits.toLocaleString('en-GB')}{' '}
              {report.visits === 1 ? 'visit' : 'visits'}.
            </p>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
              <Figure label='Properties attended' value={attended} />
              <Figure
                label='SIMs swapped'
                value={report.sims_swapped}
                tone='good'
              />
              <Figure
                label='Confirmed live'
                value={report.portal_confirmed_live}
                tone='good'
                hint='Checked in the PCH portal'
              />
              <Figure
                label='Not live'
                value={report.portal_not_live}
                tone='bad'
                hint='Checked, and not reporting'
              />
              <Figure
                label='No access'
                value={report.no_access}
                tone='warn'
                hint='To be rebooked'
              />
              <Figure
                label='Meters requiring replacement'
                value={report.meters_requiring_replacement}
                tone='bad'
              />
              <Figure
                label='Action required'
                value={report.action_required}
                tone='bad'
              />
              <Figure
                label='Complete and working'
                value={report.complete_and_live}
                tone='good'
              />
              <Figure
                label='Awaiting review'
                value={report.awaiting_review}
                tone='info'
                hint='With the office'
              />
              <Figure
                label='Awaiting portal check'
                value={report.awaiting_portal_confirmation}
                tone='info'
              />
              <Figure
                label='Could not be verified'
                value={report.portal_unable_to_verify}
                tone='warn'
              />
              <Figure
                label='Serial mismatches'
                value={report.serial_mismatches}
                tone='bad'
                hint='Meter on site was not the expected one'
              />
            </div>
          </>
        )}
      </section>

      {report.lines.length > 0 && (
        <section className='flex flex-col gap-2'>
          <h3 className='text-sm font-semibold tracking-wide uppercase'>
            Every property attended
          </h3>
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50 text-left'>
                <tr>
                  {[
                    'Property',
                    'Installer',
                    'Outcome',
                    'Meter',
                    'New SIM',
                    'Signal',
                    'Portal',
                    'Status'
                  ].map((h) => (
                    <th key={h} className='px-3 py-2 font-medium'>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr
                    key={`${line.external_ref}-${line.new_sim_serial ?? ''}`}
                    className='border-t align-top'
                  >
                    <td className='px-3 py-2'>
                      <span className='font-medium'>{line.address}</span>
                      <span className='text-muted-foreground block text-xs'>
                        {[line.postcode, line.external_ref]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className='px-3 py-2'>{line.installer ?? '—'}</td>
                    <td className='px-3 py-2'>{OUTCOME_LABEL[line.outcome]}</td>
                    <td className='px-3 py-2'>
                      {line.actual_meter_serial ?? '—'}
                      {line.meter_serial_matches === false && (
                        <span className='text-destructive block text-xs font-semibold'>
                          Expected {line.expected_meter_serial}
                        </span>
                      )}
                    </td>
                    <td className='px-3 py-2'>{line.new_sim_serial ?? '—'}</td>
                    <td className='px-3 py-2'>
                      {line.csq === null
                        ? '—'
                        : `${line.csq}${
                            line.signal_classification
                              ? ` · ${SIGNAL_LABEL[line.signal_classification]}`
                              : ''
                          }`}
                    </td>
                    <td className='px-3 py-2'>
                      {line.portal_verification
                        ? PORTAL_LABEL[line.portal_verification]
                        : 'Not checked'}
                    </td>
                    <td className='px-3 py-2'>
                      {DISPOSITION_LABEL[line.disposition]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className='text-muted-foreground text-xs'>
        Read live from the programme&rsquo;s own data. Nothing on this page is
        emailed to anyone; the CSV download is a file, not a send.
      </p>
    </div>
  );
}

/** Yesterday and tomorrow as links, so no client-side state is needed. */
function DatePicker({ date }: { date: string }) {
  const shift = (days: number) => {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed + days * 86400000).toISOString().slice(0, 10);
  };
  const previous = shift(-1);
  const next = shift(1);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <nav aria-label='Report date' className='flex items-center gap-2 text-sm'>
      {previous && (
        <Link
          href={`?date=${previous}`}
          className='hover:bg-accent rounded-md border px-3 py-1.5'
        >
          Previous day
        </Link>
      )}
      {date !== today && (
        <Link
          href={`?date=${today}`}
          className='hover:bg-accent rounded-md border px-3 py-1.5'
        >
          Today
        </Link>
      )}
      {next && next <= today && (
        <Link
          href={`?date=${next}`}
          className='hover:bg-accent rounded-md border px-3 py-1.5'
        >
          Next day
        </Link>
      )}
    </nav>
  );
}

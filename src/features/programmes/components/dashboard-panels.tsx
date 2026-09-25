import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { signalBandsSentence } from '../labels';
import type { ProgrammeDashboard } from '../types';

/**
 * Programme reporting, read live from the programme data.
 *
 * Every number here comes from one server read (PROGRAMME_DASHBOARD) computed in
 * SQL, so the dashboard, the list and the CSV export cannot disagree about what
 * "attended" means.
 */

function Stat({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: number | string;
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
          tone && tones[tone]
        )}
      >
        {value}
      </p>
      {hint && <p className='text-muted-foreground mt-0.5 text-xs'>{hint}</p>}
    </div>
  );
}

/** Progress and run rate: how much is done, and what that implies. */
export function ProgressPanel({ data }: { data: ProgrammeDashboard }) {
  const { total_properties: total, attended, remaining } = data;
  const percent = total > 0 ? Math.round((attended / total) * 100) : 0;
  const days = data.by_day.length;
  // The average over days actually worked, not over calendar days: a weekend
  // with no visits should not flatter or damage the rate.
  const perDay = days > 0 ? data.visits_total / days : 0;
  const daysLeft = perDay > 0 ? Math.ceil(remaining / perDay) : null;

  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-sm font-semibold tracking-wide uppercase'>
          Progress
        </h3>
        <p className='text-muted-foreground text-sm tabular-nums'>
          {attended} of {total} properties attended ({percent}%)
        </p>
      </div>
      <Progress value={percent} aria-label={`${percent}% attended`} />
      <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4'>
        <dt className='text-muted-foreground'>Remaining</dt>
        <dd className='font-medium tabular-nums'>{remaining}</dd>
        <dt className='text-muted-foreground'>Days worked</dt>
        <dd className='font-medium tabular-nums'>{days}</dd>
        <dt className='text-muted-foreground'>Run rate</dt>
        <dd className='font-medium tabular-nums'>
          {perDay ? `${perDay.toFixed(1)} visits/day` : '—'}
        </dd>
        <dt className='text-muted-foreground'>At this rate</dt>
        <dd className='font-medium tabular-nums'>
          {daysLeft === null
            ? '—'
            : `${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}`}
        </dd>
      </dl>
    </section>
  );
}

export function StatGrid({ data }: { data: ProgrammeDashboard }) {
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
      <Stat label='Total properties' value={data.total_properties} />
      <Stat label='Attended' value={data.attended} />
      <Stat label='Remaining' value={data.remaining} />
      <Stat label='Visits today' value={data.visits_today} tone='info' />
      <Stat label='SIMs changed' value={data.sims_changed} />
      <Stat label='No access' value={data.no_access} tone='warn' />
      <Stat label='Meter dead' value={data.meter_dead} tone='bad' />
      <Stat
        label='Awaiting review'
        value={data.awaiting_review}
        tone='info'
        hint='With the office'
      />
      <Stat label='Action required' value={data.action_required} tone='bad' />
      <Stat
        label='Meter replacements'
        value={data.meter_replacements_required}
        tone='bad'
      />
      <Stat
        label='Serial mismatches'
        value={data.serial_mismatches}
        tone='bad'
        hint='Meter on site was not the expected one'
      />
      <Stat
        label='Complete & working'
        value={data.complete_and_working}
        tone='good'
        hint='Confirmed live in the portal'
      />
    </div>
  );
}

/** The portal check, kept visually separate from the signal. */
export function PortalPanel({ data }: { data: ProgrammeDashboard }) {
  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold tracking-wide uppercase'>
        PCH portal verification
      </h3>
      <p className='text-muted-foreground text-sm'>
        A good CSQ does not mean the meter is working. These are the
        office&rsquo;s own checks of the external portal.
      </p>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Stat
          label='Confirmed live'
          value={data.portal_confirmed_live}
          tone='good'
        />
        <Stat label='Not live' value={data.portal_not_live} tone='bad' />
        <Stat
          label='Unable to verify'
          value={data.portal_unable_to_verify}
          tone='warn'
        />
        <Stat
          label='Not yet checked'
          value={data.portal_outstanding}
          tone='info'
          hint='SIM changed, portal still to check'
        />
      </div>
    </section>
  );
}

export function CsqPanel({
  data,
  boundaryUnresolved
}: {
  data: ProgrammeDashboard;
  boundaryUnresolved: boolean;
}) {
  const bands = data.csq_bands;
  const total = bands.good + bands.advisory + bands.bad;
  const rows = [
    { label: 'Good', value: bands.good, tone: 'bg-success' },
    { label: 'Advisory', value: bands.advisory, tone: 'bg-warning' },
    { label: 'Bad', value: bands.bad, tone: 'bg-destructive' }
  ];
  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold tracking-wide uppercase'>
        CSQ bands
      </h3>
      <p className='text-muted-foreground text-sm'>
        {signalBandsSentence(data.programme.signal_config)}
      </p>
      {boundaryUnresolved && (
        <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm font-medium'>
          The bad/advisory boundary is not yet confirmed with the client. The
          client has said both &ldquo;4 or below is bad&rdquo; and
          &ldquo;approximately 4 to 14 is advisory&rdquo;. It is currently
          configured as 4-is-bad; confirm with Dan/Ben.
        </p>
      )}
      <ul className='flex flex-col gap-2'>
        {rows.map((r) => (
          <li key={r.label} className='flex items-center gap-3 text-sm'>
            <span className='w-20 shrink-0'>{r.label}</span>
            <span className='bg-muted h-3 flex-1 overflow-hidden rounded-full'>
              <span
                className={cn('block h-full rounded-full', r.tone)}
                style={{ width: total ? `${(r.value / total) * 100}%` : '0%' }}
              />
            </span>
            <span className='w-10 shrink-0 text-right tabular-nums'>
              {r.value}
            </span>
          </li>
        ))}
      </ul>
      {bands.not_recorded > 0 && (
        <p className='text-muted-foreground text-xs'>
          {bands.not_recorded} visits recorded no CSQ (no access, or a dead
          meter).
        </p>
      )}
    </section>
  );
}

export function ByInstallerPanel({ data }: { data: ProgrammeDashboard }) {
  if (data.by_installer.length === 0) return null;
  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold tracking-wide uppercase'>
        By installer
      </h3>
      <table className='w-full text-sm'>
        <thead>
          <tr className='text-muted-foreground text-left text-xs'>
            <th scope='col' className='pb-1 font-medium'>
              Installer
            </th>
            <th scope='col' className='pb-1 text-right font-medium'>
              Visits
            </th>
            <th scope='col' className='pb-1 text-right font-medium'>
              SIMs
            </th>
            <th scope='col' className='pb-1 text-right font-medium'>
              No access
            </th>
          </tr>
        </thead>
        <tbody>
          {data.by_installer.map((row) => (
            <tr key={row.installer_id} className='border-t'>
              <td className='py-1.5'>{row.installer ?? 'Unknown'}</td>
              <td className='py-1.5 text-right tabular-nums'>{row.visits}</td>
              <td className='py-1.5 text-right tabular-nums'>
                {row.sims_changed}
              </td>
              <td className='py-1.5 text-right tabular-nums'>
                {row.no_access}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ByDayPanel({ data }: { data: ProgrammeDashboard }) {
  if (data.by_day.length === 0) return null;
  const peak = Math.max(...data.by_day.map((d) => d.visits), 1);
  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold tracking-wide uppercase'>By day</h3>
      <ul className='flex flex-col gap-1.5'>
        {data.by_day.map((d) => (
          <li key={d.date} className='flex items-center gap-3 text-sm'>
            <span className='w-24 shrink-0 tabular-nums'>{d.date}</span>
            <span className='bg-muted h-4 flex-1 overflow-hidden rounded'>
              <span
                className='bg-primary block h-full rounded'
                style={{ width: `${(d.visits / peak) * 100}%` }}
              />
            </span>
            <span className='w-8 shrink-0 text-right tabular-nums'>
              {d.visits}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

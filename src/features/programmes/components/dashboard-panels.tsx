import { Progress } from '@/components/ui/progress';
import Link from 'next/link';
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
  // "0 of 0 properties attended (0%)" reads as a finished programme with
  // nothing in it. Until something is imported there is no progress to show.
  if (total === 0) return null;
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

/**
 * Delivery against the target, which is a different question from progress
 * through the import.
 *
 * "1,036 of 1,036 attended" reads as finished, and is what this screen used to
 * say, when the programme is contracted to reach about 1,400 properties and only
 * 1,036 have been handed over. The two denominators are both shown, labelled,
 * because they mean different things:
 *
 *   Imported   - properties in the system now
 *   Target     - properties the programme is expected to reach
 *   Attended   - visited at least once
 *   Completed  - a visit reached Complete & working, so the meter IS live
 *
 * Nothing is derived from a date that has not been recorded. Where there is no
 * delivery window, this says the window has not been recorded rather than
 * printing a required-per-day figure computed from a date nobody agreed.
 */
export function DeliveryPanel({
  data,
  importHref
}: {
  data: ProgrammeDashboard;
  /** Where importing happens, when this person may import. */
  importHref?: string | null;
}) {
  const {
    total_properties: imported,
    attended,
    completed_properties: completed,
    target_property_count: target,
    delivery_end_date: endDate,
    today
  } = data;

  const remainingImported = Math.max(imported - attended, 0);
  const remainingTarget =
    target === null ? null : Math.max(target - completed, 0);
  const awaitingImport =
    target === null ? null : Math.max(target - imported, 0);
  const n = (v: number) => v.toLocaleString('en-GB');

  // Nothing imported yet is not a progress figure, it is a blocked programme.
  // Showing "Target 0" or "0% attended" here read as a target of nothing, when
  // the truth is that 1,400 properties are expected and none have arrived.
  if (imported === 0) {
    return (
      <section className='flex flex-col gap-3 rounded-lg border p-4'>
        <h3 className='text-sm font-semibold tracking-wide uppercase'>
          Delivery
        </h3>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3'>
          <dt className='text-muted-foreground'>Programme target</dt>
          <dd className='font-medium tabular-nums'>
            {target === null ? 'Not recorded' : n(target)}
          </dd>
          <dt className='text-muted-foreground'>Properties imported</dt>
          <dd className='font-medium tabular-nums'>
            {target === null ? '0' : `0 / ${n(target)}`}
          </dd>
          <dt className='text-muted-foreground'>Awaiting import</dt>
          <dd className='font-medium tabular-nums'>
            {awaitingImport === null ? 'Unknown' : n(awaitingImport)}
          </dd>
        </dl>
        <div className='bg-muted/40 flex flex-col gap-2 rounded-lg border border-dashed p-4'>
          <p className='font-medium'>No properties imported yet</p>
          <p className='text-muted-foreground text-sm'>
            Nothing can be visited, reviewed or reported on until the client
            sends the property list and it is imported. Every figure below is
            therefore zero, not missing.
          </p>
          {importHref && (
            <Link
              href={importHref}
              className='bg-primary text-primary-foreground hover:bg-primary/90 mt-1 inline-flex min-h-11 w-fit items-center rounded-md px-4 text-sm font-medium'
            >
              Import PCH property list
            </Link>
          )}
        </div>
      </section>
    );
  }

  // Working days left, counted honestly: only from a recorded end date, and only
  // while it is still in the future.
  const daysLeft = (() => {
    if (!endDate) return null;
    const end = Date.parse(`${endDate}T00:00:00Z`);
    const now = Date.parse(`${today}T00:00:00Z`);
    if (Number.isNaN(end) || Number.isNaN(now)) return null;
    const days = Math.ceil((end - now) / 86400000);
    return days > 0 ? days : 0;
  })();

  const perDayNeeded =
    remainingTarget !== null && daysLeft !== null && daysLeft > 0
      ? remainingTarget / daysLeft
      : null;

  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h3 className='text-sm font-semibold tracking-wide uppercase'>
        Delivery
      </h3>
      <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3'>
        <dt className='text-muted-foreground'>Programme target</dt>
        <dd className='font-medium tabular-nums'>
          {target === null ? 'Not recorded' : n(target)}
        </dd>
        <dt className='text-muted-foreground'>Properties imported</dt>
        <dd className='font-medium tabular-nums'>
          {target === null ? n(imported) : `${n(imported)} / ${n(target)}`}
        </dd>
        <dt className='text-muted-foreground'>Awaiting import</dt>
        <dd className='font-medium tabular-nums'>
          {awaitingImport === null ? 'Unknown' : n(awaitingImport)}
        </dd>
        <dt className='text-muted-foreground'>Attended</dt>
        <dd className='font-medium tabular-nums'>{n(attended)}</dd>
        <dt className='text-muted-foreground'>Completed and live</dt>
        <dd className='font-medium tabular-nums'>{n(completed)}</dd>
        <dt className='text-muted-foreground'>Remaining of imported</dt>
        <dd className='font-medium tabular-nums'>{n(remainingImported)}</dd>
        <dt className='text-muted-foreground'>Remaining against target</dt>
        <dd className='font-medium tabular-nums'>
          {remainingTarget === null ? 'No target recorded' : n(remainingTarget)}
        </dd>
      </dl>

      <p className='text-muted-foreground text-sm'>
        {perDayNeeded === null
          ? endDate
            ? 'The delivery window has closed, so no required daily rate is shown.'
            : 'No delivery window has been recorded, so no required daily rate is shown.'
          : `${perDayNeeded.toFixed(1)} completions a day to reach the target by ${endDate}, with ${n(daysLeft as number)} ${daysLeft === 1 ? 'day' : 'days'} left.`}
      </p>
    </section>
  );
}

/**
 * The work the office has to do something about, separated from the general
 * counts.
 *
 * These four were four tiles among fourteen, so "37 meters need replacing" had
 * exactly the same weight as "SIMs changed". They are the only figures on this
 * screen that represent a property that is stuck, and each one links to the
 * visits it is counting, because the next question is always "which ones?".
 */
export function NeedsActionPanel({
  data,
  basePath
}: {
  data: ProgrammeDashboard;
  basePath: string;
}) {
  const items = [
    {
      label: 'Awaiting review',
      value: data.awaiting_review,
      hint: 'Submitted, not yet checked',
      href: `${basePath}/review` as string | null,
      tone: 'info' as const
    },
    {
      label: 'Action required',
      value: data.action_required,
      hint: 'Something must be done before this property is finished',
      href: `${basePath}/visits?disposition=ActionRequired`,
      tone: 'bad' as const
    },
    {
      label: 'Meter replacements',
      value: data.meter_replacements_required,
      hint: 'The meter itself has to be changed',
      href: `${basePath}/visits?disposition=MeterRequiresChanging`,
      tone: 'bad' as const
    },
    {
      label: 'No access — rebook',
      value: data.no_access_rebook,
      hint: 'Nobody in. Needs another appointment',
      href: `${basePath}/visits?disposition=NoAccessRebook`,
      tone: 'warn' as const
    },
    {
      label: 'Portal checks outstanding',
      value: data.portal_outstanding,
      hint: 'Cannot be completed until the portal is checked',
      // No link: "checked but with no answer yet" is not one of the filters the
      // list understands, and a link that quietly showed a different set of
      // visits would be worse than no link.
      href: null,
      tone: 'warn' as const
    }
  ];
  const total = items.reduce((a, b) => a + b.value, 0);

  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h3 className='text-sm font-semibold tracking-wide uppercase'>
          Needs office action
        </h3>
        <p className='text-muted-foreground text-sm tabular-nums'>
          {total === 0
            ? 'Nothing outstanding'
            : `${total.toLocaleString('en-GB')} outstanding`}
        </p>
      </div>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
        {items.map((item) => {
          const body = (
            <>
              <span className='text-muted-foreground text-xs font-medium'>
                {item.label}
              </span>
              <span
                className={cn(
                  'mt-0.5 text-2xl font-semibold tabular-nums',
                  item.value > 0 &&
                    {
                      info: 'text-info',
                      warn: 'text-warning',
                      bad: 'text-destructive'
                    }[item.tone]
                )}
              >
                {item.value.toLocaleString('en-GB')}
              </span>
              <span className='text-muted-foreground mt-0.5 text-xs'>
                {item.hint}
              </span>
            </>
          );
          const shell = 'flex min-h-11 flex-col rounded-lg border p-3';
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={cn(shell, 'hover:bg-accent/50')}
            >
              {body}
            </Link>
          ) : (
            <div key={item.label} className={shell}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function StatGrid({ data }: { data: ProgrammeDashboard }) {
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
      <Stat label='Total properties' value={data.total_properties} />
      <Stat label='Attended' value={data.attended} />
      <Stat
        label='Completed and live'
        value={data.completed_properties}
        tone='good'
        hint='The meter is live in the portal'
      />
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

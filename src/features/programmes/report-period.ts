/**
 * Reporting periods, in UK local time.
 *
 * A programme's day is a Europe/London calendar day, not the server's. The
 * difference is not academic: through BST the server's UTC day ends an hour
 * late, so a 23:30 visit would land in the following day's report and the
 * numbers Dan reads would not match the board he is looking at.
 *
 * Everything here is derived with Intl rather than by adding offsets, so the
 * two days a year that are 23 and 25 hours long need no special case.
 */

export type ReportType = 'Daily' | 'Weekly';

export const UK = 'Europe/London';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false
});

/** The local calendar date and hour at an instant, as the UK sees them. */
export function localNow(at: Date, timeZone: string = UK) {
  const format =
    timeZone === UK
      ? PARTS
      : new Intl.DateTimeFormat('en-GB', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          hour12: false
        });
  const parts = Object.fromEntries(
    format.formatToParts(at).map((p) => [p.type, p.value])
  );
  // 24 is midnight in some locales' hour12:false output.
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

const DAY = 86_400_000;

/** A plain YYYY-MM-DD shifted by whole days, with no timezone arithmetic. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return at.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export interface Period {
  from: string;
  to: string;
}

/**
 * The period a report covers when it runs at `at`.
 *
 * Always a CLOSED period: the day being reported has finished. A daily report
 * covers yesterday; a weekly one covers the last complete week that ended
 * before the current one began.
 */
export function periodFor(
  reportType: ReportType,
  at: Date,
  options: { timeZone?: string; weekStartsOn?: number } = {}
): Period {
  const { date } = localNow(at, options.timeZone ?? UK);
  const yesterday = addDays(date, -1);
  if (reportType === 'Daily') return { from: yesterday, to: yesterday };

  const startsOn = options.weekStartsOn ?? 1;
  // Walk back to the last day before a week begins: that is the week's end.
  let end = yesterday;
  while (isoWeekday(addDays(end, 1)) !== startsOn) end = addDays(end, -1);
  return { from: addDays(end, -6), to: end };
}

/** True when the local hour has reached the schedule's send hour. */
export function isDue(
  at: Date,
  sendHour: number,
  timeZone: string = UK
): boolean {
  return localNow(at, timeZone).hour >= sendHour;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/**
 * "Thu 25 Sep 2026", for a subject line or a heading.
 *
 * Spelled out here rather than through Intl: an email subject should not
 * change shape because the server's ICU data did, and en-GB renders September
 * as both "Sep" and "Sept" depending on the build.
 */
export function readableDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[at.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * When the next report would go out, when that can be said for certain.
 *
 * Only from the schedule itself - never from "the last run plus a week", which
 * would be wrong the moment a run was missed or sent by hand.
 */
export function nextDue(
  reportType: ReportType,
  sendHour: number,
  at: Date = new Date(),
  options: { timeZone?: string; weekStartsOn?: number } = {}
): string {
  const zone = options.timeZone ?? UK;
  const { date, hour } = localNow(at, zone);
  if (reportType === 'Daily')
    return `${hour < sendHour ? date : addDays(date, 1)} at ${String(sendHour).padStart(2, '0')}:00`;

  const startsOn = options.weekStartsOn ?? 1;
  // The week restarts on startsOn, so the report goes on that day.
  let day = hour < sendHour ? date : addDays(date, 1);
  while (isoWeekday(day) !== startsOn) day = addDays(day, 1);
  return `${day} at ${String(sendHour).padStart(2, '0')}:00`;
}

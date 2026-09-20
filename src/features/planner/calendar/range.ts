// Date maths for the operations calendar. Pure, client-safe, no I/O.
//
// Every operational date in this system is a plain calendar date - work
// packages, allocations and scaffold bookings all store `date`, never a
// timestamp. So the calendar works in 'YYYY-MM-DD' strings throughout and
// never constructs a local-midnight Date (which shifts a day either side of a
// DST boundary). Where a Date is unavoidable it is noon UTC, as the rest of
// the planner code does.

/** A calendar day, 'YYYY-MM-DD'. */
export type Day = string;

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const noon = (day: Day) => new Date(`${day}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** n days after (or, negative, before) a day. */
export function addDays(day: Day, n: number): Day {
  const d = noon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonths(day: Day, n: number): Day {
  const d = noon(day);
  const target = d.getUTCMonth() + n;
  // Clamp rather than roll over: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const first = new Date(Date.UTC(d.getUTCFullYear(), target, 1, 12));
  const lastOfTarget = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)
  ).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), lastOfTarget));
  return iso(first);
}

/** Days between two days, inclusive of both ends. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000);
}

/** Every day from `from` to `to` inclusive. */
export function eachDay(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Monday ... 6 = Sunday. The working week here starts on Monday. */
export function weekday(day: Day): number {
  return (noon(day).getUTCDay() + 6) % 7;
}

export const isWeekend = (day: Day) => weekday(day) >= 5;

/** The Monday of the week containing `day`. */
export const startOfWeek = (day: Day) => addDays(day, -weekday(day));

export const startOfMonth = (day: Day) => `${day.slice(0, 7)}-01`;

export function endOfMonth(day: Day): Day {
  const d = noon(day);
  return iso(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
  );
}

/** Today in Europe/London, which is the timezone every stored date means. */
export function today(now: Date = new Date()): Day {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

// -----------------------------------------------------------------------------
// Views
// -----------------------------------------------------------------------------

export type ViewId = 'day' | 'week' | '3w' | '6w' | 'month' | 'team';

export interface ViewDef {
  id: ViewId;
  label: string;
  /** Short label for narrow screens. */
  short: string;
  /** A grid of weeks (month/3w/6w) rather than a single strip of days. */
  weeks: boolean;
}

export const VIEWS: ViewDef[] = [
  { id: 'day', label: 'Day', short: 'D', weeks: false },
  { id: 'week', label: 'Week', short: 'W', weeks: false },
  { id: '3w', label: '3 weeks', short: '3W', weeks: true },
  { id: '6w', label: '6 weeks', short: '6W', weeks: true },
  { id: 'month', label: 'Month', short: 'M', weeks: true },
  { id: 'team', label: 'Team', short: 'T', weeks: false }
];

export const isViewId = (v: string): v is ViewId =>
  VIEWS.some((x) => x.id === v);

/**
 * The visible window for a view anchored on a date.
 *
 * Day is the single day; everything else is whole Monday-Sunday weeks, so a
 * week grid always has seven aligned columns. Month is the weeks that overlap
 * the month, which is why it can be five or six rows.
 */
export function windowFor(view: ViewId, anchor: Day): { from: Day; to: Day } {
  switch (view) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week':
    case 'team': {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case '3w': {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 20) };
    }
    case '6w': {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 41) };
    }
    case 'month': {
      const from = startOfWeek(startOfMonth(anchor));
      const to = addDays(startOfWeek(endOfMonth(anchor)), 6);
      return { from, to };
    }
  }
}

/**
 * What to fetch for a window: the window itself plus one week either side.
 *
 * The buffer is what makes stepping to the neighbouring week or month feel
 * instant without fetching a quarter at a time. PLANNER_WINDOW refuses
 * anything over 186 days; the widest view plus its buffer is 56, so the cap is
 * never reached from here.
 */
export function fetchWindow(view: ViewId, anchor: Day) {
  const { from, to } = windowFor(view, anchor);
  return { from: addDays(from, -7), to: addDays(to, 7) };
}

/** Where previous/next go: a day, a week, or a month at a time. */
export function step(view: ViewId, anchor: Day, direction: 1 | -1): Day {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
    case 'team':
      return addDays(anchor, 7 * direction);
    case '3w':
      return addDays(anchor, 21 * direction);
    case '6w':
      return addDays(anchor, 42 * direction);
    case 'month':
      return startOfMonth(addMonths(startOfMonth(anchor), direction));
  }
}

/** The weeks of a window, as rows of seven days. Only meaningful for week grids. */
export function weekRows(from: Day, to: Day): Day[][] {
  const rows: Day[][] = [];
  for (let start = from; start <= to; start = addDays(start, 7)) {
    rows.push(eachDay(start, addDays(start, 6)));
  }
  return rows;
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });

const LONG = fmt({
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
const MEDIUM = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const SHORT = fmt({ day: 'numeric', month: 'short' });
const MONTH_YEAR = fmt({ month: 'long', year: 'numeric' });
const WEEKDAY_SHORT = fmt({ weekday: 'short' });
const DAY_NUM = fmt({ day: 'numeric' });

export const formatLong = (day: Day) => LONG.format(noon(day));
export const formatMedium = (day: Day) => MEDIUM.format(noon(day));
export const formatShort = (day: Day) => SHORT.format(noon(day));
export const formatWeekday = (day: Day) => WEEKDAY_SHORT.format(noon(day));
export const formatDayNumber = (day: Day) => DAY_NUM.format(noon(day));

/** The heading above the calendar: what the user is looking at. */
export function windowTitle(view: ViewId, anchor: Day): string {
  const { from, to } = windowFor(view, anchor);
  if (view === 'day') return formatLong(anchor);
  if (view === 'month') return MONTH_YEAR.format(noon(anchor));
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${formatShort(from)} – ${formatMedium(to)}`
    : `${formatMedium(from)} – ${formatMedium(to)}`;
}

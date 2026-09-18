const LOCALE = 'en-GB';

/** Fixed-decimal number with thousands separators; an em dash when not finite. */
export function fmt(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `£${fmt(n, 2)}`;
}

export function moneyFromPence(pence: number): string {
  return money(pence / 100);
}

const DUE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

/** A task due date in UK local time, or "No due date". */
export function formatDue(iso: string | null): string {
  if (!iso) return 'No due date';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'No due date';
  return DUE_FORMAT.format(date);
}

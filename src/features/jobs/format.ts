export const pounds = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP'
});

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});
const londonDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London'
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** Overdue / due today are judged on the Europe/London calendar day, as the reference read models do. */
export function dueState(
  iso: string | null
): 'none' | 'overdue' | 'today' | 'upcoming' {
  if (!iso) return 'none';
  const due = londonDay.format(new Date(iso));
  const today = londonDay.format(new Date());
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
}

export const FINANCE_LABEL: Record<string, string> = {
  Standard: 'No finance',
  Phoenix: 'Phoenix finance',
  OtherReview: 'Other finance'
};

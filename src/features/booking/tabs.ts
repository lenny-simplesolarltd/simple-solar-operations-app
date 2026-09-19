// The Booking screen's tabs. A plain module on purpose: the server page reads
// it (to describe the current view) and the client tab bar renders it. A value
// exported from a 'use client' file is only a reference on the server, so it
// cannot live in booking-tabs.tsx.
export const BOOKING_TABS = [
  { value: 'queue', label: 'Booking tasks' },
  { value: 'prebooking', label: 'Prebooking' },
  { value: 'ready', label: 'Ready to book' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'upcoming', label: 'Upcoming' }
] as const;

export type BookingTab = (typeof BOOKING_TABS)[number]['value'];

export const bookingTabLabel = (view: string): string | undefined =>
  BOOKING_TABS.find((tab) => tab.value === view)?.label;

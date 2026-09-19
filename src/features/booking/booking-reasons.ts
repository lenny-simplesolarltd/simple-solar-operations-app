import type { CommandFlag } from '@/lib/backend/types';

// Staff wording for booking availability reasons. A plain module (not
// 'use client') so server pages and client buttons can both call it.

const REASON: Record<string, string> = {
  NOT_ASSIGNED: 'You are not assigned to this job.',
  OFFICE_OR_ADMIN_REQUIRED: 'Only office managers can confirm bookings.',
  BOOKING_CHECKS_OUTSTANDING: 'Some booking checks are still outstanding.',
  STAGE_NOT_ELIGIBLE: 'The job is not at this booking step.',
  ALREADY_BOOKED: 'Already booked.',
  MODE_UNAVAILABLE: 'Booking is switched off at the moment.',
  JOB_NOT_ACTIONABLE: 'The job is cancelled or archived.'
};

export const bookingReason = (flag: CommandFlag | undefined) =>
  flag?.reason ? (REASON[flag.reason] ?? flag.reason) : undefined;

import type { WorkflowStage } from '@/lib/backend/models';

// Staff wording for jobs.workflow_stage. Safe to import from client components.
export const STAGE_LABEL: Record<WorkflowStage, string> = {
  Prebooking: 'Prebooking',
  ReadyToBook: 'Ready to book',
  BookingInProgress: 'Booking in progress',
  Booked: 'Booked',
  AwaitingInstallation: 'Awaiting installation',
  InProgress: 'Install in progress',
  Aftercare: 'Aftercare',
  OperationallyComplete: 'Operationally complete',
  CancellationInProgress: 'Cancellation in progress',
  Cancelled: 'Cancelled'
};

export const stageLabel = (stage: string) =>
  STAGE_LABEL[stage as WorkflowStage] ?? stage;

/** Stages where the job still needs operational work. */
export const ACTIVE_STAGES: WorkflowStage[] = [
  'Prebooking',
  'ReadyToBook',
  'BookingInProgress',
  'Booked',
  'AwaitingInstallation',
  'InProgress',
  'Aftercare'
];

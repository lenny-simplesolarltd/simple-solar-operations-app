// Shapes of the backend read models the screens render. They mirror the JSON
// built by the app.read_* functions (supabase/migrations); the database stays
// the authority - these types only describe what comes back. Safe to import
// from client components.

import type { CommandFlag } from './types';

/** app.due_window classes, judged on the Europe/London day. */
export type DueClass =
  | 'OVERDUE'
  | 'DUE_TODAY'
  | 'DUE_TOMORROW'
  | 'NEXT_7_DAYS'
  | 'NORMAL_LATER'
  | 'NO_DUE';

/** app.s17_task_view (+ TASKS extras). `due_at` is the London due DATE (YYYY-MM-DD). */
export interface TaskView {
  id: string;
  job_id: string | null;
  title: string;
  group: string | null;
  owner_id: string | null;
  backup_id: string | null;
  due_at: string | null;
  status: string;
  priority: number | null;
  blocking_reason: string | null;
  template_code: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  version: number;
  due_class: DueClass;
  due_class_label: string | null;
  days_delta: number | null;
  job_ref: string | null;
  customer_name: string | null;
  postcode: string | null;
  owner_name: string | null;
  backup_name: string | null;
  job_label: string | null;
  customer_redacted?: boolean;
  completed_at?: string | null;
  completed_by_name?: string | null;
  next_followup_at?: string | null;
}

export type TaskScope = 'my' | 'team' | 'all';
export type TaskStatusFilter = 'open' | 'closed' | 'all';
export type TaskDueFilter =
  | 'any'
  | 'overdue'
  | 'today'
  | 'soon'
  | 'later'
  | 'none'
  | 'dated';
export const TASK_QUEUES = [
  'booking',
  'calls',
  'issues',
  'payments',
  'ghl',
  'cancellation',
  'materials',
  'scaffold',
  'install',
  'system'
] as const;
export type TaskQueue = (typeof TASK_QUEUES)[number];

export interface TasksRead {
  scope: TaskScope;
  status: TaskStatusFilter;
  due: TaskDueFilter;
  queue: TaskQueue | null;
  as_of: string;
  count: number;
  total: number;
  truncated: boolean;
  can_view_team: boolean;
  tasks: TaskView[];
}

export interface TaskEvent {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_owner_name: string | null;
  new_owner_name: string | null;
  old_due: string | null;
  new_due: string | null;
  reason: string | null;
  actor_name: string;
  occurred_at: string;
}

export interface TaskAvailability {
  task_id: string;
  status: string;
  template_code: string | null;
  version: number;
  assigned: boolean;
  actions: {
    complete: { available: boolean; note: string | null };
    reopen: { available: boolean; note: string | null };
  };
  commands: {
    task_complete: CommandFlag;
    task_reopen: CommandFlag;
    task_evidence_attach: CommandFlag;
    start_job_booking: CommandFlag;
  };
}

export interface TaskDetailRead {
  task: TaskView & {
    completion_note: string | null;
    completed_at: string | null;
    completed_by_name: string | null;
    evidence_id: string | null;
    next_followup_at: string | null;
    original_due_at: string | null;
    revision_required: boolean;
    created_at: string;
    is_mine: boolean;
  };
  job: {
    id: string;
    job_ref: string;
    workflow_stage: string;
    version: number;
    finance_route: string | null;
    customer_name: string | null;
    postcode: string | null;
  } | null;
  evidence: {
    id: string;
    category: string;
    filename: string | null;
    storage_path: string;
    received_at: string | null;
  } | null;
  events: TaskEvent[];
  availability: TaskAvailability;
}

export const WORKFLOW_STAGES = [
  'Prebooking',
  'ReadyToBook',
  'BookingInProgress',
  'Booked',
  'AwaitingInstallation',
  'InProgress',
  'Aftercare',
  'OperationallyComplete',
  'CancellationInProgress',
  'Cancelled'
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export interface JobRow {
  id: string;
  job_ref: string;
  display_name: string | null;
  customer_name: string | null;
  postcode: string | null;
  town: string | null;
  quote_reference: string | null;
  workflow_stage: string;
  finance_route: string | null;
  sold_at: string | null;
  salesperson_name: string | null;
  next_action_at: string | null;
  booking_approved_at: string | null;
  open_tasks: number;
  overdue_tasks: number;
  next_task: {
    id: string;
    title: string;
    due_at: string | null;
    owner_name: string | null;
    status: string;
  } | null;
}

export interface JobsRead {
  q: string | null;
  stage: string[] | null;
  count: number;
  total: number;
  truncated: boolean;
  jobs: JobRow[];
}

export interface OfficeDashboardRead {
  as_of: string;
  my_tasks: {
    open: number;
    overdue: number;
    due_today: number;
    due_soon: number;
    waiting: number;
    booking: number;
  };
  jobs_by_stage: Record<string, number>;
  operations: {
    team_overdue: number | null;
    booking_queue: number | null;
    intake_review: number | null;
    commissioning_review: number;
    open_issues: number;
    blocking_issues: number;
    draft_orders: number;
    installs_next_14_days: number;
    unallocated_next_14_days: number;
    outbox_needs_review: number | null;
  };
  can_view_team: boolean;
  can_review_intake: boolean;
}

export interface RequestRow {
  command_id: string;
  command_type: string;
  created_at: string;
  job_id: string | null;
  job_ref: string | null;
  outcome: { status: string; heading: string; message: string } | null;
}

export interface MyRequestsRead {
  count: number;
  requests: RequestRow[];
}

/** JOB_OVERVIEW (execute_read) - the parts the Job Detail tabs render. */
export interface JobOverviewRead {
  identity: {
    id: string;
    job_ref: string;
    workflow_stage: string;
    financial_status: string | null;
    handover_status: string | null;
    version: number;
  };
  booking: {
    presale_id: string | null;
    booking_submission_id: string | null;
    booking_approved_at: string | null;
    sold_booking_match_status: string | null;
    outstanding_tasks: number;
    tasks: TaskView[];
  };
  work: {
    roof_required: boolean;
    electrical_required: boolean;
    scaffold_required: boolean;
    packages: {
      id: string;
      trade: string;
      status: string;
      planned_start: string | null;
      planned_end: string | null;
      commissioning_required: boolean | null;
      actual_start: string | null;
      actual_end: string | null;
      version: number;
    }[];
    allocations: {
      id: string;
      work_package_id: string;
      person_id: string;
      person_name: string | null;
      role: string | null;
      start_at: string | null;
      end_at: string | null;
    }[];
    calls_count: number;
    unresolved_issues: number;
    operational_complete_at: string | null;
    customer_happy_at: string | null;
  };
  materials: {
    materials_count: number;
    required_quantity: number;
    cancelled_quantity: number;
    active_reservations: number;
    orders: {
      id: string;
      status: string;
      merchant_id: string | null;
      supplier_reference: string | null;
    }[];
  };
  scaffold: {
    scaffold_required: boolean;
    bookings: {
      id: string;
      status: string;
      erect_planned_at: string | null;
      erect_actual_at: string | null;
      strip_actual_at: string | null;
      company_id: string | null;
    }[];
  };
  commissioning: {
    submissions: {
      id: string;
      status: string;
      submitted_at: string | null;
      reviewed_at: string | null;
      installer_id: string | null;
      work_package_id: string | null;
    }[];
    equipment_count: number;
    needs_review: boolean;
  };
  handover: {
    status: string | null;
    records: { id: string; sent_at: string | null; status: string | null }[];
  };
  finance: {
    original_gross_pence: number;
    deposit_confirmed: boolean;
    deposit_confirmed_at: string | null;
    finance_route: string | null;
    contract_status: string | null;
    stages: {
      stage_id: string;
      stage: string;
      gross_pence: number;
      paid_pence: number;
      outstanding_pence: number;
      due_date: string | null;
      status: string | null;
    }[];
    total_invoiced: number;
    total_paid: number;
    total_outstanding: number;
  };
  cancellation: {
    is_cancelled: boolean;
    cancellation_at: string | null;
    cancellation_reason: string | null;
    open_review_tasks: number;
  };
  archive: { archived_at: string | null };
}

export interface AuditEvent {
  type: 'audit' | 'task_event' | 'issue_event';
  timestamp: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  task_id?: string;
  issue_id?: string;
  actor: string | null;
  reason?: string | null;
  note?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  before_keys?: string | null;
  after_keys?: string | null;
}

export interface AuditHistoryRead {
  total_events: number;
  audit_events: number;
  task_events: number;
  issue_events: number;
  events: AuditEvent[];
}

/** ACTION_AVAILABILITY (execute_read). */
export interface JobAvailabilityRead {
  job_id: string;
  job_ref: string;
  workflow_stage: string;
  version: number;
  assigned: boolean;
  commands: Record<string, CommandFlag>;
}

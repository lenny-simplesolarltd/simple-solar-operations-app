// Planner and resourcing read shapes (execute_read PLANNER_*, RP_* reads and
// the view-port list reads). Client-safe.

export interface PlannerRow {
  job_id: string;
  job_ref: string | null;
  job_display: string | null;
  work_package_id: string;
  trade: string;
  work_package_status: string;
  planned_start: string;
  planned_end: string;
  work_package_version: number;
  allocation_id: string | null;
  person_id: string | null;
  person_name: string | null;
  role: string | null;
  allocated: boolean;
  start_at: string;
  end_at: string;
}

export interface PlannerScaffold {
  job_id: string;
  scaffold_booking_id: string;
  company: string | null;
  kind: 'Erect' | 'Strip' | 'StripForecast';
  date: string;
  status: string;
  acknowledged: boolean;
  confirmed: boolean;
  actual_recorded: boolean;
  // PLANNER_WINDOW carries the job's identity so a scaffold chip can name it
  // without a second read; PLANNER_3_WEEKS/6_WEEKS do not.
  job_ref?: string | null;
  job_display?: string | null;
}

export interface PlannerRead {
  from: string;
  to: string;
  weeks: number;
  rows: PlannerRow[];
  scaffold: PlannerScaffold[];
}

/** PLANNER_WINDOW: the same rows, for an arbitrary date range. */
export interface PlannerWindowRead {
  from: string;
  to: string;
  days: number;
  rows: PlannerRow[];
  scaffold: PlannerScaffold[];
  holidays: string[];
}

/** One piece of required work on an actionable job that has no dates yet. */
export interface UnscheduledWork {
  work_package_id: string;
  work_package_version: number;
  job_id: string;
  job_ref: string | null;
  job_display: string | null;
  trade: string;
  status: string;
  need_by_date: string | null;
  sequence: number;
  workflow_stage: string | null;
  town: string | null;
  postcode: string | null;
  scaffold: {
    scaffold_booking_id: string;
    status: string;
    erect_planned_at: string | null;
    strip_planned_at: string | null;
  } | null;
  open_issues: number;
}

export interface PlannerUnscheduledRead {
  generated_at: string;
  limit: number;
  total: number;
  work: UnscheduledWork[];
}

export interface Alloc {
  allocation_id: string;
  work_package_id: string;
  job_id: string;
  job_display: string | null;
  trade: string;
  role: string | null;
  start_at: string;
  end_at: string;
}
export interface Leave {
  type: string;
  from_date: string;
  to_date: string | null;
}

export interface TeamPlannerRead {
  from: string;
  to: string;
  weeks: number;
  holidays: string[];
  teams: {
    team_id: string;
    name: string;
    trade: string;
    lead: string | null;
    members: {
      person_id: string;
      display_name: string;
      role: string;
      allocations: Alloc[];
      leave: Leave[];
    }[];
  }[];
  unassigned_installers: {
    person_id: string;
    display_name: string;
    allocations: Alloc[];
    leave: Leave[];
  }[];
  unallocated_work: {
    work_package_id: string;
    job_id: string;
    job_id_human: string | null;
    job_display: string | null;
    trade: string;
    status: string;
    planned_start: string | null;
    planned_end: string | null;
  }[];
}

export interface Candidate {
  person_id: string;
  display_name: string;
  ready: boolean;
  reasons: string[];
  warnings: string[];
  skill: { configured: boolean; matches: boolean; level: string | null } | null;
  load: number;
  currently_allocated?: boolean;
  allocation_id?: string | null;
}

export interface ChangeInstallerOptions {
  work_package_id: string;
  job_id: string;
  trade: string;
  start_at: string;
  end_at: string;
  current_allocations: {
    allocation_id: string;
    person_id: string;
    role: string;
  }[];
  candidates: Candidate[];
  ready_count: number;
}

export interface MoveJobPreview {
  job_id: string;
  job_version: number;
  activities: string[];
  work_packages: {
    work_package_id: string;
    trade: string;
    current: { planned_start: string | null; planned_end: string | null };
    proposed: { planned_start: string | null; planned_end: string | null };
    people: {
      person_id: string;
      display_name: string;
      role: string;
      ready: boolean;
      reasons: string[];
    }[];
  }[];
  preserved: {
    work_package_id: string;
    trade: string;
    planned_start: string | null;
    planned_end: string | null;
  }[];
  scaffold: {
    scaffold_booking_id: string;
    status: string;
    moving: boolean;
    current: {
      erect_planned_at: string | null;
      strip_planned_at: string | null;
    };
    proposed: {
      erect_planned_at: string | null;
      strip_planned_at: string | null;
    } | null;
    acknowledgement_required_after_move: boolean;
    erected: boolean;
  }[];
  calendar_links: number;
  materials: {
    material_id: string;
    need_by_date: string | null;
    order_status: string | null;
    flag: string | null;
  }[];
  conflicts: number;
  warnings: string[];
  ok_to_move: boolean;
}

export interface AvailabilityEntry {
  availability_id: string;
  version: number;
  person_id: string;
  display_name: string;
  type: 'Leave' | 'Sick' | 'Training' | 'Unavailable' | 'Available';
  from_date: string;
  to_date: string;
  reason: string | null;
  approved_by_name: string | null;
  is_installer: boolean;
  allocations: number;
}

export interface StaffAvailabilityRead {
  from: string;
  to: string;
  entries: AvailabilityEntry[];
  people: { id: string; name: string }[];
}

export interface InstallerSkillsRead {
  as_of: string;
  skills: string[];
  installers: {
    person_id: string;
    display_name: string;
    capacity_per_day: number | null;
    skills: {
      id: string;
      version: number;
      skill: string;
      level: string;
      certified_until: string | null;
      active: boolean;
      notes: string | null;
      expired: boolean;
    }[];
    teams: { team_id: string; team: string; role: string }[];
  }[];
}

export interface TeamsRead {
  teams: {
    team_id: string;
    name: string;
    trade: string;
    active: boolean;
    version: number;
    lead: string | null;
    members: { person_id: string; display_name: string; role: string }[];
  }[];
}

/** Staff wording for installer readiness reasons. */
export const READINESS_REASON: Record<string, string> = {
  INSTALLER_INACTIVE_OR_WRONG_ROLE: 'Not an active installer',
  CAPACITY_NOT_CONFIGURED: 'No daily capacity set',
  INSTALLER_UNAVAILABLE: 'Outside their available dates',
  SKILL_MISMATCH: 'Missing this skill',
  ON_LEAVE: 'On leave',
  OFFICE_HOLIDAY: 'Office holiday',
  CAPACITY_CONFLICT: 'Already fully booked',
  CERTIFICATION_EXPIRES_BEFORE_END: 'Certification expires first',
  APPRENTICE_NEEDS_SUPERVISION: 'Apprentice – needs supervision'
};

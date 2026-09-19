import type { OpsFlag } from './models';

// Read models for the administration screens (migration
// 20260920120000_convergence_operations.sql): STAFF_ADMIN, RELEASE_CONTROL,
// RELEASE_READINESS.

export interface StaffRole {
  role_code: string;
  active: boolean;
  version: number;
}

export interface StaffPerson {
  id: string;
  display_name: string;
  email: string | null;
  active: boolean;
  version: number;
  has_login: boolean;
  roles: StaffRole[];
}

export interface StaffAdminRead {
  actor_is_admin: boolean;
  roles: string[];
  people: StaffPerson[];
}

export type ReadinessState = 'Pass' | 'Fail' | 'Unknown';

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string | null;
}

export interface ReleaseReadiness {
  release: string;
  ready: boolean;
  counts: Record<ReadinessState, number>;
  external_prerequisites: string[];
  items: ReadinessItem[];
}

export interface ReleaseFunction {
  function_id: string;
  name: string;
  target_release: string;
  mode: 'Disabled' | 'Manual' | 'Automated';
  scope: 'None' | 'Pilot' | 'All';
  planned_mode: 'Manual' | 'Automated';
  current_system: string | null;
  fallback: string | null;
  notes: string | null;
  activation_time: string | null;
  version: number;
  requires: string[];
  works_with: string[];
  blocked_by: string[];
  required_by: string[];
  last_change: {
    at: string;
    by: string | null;
    service: string | null;
    reason: string | null;
    from: string | null;
    to: string | null;
  } | null;
}

export interface ReleaseControlRead {
  can_change: boolean;
  functions: ReleaseFunction[];
  readiness: ReleaseReadiness;
}

export type { OpsFlag };

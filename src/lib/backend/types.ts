// Shapes shared by the backend boundary and the screens. Safe to import from
// client components (no server code here).

/** Staff-facing outcome, worded by the database (describe_command_error/_result). */
export interface CommandOutcome {
  status:
    | 'Succeeded'
    | 'FollowUpRequired'
    | 'ActionRequired'
    | 'Failed'
    | string;
  heading: string;
  message: string;
  code?: string;
  field?: string;
  detail?: string;
}

export type CommandResponse<T = Record<string, unknown>> =
  | { ok: true; outcome: CommandOutcome; result: T; replayed: boolean }
  | { ok: false; outcome: CommandOutcome };

/** Why a read failed, so screens can show the right state. */
export type ReadFailureKind =
  | 'forbidden'
  /** The backend's release gate has this function switched off for everyone. Not a permissions problem. */
  | 'not_enabled'
  | 'not_found'
  | 'invalid'
  | 'error'
  | 'unavailable';

export interface ReadFailure {
  kind: ReadFailureKind;
  code: string;
  message: string;
}

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ReadFailure };

/** Envelope keys accepted by public.execute_command (anything else is refused). */
export interface CommandRequest {
  command_id: string;
  command_type: string;
  job_id?: string;
  task_id?: string;
  issue_id?: string;
  work_package_id?: string;
  old_allocation_id?: string;
  expected_version?: number;
  payload?: Record<string, unknown>;
}

/** A command availability flag from ACTION_AVAILABILITY / TASK_ACTION_AVAILABILITY. */
export interface CommandFlag {
  command_type: string;
  available: boolean;
  expected_version_entity?: string;
  reason?: string;
  prefill?: Record<string, unknown>;
}

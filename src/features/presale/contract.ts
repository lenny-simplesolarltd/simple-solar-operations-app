// Contract between the Presale wizard (client) and the Job Sold backend.
// The database function public.submit_presale() is the authority: it
// re-validates everything here and derives the actor from auth.uid().

export const FINANCE_ROUTES = ['Standard', 'Phoenix', 'OtherReview'] as const;
export type FinanceRoute = (typeof FINANCE_ROUTES)[number];

export interface PresaleSubmission {
  customer: {
    first_name: string;
    last_name: string;
    address_line1: string;
    address_line2: string | null;
    town: string;
    postcode: string;
    phone: string | null;
    email: string | null;
  };
  sale: {
    /** people.id of an active Surveyor. A Surveyor may only name themselves. */
    salesperson_id: string;
    lead_source: string | null;
    quote_reference: string | null;
    finance_route: FinanceRoute;
    /** Agreed gross selling price in pence. Must be > 0. */
    agreed_price_pence: number;
  };
  scope: {
    roof_required: boolean;
    electrical_required: boolean;
    scaffold_required: boolean;
    roof_notes: string | null;
    electrical_notes: string | null;
  };
  /** The full designer state (JSON-serialisable). */
  design: Record<string, unknown>;
  design_schema_version: number;
  catalogue_version: string;
  /** Designer outputs, snapshotted at submit. */
  computed: {
    system_kwp: number;
    net_panels: number;
    computed_total_pence: number;
    price_breakdown: { key: string; label: string; pence: number }[];
  };
}

export interface JobSoldTask {
  code: string;
  title: string;
  owner_name: string;
  backup_name: string | null;
  due_at: string | null;
  priority: number;
}

export interface JobSoldResult {
  job_id: string;
  job_ref: string;
  customer_id: string;
  presale_id: string;
  workflow_stage: string;
  replay: boolean;
  customer: { display_name: string; postcode: string };
  tasks: JobSoldTask[];
}

export type SubmitResult =
  | { ok: true; result: JobSoldResult }
  | { ok: false; code: string; message: string; field?: string };

export type SubmitPresaleAction = (
  commandId: string,
  submission: PresaleSubmission
) => Promise<SubmitResult>;

export interface PresaleWizardProps {
  currentUser: { personId: string; displayName: string; roles: string[] };
  /** Active people holding the Surveyor role. */
  salespeople: { id: string; displayName: string }[];
  /** False for a Surveyor: the salesperson is locked to themselves. */
  canSubmitOnBehalf: boolean;
  submitAction: SubmitPresaleAction;
}

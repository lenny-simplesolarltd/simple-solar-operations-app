// Installer workflow read shapes (INSTALLER_MY_WORK, INSTALLER_WORKFLOW,
// COMMISSIONING_QUEUE, HANDOVER_READINESS). Client-safe.

export interface MyWorkItem {
  allocation_id: string;
  role: string | null;
  work_package_id: string;
  trade: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  commissioning_required: boolean;
  expected_version: number;
  job: {
    id: string;
    display_name: string | null;
    job_reference: string;
    workflow_stage: string;
  };
  site: {
    address_line1: string | null;
    town: string | null;
    postcode: string | null;
    phone: string | null;
  };
  commissioning: {
    submission_id: string;
    status: string;
    submitted_at: string | null;
    review_notes?: string | null;
  } | null;
  evidence_count: number;
  open_issues: {
    id: string;
    type: string;
    category: string;
    status: string;
    raised_by_me: boolean;
  }[];
  my_tasks: {
    id: string;
    template_code: string;
    title: string;
    due_at: string | null;
  }[];
}

export interface MyWorkRead {
  person_id: string;
  display_name: string;
  count: number;
  items: MyWorkItem[];
}

export interface CommissioningQuestion {
  id: string;
  question_key: string;
  label: string;
  data_type: string;
  required_when: string | null;
  allowed_values: string[] | null;
  help_text: string | null;
  display_order: number;
}

export interface CommissioningAnswer {
  question_key: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
  not_applicable_reason: string | null;
}

export interface WorkflowRead {
  job_id: string;
  job_label: string | null;
  work_package_id: string;
  trade: string;
  status: string;
  expected_version: number;
  commissioning_required: boolean;
  submission: {
    id: string;
    status: string;
    expected_version: number;
    template_version: string;
    review_notes: string | null;
  } | null;
  answers: CommissioningAnswer[];
  questions: CommissioningQuestion[];
  evidence: {
    id: string;
    filename: string | null;
    storage_path: string;
    category: string;
  }[];
}

export interface CommissioningQueueRead {
  view: 'review' | 'returned' | 'accepted';
  count: number;
  submissions: {
    submission_id: string;
    version: number;
    status: string;
    submitted_at: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    template_version: string;
    work_package_id: string;
    trade: string | null;
    installer_name: string | null;
    job_id: string;
    job_ref: string;
    customer_name: string | null;
    postcode: string | null;
    answers: number;
  }[];
}

export interface HandoverReadiness {
  job_id: string;
  ready: boolean;
  submissions_count: number;
  submissions_accepted: number;
  equipment_count: number;
  issues: string[];
  summary: 'Ready' | 'NotReady';
}

import 'server-only';

import type { PlannedTool } from '../registry';

// Capabilities the assistant is designed for but the backend does not expose
// yet. They are registered so the gap is explicit - to staff, to the model
// (which is told these are unavailable) and to reviewers - but a planned tool
// has no handler and can never execute. Each names its BACKEND DEPENDENCY;
// see docs/assistant/BACKEND_DEPENDENCIES.md.
const planned = (
  name: string,
  kind: PlannedTool['kind'],
  domain: PlannedTool['domain'],
  summary: string,
  dependsOn: string
): PlannedTool => ({
  name,
  kind,
  domain,
  summary,
  dependsOn,
  status: 'planned'
});

export const PLANNED_TOOLS: PlannedTool[] = [
  // -- reads ---------------------------------------------------------------
  planned(
    'find_customer',
    'read',
    'customers',
    'Find a customer independently of a job',
    'BD-01 customer search read model (today customers are only reachable through find_job)'
  ),
  planned(
    'get_job_timeline',
    'read',
    'jobs',
    'Summarise everything that has happened on a job',
    'BD-02 job timeline read model (audit_events is Admin-only; task_events has no staff RLS policy)'
  ),
  planned(
    'get_job_blockers',
    'read',
    'jobs',
    'Explain what is blocking a job or stopping it being booked',
    'BD-03 job readiness/blockers read model (task_dependencies, issues, ReadyToBook rules)'
  ),
  planned(
    'get_current_quote',
    'read',
    'quotes',
    "Read a job's current quote revision",
    'BD-05 quote revisions (owned by the quote/document workstream)'
  ),
  planned(
    'get_quote_history',
    'read',
    'quotes',
    "List a job's quote revisions",
    'BD-05 quote revisions'
  ),
  planned(
    'compare_quote_revisions',
    'read',
    'quotes',
    'Compare two quote revisions line by line',
    'BD-05 quote revisions'
  ),
  planned(
    'get_generated_documents',
    'read',
    'documents',
    'List the documents generated for a job',
    'BD-06 generated documents'
  ),
  // -- mutations -----------------------------------------------------------
  planned(
    'complete_task',
    'mutation',
    'tasks',
    'Mark a task complete',
    'BD-04 task commands (complete_task with command_id + expected_version)'
  ),
  planned(
    'reopen_task',
    'mutation',
    'tasks',
    'Reopen a completed task',
    'BD-04 task commands'
  ),
  planned(
    'attach_task_evidence',
    'mutation',
    'evidence',
    'Attach evidence to a task',
    'BD-04 task commands + evidence storage'
  ),
  planned(
    'create_quote_amendment',
    'mutation',
    'quotes',
    'Prepare an amended quote as a new revision',
    'BD-05 quote amendment command'
  ),
  planned(
    'update_quote_draft',
    'mutation',
    'quotes',
    'Change a draft quote revision',
    'BD-05 quote amendment command'
  ),
  planned(
    'approve_quote_revision',
    'mutation',
    'quotes',
    'Approve a quote revision',
    'BD-05 quote approval command'
  ),
  planned(
    'generate_document_pack',
    'mutation',
    'documents',
    'Generate or regenerate the quotation / document pack',
    'BD-06 document generation command'
  )
];

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
    'List documents the app itself generates for a job (e.g. a quotation pack); stored files such as signed contracts and photos are available now through list_job_files / search_files',
    'BD-06 generated documents'
  ),
  // -- mutations -----------------------------------------------------------
  // complete_task / reopen_task were planned here. They are now
  // complete_tasks / override_complete_tasks / reopen_tasks in bulk-tasks.ts:
  // the batch command resolves the selection server-side and reports per task,
  // so the "asks for a file or extra fields" case is answered honestly
  // (reported back untouched) instead of being a reason not to have the tool.
  planned(
    'attach_task_evidence',
    'mutation',
    'evidence',
    'Attach a file to a task for the staff member (reading stored files is available now)',
    'Stays in the app by design: a file is uploaded from the browser straight to storage and the person attests to it. The assistant cannot hold a file, and a path it supplied would be an unattested record.'
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

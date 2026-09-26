import 'server-only';

import type { PlannedTool } from '../registry';

// Capabilities the assistant is designed for but the backend does not expose
// yet. They are registered so the gap is explicit - to staff, to the model
// (which is told these are unavailable) and to reviewers - but a planned tool
// has no handler and can never execute. Each names its BACKEND DEPENDENCY;
// see docs/assistant/BACKEND_DEPENDENCIES.md.
//
// The list is currently EMPTY, and the mechanism stays because that is a
// statement about today rather than about the design. What was here, and where
// each one went:
//
//   find_customer            BD-01. Built: tools/customer-search.ts. No new
//                            read model was needed - customers_select already
//                            ties a customer's visibility to their jobs'.
//   get_current_quote        BD-05. Built: tools/quotes.ts, on the
//   compare_quote_revisions  PRESALE_VERSIONS read model.
//   get_quote_history        BD-05. It already existed, as get_quote_versions
//                            (tools/presale-revise.ts). Listing it as
//                            unavailable told staff the opposite of the truth.
//   create_quote_amendment   BD-05 proposed a draft-then-approve quote model.
//   update_quote_draft       The quote workstream shipped the opposite one:
//   approve_quote_revision   presales are append-only and immutable
//                            (20260920300000), so there is no draft to edit
//                            and no approval gate to pass. revise_quote IS the
//                            amendment - a new version, or a correction of the
//                            current one. These three describe a workflow this
//                            application does not have, so they are retired
//                            rather than built.
//   get_generated_documents  BD-06. Built: tools/documents.ts, on JOB_DOCUMENTS
//   generate_document_pack   and the DOCUMENT_GENERATE command.
//   attach_task_evidence     Built: tools/task-evidence.ts, but narrowed. The
//                            objection was never the link, it was the
//                            attestation: a path a model supplied is an
//                            unattested record. So the tool cannot upload and
//                            takes no path - it links a file a PERSON already
//                            stored on the job to the contract task that has
//                            none.
export const PLANNED_TOOLS: PlannedTool[] = [];

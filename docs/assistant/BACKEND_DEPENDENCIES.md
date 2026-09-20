# Assistant: backend dependencies

Discovered while building the assistant foundation. **Nothing here was created or changed** by the
assistant workstream: no tables, migrations, seeds, RLS, functions or hosted-database changes. Each
item unblocks planned tools registered in `src/features/assistant/server/tools/planned.ts`.

Conventions the assistant relies on for every future **command**: derive the actor from `auth.uid()`
(never a parameter); accept `p_command_id uuid` and use the existing `commands` table for
idempotency; accept `p_expected_version` where a row is updated; raise business rejections as
`P0001` with a stable code, as `submit_presale` does.

## BD-01 Customer search

- **Required capability:** find customers independently of a job (name, postcode, phone, email).
- **Proposed interface:** `searchCustomers(query): {id, displayName, postcode, jobCount}[]` under RLS.
- **Why:** `find_customer`. Today customers are only reachable through `find_job`.

## BD-02 Job timeline read model (CLOSED)

The backend port supplies it: `public.execute_read` read type `AUDIT_HISTORY` returns audit, task and
issue events for one job, with the actor resolved from the session and the job's own visibility rules
applied. `get_job_timeline` is **available** and reads through `readR1()` like the job History tab.

## BD-03 Job readiness / blockers (CLOSED)

The backend port supplies it: `execute_operations_read` read type `JOB_OPERATIONS` (open issues,
work package state, the operational-completion gate and its reasons) together with `execute_read`
`ACTION_AVAILABILITY` (each command's availability and the reason it is refused). `get_job_blockers`
is **available** and reads through both.

## BD-04 Task commands (CLOSED as a backend gap)

`TASK_COMPLETE`, `TASK_REOPEN`, `TASK_EVIDENCE_ATTACH` and `TASK_REASSIGN` are all deployed, take a
`command_id` and an `expected_version`, and are authorised in the database. The corresponding tools
stay unbuilt for product reasons, not backend ones, and `planned.ts` now says which:

- `complete_task` - most task types ask for a file or extra fields that only the task screen can
  collect; a note-only variant is designed and not built.
- `reopen_task` - undoes recorded work; belongs where the person can see what they are undoing.
- `attach_task_evidence` - a file is uploaded from the browser straight to storage and the person
  attests to it. The assistant cannot hold a file, and a path it supplied would be an unattested
  record. This one is permanently **app-only**, not planned.

## BD-05 Quote revisions (owned by the quote/document workstream)

- **Required capability:** immutable quote snapshots per job, a diff, and amendment/approval commands.
- **Proposed interface:** `getCurrentQuote(jobId)`, `getQuoteHistory(jobId)`,
  `compareQuoteRevisions(a, b): {path, label, from, to}[]`, and
  `create_quote_amendment(p_command_id, p_job_id, p_base_revision_id, p_expected_version, p_changes jsonb)`
  which returns a **preview without writing** when `p_dry_run = true` (the assistant's `prepare()` needs
  the recalculated price for the confirmation card), plus `approve_quote_revision(...)`.
- **Why:** `get_current_quote`, `get_quote_history`, `compare_quote_revisions`, `create_quote_amendment`,
  `update_quote_draft`, `approve_quote_revision`.

## BD-06 Generated documents

- **Required capability:** list generated documents for a job; (re)generate a document pack.
- **Proposed interface:** `getGeneratedDocuments(jobId)`,
  `generate_document_pack(p_command_id, p_job_id, p_quote_revision_id, p_template_codes)`.
- **Why:** `get_generated_documents`, `generate_document_pack`.

## BD-07 Durable pending actions (IMPLEMENTED on feature/simplebot-conversations)

- **Implemented as:** `public.assistant_pending_actions` + `assistant_register_pending_action`,
  `assistant_claim_pending_action`, `assistant_release_pending_action`,
  `assistant_complete_pending_action` (migration `20260919185000_assistant_pending_actions.sql`), owner-only
  RLS, no direct writes. See ARCHITECTURE.md, "Mutations". Not yet applied to hosted.
- **Still open:** retention of old pending-action rows (they hold proposal arguments).

## BD-08 Assistant attribution on audit

- **Required capability:** record that a command was initiated through the assistant.
- **Proposed interface:** either an optional `p_initiated_via text` / `p_context jsonb` on commands
  (stored on `commands` and copied to `audit_events`), or a side table
  `assistant_action_log(command_id, thread_id, provider, model, tool, proposed_at, confirmed_at)`.
- **Why:** auditability without making the assistant the source of audit truth. `server/audit.ts`
  already produces these records; they are only logged today.

## BD-09 Persisted conversations (IMPLEMENTED on feature/simplebot-conversations)

- **Implemented as:** `assistant_conversations` + `assistant_messages` + `assistant_append_turn()`,
  RLS owner-only, migration `20260919180000_assistant_conversations.sql` (see ARCHITECTURE.md,
  "Conversations"). Not yet applied to hosted.
- **Still open:** a retention policy (how long conversations are kept) is a business decision.

## BD-10 Customer contact details and lead source (CLOSED)

This one was never written down as a dependency, which is the interesting part: it was not a
capability anybody had decided to defer, it was a hole nobody had noticed. Staff asked SimpleBot to
add a phone number to a job and it answered, correctly, that it had no tool for it. The reason was
not the assistant. `public.customers` carried a `SELECT` policy and nothing else, no command touched
it, no screen edited it, and so a contact detail captured at intake was permanent for everyone -
office staff included. The assistant then suggested a "Customer card" on the job Overview tab, which
does not exist; the gap was invisible enough that the model invented a way to fill it.

- **Implemented as:** `CUSTOMER_UPDATE` and `JOB_SALE_UPDATE` in migration
  `20260920270000_customer_and_sale_edit.sql`, with permissions `customer.edit` and `job.sale.edit`
  (Admin, Manager, Director, Office). Both are anchored to a job the actor can already see
  (`app.can_read_job`), refuse imported historical records, take `expected_version` and are audited
  by the existing `customers_audit` / `jobs_audit` triggers.
- **Tools:** `get_customer_contact` (read), `update_customer_contact`, `set_lead_source`. Each
  mutation is a confirmed proposal on the normal pending-action path.
- **Deliberately out of scope**, and refused by the payload allow-list rather than by convention:
  the customer's **name and address** (the job reference and the identity spine are derived from
  them) and the **agreed commercial terms** - price, finance route, quote reference, salesperson.
  Those need a screen showing the contract, not a sentence.
- **Still open:** there is no staff-facing screen for either. Both capabilities exist only through
  the assistant today, which is the wrong way round - a command should not be reachable only by
  asking a model. A Customer card with an Edit action on the job Overview tab would close it.

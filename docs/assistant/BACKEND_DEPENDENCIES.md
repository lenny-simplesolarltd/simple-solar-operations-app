# Assistant: backend dependencies

Discovered while building the assistant foundation. **Nothing here was created or changed** by the
assistant workstream: no tables, migrations, seeds, RLS, functions or hosted-database changes. Each
item unblocked planned tools registered in `src/features/assistant/server/tools/planned.ts`.

**Every one is now closed**, and `PLANNED_TOOLS` is empty: no capability is waiting on a backend.
What the model is still told it cannot do is either release-gated (Forms FN-21, Programmes FN-22)
or a deliberate product boundary - uploading a file, redesigning a system, changing a sale's agreed
terms. Two entries closed by turning out not to be backend gaps at all (BD-01, and half of BD-05),
which is worth remembering the next time something is deferred: the question to ask first is
whether the policy the tool needs is already in the database.

Conventions the assistant relies on for every future **command**: derive the actor from `auth.uid()`
(never a parameter); accept `p_command_id uuid` and use the existing `commands` table for
idempotency; accept `p_expected_version` where a row is updated; raise business rejections as
`P0001` with a stable code, as `submit_presale` does.

## BD-01 Customer search (CLOSED)

It turned out not to be a backend dependency at all. `public.customers` already carries
`customers_select` - a customer is readable when a job of theirs is - and `public.jobs` carries its
own visibility policy, so a session-bound query over both returns exactly the customers this person
may see, with exactly the jobs of theirs they may see. No read model, no grant, no migration.

- **Implemented as:** `searchVisibleCustomers()` in `src/features/customers/server/search.ts`
  (name, postcode, address, town, phone, email; a phone number is matched both as typed and
  compacted, because the column holds it either way).
- **Tool:** `find_customer` (read).

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
- `attach_task_evidence` - **built, narrowed.** The objection stands and shaped the tool: a file is
  uploaded from the browser straight to storage and the person attests to it, so a path the model
  supplied would be an unattested record. The tool therefore cannot upload and takes no path. It
  links a file a PERSON has ALREADY stored on the job to the PRE02 contract task that has none -
  the attestation already happened, and what was missing was only the link. The model names the
  file by the id `list_job_files` gave it, or by filename; the storage path is looked up on the
  server under this person's session and never leaves it. `app.evidence_attach` resolves a
  registered path back to the same evidence row, so nothing is duplicated.

## BD-05 Quote revisions (CLOSED, and half of it was the wrong shape)

The quote workstream supplied the snapshots, and shipped the OPPOSITE model to the one proposed
here. `presales` is append-only and immutable (migration `20260920300000`): a revision writes a new
version and supersedes the old one, with `quote_number` for what the customer sees and
`correction_number` for what the office sees behind it. `PRESALE_VERSIONS` reads them with the job's
own visibility rules; `PRESALE_REVISE` writes one.

- **Built:** `get_current_quote` and `compare_quote_revisions`
  (`src/features/assistant/server/tools/quotes.ts`), over `getQuoteVersions()` in
  `src/features/presale/server/versions.ts` - the read model for labels, order and which version is
  current, joined to `public.presales` under the session for the notes and the price breakdown.
- **Already existed:** `get_quote_history` was `get_quote_versions` all along. Listing it as
  unavailable told staff the opposite of the truth.
- **Retired, not built:** `create_quote_amendment`, `update_quote_draft`, `approve_quote_revision`.
  They describe a draft-then-approve workflow this application does not have: there is no draft to
  edit, because a presale row cannot be updated, and no approval gate, because a version is current
  the moment it is written. `revise_quote` IS the amendment - `new_version` when what is being sold
  changes, `correction` when what was recorded was wrong.
- **Fixed while here:** `get_quote_versions` and `revise_quote` asked for the permission codes
  `job.read` and `presale.revise`. Neither exists in `role_permissions` (it holds `job.read.all` /
  `job.read.own`, and nothing for presale revision), so nobody held them and neither tool had ever
  been offered to anyone. Both are gated by ROLE in the read/command registry, which the tool
  registry can express; they now name those roles.

## BD-06 Generated documents (CLOSED)

Supplied by migration `20260920280000`: `JOB_DOCUMENTS` (current revision per type plus history,
job visibility applied in the handler) and `DOCUMENT_GENERATE` (queues a revision; the worker
renders it from a frozen snapshot, in its own transaction).

- **Tools:** `get_generated_documents` (read) and `generate_document_pack` (mutation), in
  `src/features/assistant/server/tools/documents.ts`. The mutation runs the same command the
  Documents card's Generate button runs and kicks the worker the same way, so a person who confirms
  sees it start.
- **Two things the model is made to say honestly**, because both are easy to get wrong: generating
  QUEUES, so the answer after a confirmation is "queued", never "here is the document"; and a
  generation never rewrites a Ready revision - it makes a new one and supersedes the old file, which
  is kept, because an email sent last week points at exactly those bytes.
- **No revision id in the interface.** The proposal had the caller name a quote revision to generate
  from. The command derives it from the job's current presale instead, which is the only answer that
  cannot be stale by the time somebody presses Confirm.

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

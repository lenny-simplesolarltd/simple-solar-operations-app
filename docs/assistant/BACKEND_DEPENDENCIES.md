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

## BD-02 Job timeline read model
- **Required capability:** an ordered, staff-readable history of a job.
- **Proposed interface:** `getJobTimeline(jobId): {at, actorName, kind, summary, entityRef}[]`, as a view or
  RPC with RLS matching `jobs_select`.
- **Why:** `get_job_timeline` ("summarise everything that happened on this job"). `audit_events` is
  Admin-only and `task_events` currently has no staff RLS policy, so the assistant cannot read either.

## BD-03 Job readiness / blockers
- **Required capability:** the authoritative answer to "what stops this job moving to the next stage / being booked".
- **Proposed interface:** `getJobBlockers(jobId): {code, label, blockingTaskId?, ownerName?, since?}[]`,
  computed from `task_dependencies`, `issues` and the ReadyToBook rules in the database.
- **Why:** `get_job_blockers`. Today the assistant can only report tasks whose status is Blocked/Waiting
  and their recorded reason, and says so.

## BD-04 Task commands
- **Required capability:** complete / reopen a task; attach evidence.
- **Proposed interface:** `complete_task(p_command_id, p_task_id, p_expected_version, p_note)`,
  `reopen_task(...)`, `attach_task_evidence(...)`, returning the updated task.
- **Why:** `complete_task`, `reopen_task`, `attach_task_evidence`. The Tasks page itself notes that
  completing tasks arrives with the prebooking workflow.

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

## BD-07 Durable pending actions (PROPOSED TABLE, not created)
- **Required capability:** single-use confirmation state shared across server instances.
- **Proposed interface:**
  ```sql
  create table public.assistant_pending_actions (
    id               uuid primary key,          -- also the command_id given to the domain command
    actor_person_id  uuid not null references public.people (id),
    thread_id        uuid not null,
    tool             text not null,
    args_hash        text not null,
    expected_version integer,
    status           text not null default 'pending'
                     check (status in ('pending','confirmed','cancelled','expired')),
    created_at       timestamptz not null default now(),
    expires_at       timestamptz not null,
    resolved_at      timestamptz
  );
  -- RLS: a person sees and resolves only their own rows.
  -- claim = update ... set status = 'confirmed' where id = $1 and status = 'pending'
  --         and actor_person_id = app.current_person_id() and expires_at > now() returning id;
  ```
  Implemented behind the existing `PendingActionStore` interface; no other code changes.
- **Why:** the in-memory store is per-process and fails closed, which is correct but would reject valid
  confirmations on a multi-instance deployment. **Needed before the first mutation tool ships.**

## BD-08 Assistant attribution on audit
- **Required capability:** record that a command was initiated through the assistant.
- **Proposed interface:** either an optional `p_initiated_via text` / `p_context jsonb` on commands
  (stored on `commands` and copied to `audit_events`), or a side table
  `assistant_action_log(command_id, thread_id, provider, model, tool, proposed_at, confirmed_at)`.
- **Why:** auditability without making the assistant the source of audit truth. `server/audit.ts`
  already produces these records; they are only logged today.

## BD-09 Persisted conversations (optional, needs approval)
- **Required capability:** resume a thread after reload / on another device.
- **Proposed interface:** `assistant_threads(id, person_id, title, created_at, updated_at)` and
  `assistant_messages(id, thread_id, seq, role, content jsonb, created_at)`, RLS owner-only, with a
  retention policy.
- **Why:** v1 is ephemeral by design. Not required for any planned tool.

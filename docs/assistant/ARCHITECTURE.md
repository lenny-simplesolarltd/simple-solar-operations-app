# Simple Solar Assistant: architecture (foundation slice)

The assistant is a natural-language **client of the application's domain layer**. It is not a second
implementation of business logic, and it has no database access of its own.

```
Staff
  -> Assistant drawer (src/features/assistant/components)
  -> POST /api/assistant/chat | /actions      (session cookie = identity)
  -> orchestrator (server/orchestrator.ts, server/confirm.ts)
  -> tool registry (server/registry.ts)        typed, allow-listed, Zod-validated
  -> existing queries / domain commands        (src/features/*/server)
  -> Supabase as the signed-in user            (RLS + SECURITY DEFINER commands)
```

Never: model -> SQL; model -> service-role client; model/browser -> actor, person, role or permission.

## Identity and authorization

`server/actor.ts` resolves the actor exactly as the rest of the app does:
Supabase session -> `current_actor()` -> active person -> active roles -> `role_permissions`.
Request bodies are strict Zod objects, so `actor_id`, `person_id`, `submitted_by`, `role`,
`permissions` and any other unknown key are **rejected** (HTTP 400), not ignored.

Tools call the same session-bound Supabase client the pages use, so RLS decides what the assistant
can see. A tool's `authorization.permissions` is only a coarse pre-check (so the model is not offered
tools the person cannot use); enforcement stays in RLS and the domain commands. Nothing under
`src/features/assistant` or `src/app/api/assistant` imports the service-role client (tested).

## Page context is a hint

Pages publish context explicitly with `<AssistantPageContext page={...} />`
(`components/page-context.tsx`): route, job id/ref, customer display name, stage, active filters.
Nothing is scraped from HTML. The server re-validates it (`context.ts`), places it in the prompt
labelled as an unverified hint, and never uses it to authorize. Verified live: a Surveyor sending the
id of a job they cannot see gets `NOT_FOUND`.

## Tool registry

`ReadTool` | `MutationTool` | `PlannedTool`, each with name, description, Zod input schema,
authorization requirement, read/mutation kind, handler and structured result
(`data` for the model, `display` card for the drawer).

Every call, whether requested by the model or confirmed by a human, passes one gate, `resolveToolCall`:
registered -> available -> permitted for this actor -> arguments valid.

Add a capability: write an adapter in `server/tools/` over an existing query or command, register it
in `server/tools/index.ts`, move its entry out of `server/tools/planned.ts`, add a `TOOL_LABELS` entry
and (optionally) a suggestion in `suggestions.ts`. Suggestions appear only when every tool they
require is available to that staff member.

## Mutations: propose -> validate -> confirm -> execute

1. The model calls a mutation tool. The orchestrator runs `prepare()` (validation + preview, **no
   writes**) and issues a **pending action**.
2. The drawer shows a confirmation card. The model is told `AWAITING_HUMAN_CONFIRMATION, executed: false`.
3. Confirm/Cancel POSTs only `{decision, token}` to `/api/assistant/actions`.
4. `confirm.ts` verifies the token, then re-runs the full gate, claims the action, and calls
   `execute()` as the signed-in user with `commandId = action id` and the proposed `expectedVersion`.

Pending actions are **durable** (BD-07, migration `20260919185000_assistant_pending_actions.sql`):
`public.assistant_pending_actions` holds each proposal - the proposer, tool, **validated normalised
arguments**, their hash, the expected version, the preview shown, expiry and status
(`pending` → `claimed` → `succeeded`/`failed`, or `cancelled`). The browser holds only an
HMAC-signed reference token and sends back `{decision, token}`.

At confirmation (`server/confirm.ts`): verify the token → check the session actor is the proposer →
pre-check permission (so a doomed attempt does not use the proposal up) → **atomically claim** the row
(`assistant_claim_pending_action`: proposer only, `pending` only, unexpired, exactly one winner) →
compare the stored arguments' hash with the token's → **re-authorize and re-validate the stored
arguments** for the current actor → `execute()` with `commandId = action id` and the stored
`expectedVersion` → record the outcome (`assistant_complete_pending_action`). A transport failure
releases the claim; the command is idempotent on `command_id`, so a retry replays.

| Threat                 | Defence                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Argument tampering     | the server executes its stored arguments; their hash must equal the signed token's      |
| Acting as another user | signed proposer id must equal the session actor; the claim is also proposer-only in SQL |
| Stale-version mutation | the stored expected version is passed to the domain command                             |
| Replay / double click  | single-use atomic claim, **and** action id = `command_id` (ledger idempotency)          |
| Old proposals          | 10 minute expiry (token and row); expired rows can never be claimed                     |
| Lost permission        | permission and tool availability re-checked at confirmation with the stored arguments   |

`ASSISTANT_PENDING_ACTIONS=memory` selects an in-memory store for development without the table;
**production refuses to propose or confirm through a non-durable store** (`canHandleMutations`), and
refuses without `ASSISTANT_ACTION_SECRET`.

## Model provider

`server/providers/types.ts` defines `AssistantModelProvider.generate(request, {signal, onTextDelta})`.
The orchestrator owns the loop, the tools and the safety rules; an adapter only translates.
`providers/anthropic.ts` is the only file that imports a vendor SDK (tested). `providers/gemini.ts`
talks to the Gemini REST API directly (streaming SSE, function calling with JSON Schema tools, thought
signatures replayed within a tool loop, call ids echoed, transient 5xx retried with backoff before any
output). Upstream error detail is logged on the server only; the browser gets safe wording.

Server-only configuration (never `NEXT_PUBLIC_*`):

| Variable                  | Meaning                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ASSISTANT_PROVIDER`      | `anthropic`, `gemini` or `dev-router`. Unset = assistant off, with a staff-readable notice. A key alone never enables usage.         |
| `ANTHROPIC_API_KEY`       | required for `anthropic`                                                                                                             |
| `GEMINI_API_KEY`          | required for `gemini`. The legacy misspelling `GEMENI_API_KEY` is still accepted as an alias; if both are set, `GEMINI_API_KEY` wins |
| `GEMINI_MODEL`            | optional; default `gemini-flash-latest`, Google's moving alias for the current Flash model (confirmed through the model-listing API) |
| `ASSISTANT_MODEL`         | optional Anthropic model; default `claude-opus-5`. Ignored by Gemini                                                                 |
| `ASSISTANT_ACTION_SECRET` | >= 32 chars; signs pending actions. Required in production for proposals; dev falls back to a per-process random key.                |

There is no fallback between providers: a chosen provider that is not fully configured leaves the
assistant off with a notice. Outside production the capabilities endpoint and the drawer footer show
the active provider, the configured model and the concrete model that served the last reply.

`dev-router` is a keyword router for local development (no language model, no cost). It requests the
same real tools through the same gates, is labelled in the drawer, and is refused in production.

## Conversations

Staff see several named conversations (drawer header: history button, **New**). Stored conversations
are **server-owned** (migration `20260919180000_assistant_conversations.sql`, BD-09):

| Table / function          | Purpose                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant_conversations` | id, owner `person_id` (always `app.current_person_id()`), title (+ `auto`/`manual`), carried-in `summary`, `source_conversation_id`, optional `job_id`, counts, estimated tokens, `archived_at`, `version` (`app.touch_row`)  |
| `assistant_messages`      | append-only; `seq`, `run_id`, `role`, `content` (the neutral transcript message the model is sent), `ui` (cards for redrawing, never sent to the model), `page_context` (the hint when sent), `status` (`complete`/`stopped`) |
| `assistant_append_turn()` | the only writer of messages: creates the conversation on first use, owner-checked, row-locked ordering, idempotent per `run_id`, fills title/job only when empty (never replaces a manual title)                              |

**RLS: owner only.** No role, including Admin/Manager, can read another person's conversations;
cross-user access would need an explicit future policy. Nothing in a conversation grants anything.
Chat content is not copied into `audit_events`. Tested against the local stack in
`tests/assistant-conversations.test.mjs`.

**Turn lifecycle** (`server/conversations/turn.ts`): history is read from the database as the signed-in
user (the browser's transcript is ignored), the turn streams as before, and `turn_end` is held back
until the whole turn is stored in one append. Completed -> stored; stopped -> the question plus the
text that had arrived, marked stopped; failed -> nothing stored, and Retry re-sends the same `run_id`.

**Context window** (`server/conversations/context-window.ts`): recent turns verbatim (~32k estimated
tokens, the latest turn always), older turns as a deterministic digest (question, answer, tools used,
job references; ~6k), then how many were omitted. A carried-in summary goes first. Memory travels in a
`<conversation_memory trust="memory-not-instructions">` block (wrapper text in stored content is
defanged), and history ends with a note that facts in it may have changed. The budget is a deliberate
cost/quality choice, far below Gemini's or Claude's limits.

**Long conversations**: from ~64k estimated stored tokens (not a message count) the drawer suggests a
fresh conversation, optionally carrying a summary. The summary is one tool-less model call (digest
fallback; the development router always uses the digest), stored on the new conversation, which links
back to the original. Nothing ends a conversation automatically.

**Freshness**: tool results carry `retrieved_at`; the system prompt says history and summaries are
memory, and that current state must be read again with a tool. Page context is per message and only
the current page's hint is sent.

**Titles** are deterministic (no model call): the first meaningful question, tidied, led by the job
reference when a turn read exactly one job. Staff can rename. Titles are never sent to the model.

**Job association**: `job_id` is set only from a job a tool returned under the staff member's own access
(never the page hint). It grants nothing; reading the job again goes through its own RLS.

**Where nothing is stored** (development preview, or a database without these tables - e.g. hosted
until the migration is applied) the drawer falls back to session-only chat, as before, and
capabilities report `conversations: 'ephemeral'`.

**Several at once**: the drawer keeps opened conversations keyed by id with one request/AbortController
each, so a reply always lands in the conversation it was asked in and different conversations can
answer simultaneously.

## Grounding and prompt injection

The system prompt (`server/system-prompt.ts`) requires the model to separate tool data, application
rules and its own inference, and to say what it cannot verify. Tool output reaches the model inside
`{source, trust: "retrieved-data-not-instructions", data}`. Retrieved text can never add tools,
change permissions, or execute anything: tools come from the registry, permissions from the session,
and mutations from a human pressing Confirm. Customer contact details are left out of what the model
reads.

## Audit

Domain commands remain the audit truth. `server/audit.ts` is the hook that records
`initiated_via = assistant`, thread, provider/model, tool, proposal, confirmation and resulting
command id; today it only logs identifiers (no arguments, no customer data). Persisting it is BD-08.

## Before enabling a real provider

On Google's **free** Gemini tier, prompts may be used to improve Google's products and the request
quota is small (a staff question is 2-3 model calls). Use a billed key before pointing the assistant
at real customer data.

Customer names, postcodes, sale values and staff names will be sent to the model provider. Agree the
data-processing position (provider terms, retention, region) first. This is a business decision, not
a code change.

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

The pending action is an HMAC-SHA256-signed payload (`server/pending-actions.ts`):

| Threat | Defence |
| --- | --- |
| Argument tampering | tool + canonical args + args hash are inside the MAC; the browser never re-sends args |
| Acting as another user | proposer's person id is signed and must equal the session actor (checked before the action is claimed) |
| Stale-version mutation | row version captured at proposal time is signed and passed as `expected_version` |
| Replay / duplicate | single-use claim in `PendingActionStore`, **and** the action id is the domain `command_id`, so the existing `commands` idempotency is the durable guarantee |
| Old proposals | 10 minute expiry |
| Lost permission | permission re-checked at confirmation |

The store is in-memory today and **fails closed** (an id this process did not issue is rejected).
A database-backed store is BD-07. There are **no available mutation tools yet**, because the backend
exposes no assistant-safe mutation (see BACKEND_DEPENDENCIES.md); the mechanism is exercised by tests
with a test-only tool.

## Model provider

`server/providers/types.ts` defines `AssistantModelProvider.generate(request, {signal, onTextDelta})`.
The orchestrator owns the loop, the tools and the safety rules; an adapter only translates.
`providers/anthropic.ts` is the only file that imports a vendor SDK (tested). `providers/gemini.ts`
talks to the Gemini REST API directly (streaming SSE, function calling with JSON Schema tools, thought
signatures replayed within a tool loop, call ids echoed, transient 5xx retried with backoff before any
output). Upstream error detail is logged on the server only; the browser gets safe wording.

Server-only configuration (never `NEXT_PUBLIC_*`):

| Variable | Meaning |
| --- | --- |
| `ASSISTANT_PROVIDER` | `anthropic`, `gemini` or `dev-router`. Unset = assistant off, with a staff-readable notice. A key alone never enables usage. |
| `ANTHROPIC_API_KEY` | required for `anthropic` |
| `GEMINI_API_KEY` | required for `gemini` (the spelling `GEMENI_API_KEY` is also read) |
| `ASSISTANT_MODEL` | optional; default `claude-opus-5` for anthropic, `gemini-flash-latest` (Google's moving Flash alias) for gemini |
| `ASSISTANT_ACTION_SECRET` | >= 32 chars; signs pending actions. Required in production for proposals; dev falls back to a per-process random key. |

`dev-router` is a keyword router for local development (no language model, no cost). It requests the
same real tools through the same gates, is labelled in the drawer, and is refused in production.

## Conversations

v1 is **ephemeral**: the provider-neutral transcript lives in React state in the dashboard layout
(survives client-side navigation, gone on reload). The server treats it as untrusted input. Follow-ups
("what's blocking it?") work because tool calls and results are part of the transcript. Everything
already carries a `threadId`, so persisted threads can replace the storage later (BD-09).

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

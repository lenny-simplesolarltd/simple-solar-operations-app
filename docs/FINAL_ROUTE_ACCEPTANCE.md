# Final route acceptance

Every page route of the converged app, opened in a real browser (Chrome,
Playwright) against the **production build** (`next build` + `next start`)
over the isolated canonical database: all 47 migrations replayed from zero,
then the full R1 journey driven through the UI (see
`FINAL_CONVERGENCE_REPORT.md`), so the pages show real synthetic data.
One signed-in session per role; 416 page visits (52 routes x 8 roles).

**Result: 0 errors (no server exception, no client exception, no console
error other than the dev-only Radix id note which production does not
emit), 0 "backend update not deployed" messages.** The only phrase flagged
by the scan was the Intake review description ("... not available yet"),
reworded since to describe the actual process.

Cell legend: **ok** real data / working page for that role; **no access**
the server refuses the read and the page says so; **not found** the record
is outside what the role may read (RLS), so the page is a 404; **redirect**
the page sends the role elsewhere (e.g. People & access for non-admins);
**switched off** the page explains the release function is off (R2/R3 and
Forms are Disabled); **no data** the dynamic route had no row of that kind
in this dataset (R2 scaffold / orders / deliveries, Forms). Hiding a menu
item is never the security boundary: every "no access" / "not found" cell
is the server refusing.

## Route x role

| Route | Admin | Manager | Director | Office | VarApprover | Surveyor | Installer | Store |
|---|---|---|---|---|---|---|---|---|
| `/dashboard` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/tasks` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/tasks/[taskId]` | ok | ok | ok | ok | ok | ok | no access | no access |
| `/dashboard/jobs` | ok | ok | ok | ok | ok | ok | no access | no access |
| `/dashboard/jobs/[jobId]` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=tasks` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=work` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=operations` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=money` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=files` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]?tab=history` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/jobs/[jobId]/booking` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/jobs/[jobId]/move` | ok | ok | ok | ok | ok | ok | not found | not found |
| `/dashboard/booking` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/intake` | ok | ok | no access | ok | ok | no access | no access | no access |
| `/dashboard/requests` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/presales` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/presales/new` | ok | ok | redirect | ok | ok | ok | redirect | redirect |
| `/dashboard/planner` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/planner?view=board` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/availability` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/skills` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/scaffold` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/scaffold/[bookingId]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/installs` | switched off | switched off | no access | switched off | switched off | no access | switched off | no access |
| `/dashboard/installs/[workPackageId]` | switched off | switched off | no access | switched off | switched off | no access | switched off | no access |
| `/dashboard/commissioning` | ok | ok | no access | ok | ok | no access | no access | no access |
| `/dashboard/commissioning/[workPackageId]` | switched off | switched off | no access | switched off | switched off | no access | switched off | no access |
| `/dashboard/materials` | ok | ok | ok | ok | ok | no access | no access | ok |
| `/dashboard/materials/[jobId]` | ok | ok | ok | ok | ok | no access | not found | not found |
| `/dashboard/orders` | ok | ok | ok | ok | ok | no access | no access | ok |
| `/dashboard/orders/[orderId]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/goods-in` | ok | ok | ok | ok | ok | no access | no access | ok |
| `/dashboard/goods-in/[deliveryId]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/stock` | switched off | switched off | no access | no access | no access | no access | no access | switched off |
| `/dashboard/forms` | switched off | switched off | switched off | switched off | switched off | switched off | switched off | switched off |
| `/dashboard/forms/[formId]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/forms/[formId]/preview` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/forms/responses/[responseId]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/help` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/help/[slug]` | no data | no data | no data | no data | no data | no data | no data | no data |
| `/dashboard/help/category/[category]` | switched off | switched off | switched off | switched off | switched off | switched off | switched off | switched off |
| `/dashboard/help/manage` | ok | ok | not found | ok | ok | not found | not found | not found |
| `/dashboard/help/manage/[articleId]` | ok | ok | not found | ok | ok | not found | not found | not found |
| `/dashboard/help/manage/new` | ok | ok | not found | ok | ok | not found | not found | not found |
| `/dashboard/people` | ok | ok | redirect | redirect | redirect | redirect | redirect | redirect |
| `/dashboard/system` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/issues` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/files` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/dashboard/release` | ok | ok | ok | no access | no access | no access | no access | no access |
| `/dashboard/tasks?scope=all&queue=calls` | ok | ok | ok | ok | ok | no access | no access | no access |
| `/dashboard/tasks?scope=all&queue=cancellation` | ok | ok | ok | ok | ok | no access | no access | no access |

## Route classification

| Route | Status | Notes |
|---|---|---|
| `/dashboard` (Office home) | WORKING | falls back to the legacy home only if its read is not deployed (hosted today) |
| `/dashboard/tasks` (+ `?scope=team`, `?scope=all&queue=...`) | WORKING | My / Team / Everyone; Calls, Issues, Cancellation, Payments, GHL, Booking queues |
| `/dashboard/tasks/[taskId]` | WORKING | complete, reopen, record call, attach contract, reassign; cancellation tasks link to Operations |
| `/dashboard/jobs`, `/dashboard/jobs/[jobId]` (Overview, Tasks, Work, Operations, Money, Files, History) | WORKING / ROLE-GATED | office-only tabs hidden for Surveyor, Finance, installers |
| `/dashboard/jobs/[jobId]/booking` | WORKING | booking form with first installers; Confirm booking |
| `/dashboard/jobs/[jobId]/move` | WORKING / ROLE-GATED | office class only |
| `/dashboard/booking` | WORKING | booking queue, ready to book, in progress, upcoming |
| `/dashboard/intake` | WORKING | read-only by design (no resolve step in either system) |
| `/dashboard/issues` | WORKING (new) | cross-job issues: resolve (+photo), close, reassign |
| `/dashboard/requests` | WORKING | My requests |
| `/dashboard/presales`, `/dashboard/presales/new` | WORKING | Job Sold (9-step form) |
| `/dashboard/planner` (3w / 6w / board) | WORKING / RELEASE-GATED actions | allocation / move actions need FN-02 (R2) |
| `/dashboard/availability`, `/dashboard/skills` | WORKING | record and cancel unavailability; skills / teams |
| `/dashboard/scaffold`, `/dashboard/scaffold/[bookingId]` | RELEASE-GATED | FN-04 (R2) |
| `/dashboard/installs`, `/dashboard/installs/[workPackageId]` | RELEASE-GATED | FN-06 (R3 installer app) |
| `/dashboard/commissioning`, `/dashboard/commissioning/[workPackageId]` | WORKING list / RELEASE-GATED review | FN-07 (R3); R1 office commissioning is on the job Operations tab |
| `/dashboard/materials`, `/dashboard/materials/[jobId]`, `/dashboard/orders(/[id])`, `/dashboard/goods-in(/[id])`, `/dashboard/stock` | RELEASE-GATED actions | FN-03 / FN-05 (R2); lists readable |
| `/dashboard/files` | WORKING (new) | Files & documents library |
| `/dashboard/forms(/...)`, `/f/[token]` | RELEASE-GATED | FN-21 Disabled by default |
| `/dashboard/help(/...)`, `/dashboard/help/manage(/...)` | WORKING | editors: Admin, Manager, Office (help.edit); publish Admin, Manager |
| `/dashboard/people` | WORKING (Admin / Manager) | add person, roles, invite, deactivate |
| `/dashboard/release` | WORKING (new) | Admin / Manager change, Director reads |
| `/dashboard/system` | WORKING | Director included; readiness card |
| `/api/health`, `/api/evidence/[id]`, `/api/assistant/*`, `/auth/*` | WORKING | route handlers exercised by the journey |

No route is BROKEN, OBSOLETE or DUPLICATE.

## Warning-text classification (release criterion)

| Text | Where | When it appears | Verdict |
|---|---|---|---|
| "Filters and task actions need a backend update that is not deployed to this database yet" | `dashboard/tasks/page.tsx` | only when TASKS read is missing (PGRST202 / missing read entry point) | production compatibility for hosted until it is migrated; never shown on the canonical database (crawl) |
| "Browsing and stage filters need a backend update ..." | `dashboard/jobs/page.tsx` | only when JOBS read is missing | same |
| "This screen needs a backend update that has not been deployed ..." | `lib/backend/read-failures.ts` | only for `READ_NOT_DEPLOYED` (narrowed: 42883 counts only for a missing read entry point) | same |
| "SimpleBot is not available yet" | `assistant-panel.tsx` | no AI provider key configured | accurate configuration message |
| "... is planned but not available yet" | SimpleBot registry | planned (not yet built) tools only | accurate |
| "Not switched on yet" | read failures, Forms, installer screens | release function Disabled | accurate release-gate message |

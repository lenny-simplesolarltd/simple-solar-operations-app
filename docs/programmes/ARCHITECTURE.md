# Operational programmes (v1)

A programme is a contract covering many properties, each visited by a field
worker and each visit reviewed by the office. The first configured one is
**PCH Meter SIM Replacement 2026** (~1,400 properties, 150–200 visits/day, three
weeks), but nothing in the module is about PCH: a programme is configuration.

```
property list (CSV)  ──▶ PROGRAMME_IMPORT_* ──▶ programme_properties
                                                      │
installer's phone ──▶ PROGRAMME_VISIT_START ──▶ programme_visits (Draft)
        │                                             │
        ├── photographs ──▶ evidence_upload_begin ──▶ public.evidence (scope Programme)
        │
        └── the form ──▶ PROGRAMME_VISIT_SUBMIT ──▶ app.forms_staff_submit (the artifact)
                                                 └▶ typed columns + derived assessments
                                                        │  review_status = AwaitingReview
office ──▶ PROGRAMME_VISIT_REVIEW ──▶ portal verification + disposition ──▶ board, reporting
```

## What is reused, not rebuilt

| Existing thing | How programmes use it |
| --- | --- |
| **Form Builder** | the installer form is an ordinary published form. The capabilities it needed (photo answers, entity lookup, conditions over a set) were added to Forms itself, generically. No second form engine, no PCH form component. |
| **`public.evidence` + the private `evidence` bucket** | a programme photograph is an evidence row with `scope = 'Programme'`, registered through the same three-step upload, served by the same `/api/evidence/<id>` route, authorized by the same `app.can_read_evidence`. No PCH bucket. |
| **`public.execute_command`** | every write. Actor resolution, the `commands` idempotency ledger, one transaction, audit context and release modes come free. There is no client write path to any programme table (RLS grants `SELECT` only). |
| **`app.audit`** | the review trail. A review *is* a state transition, and this system already has an immutable, actor-attributed, command-scoped history of those. |
| **`permissions` / `role_permissions`** | `programme.*` capabilities, not role names, decide what the UI offers and what handlers allow. |
| **`public.execute_operations_read` / `app.read_registry`** | the aggregates (`PROGRAMME_DASHBOARD`, `PROGRAMME_DAILY_REPORT`). |
| **`app.result_error_catalogue`** | staff wording for every refusal, so the review dialog, a board drag and the installer's form all say the same thing without knowing any codes. |
| **RA01 release register** | `FN-22`, seeded **Disabled**. |
| **UI** | `PageContainer`, `Heading`, shadcn primitives, the brand tone tokens, `runCommand`, native HTML5 drag-and-drop as the planner already uses. |

## Data (migration `20260921110000_programmes.sql`)

| Table | Meaning |
| --- | --- |
| `programmes` | configuration: the visit form, the **field map**, the outcome map, the signal thresholds, how much of the property list a field worker may see, and whether the whole programme is synthetic fixtures |
| `programme_properties` | one property. Searchable by address, postcode, the client's reference and the expected meter serial (`postcode_norm` / `expected_serial_norm` are generated) |
| `programme_assignments` | who works a programme, optionally narrowed to one property |
| `programme_visits` | one field visit: the form artifact, the canonical typed values, the derived assessments and the office's review |
| `programme_imports`, `programme_import_rows` | staging for upload → parse → map → validate → preview → import |

### Why four tables, not the six that were named

* **`programme_visit_reviews`** — a review is a state transition on the visit, and
  `audit_events` is already an immutable, actor-attributed, command-scoped history
  of transitions. A table would be a second, weaker copy of it, and the *current*
  review state has to be on the visit anyway for the board to be one query. So
  the outcome lives on `programme_visits` and its history is
  `app.audit('programme_visit', …)`.
* **`programme_actions`** — every action described is a *disposition* of a visit
  ("No access – rebook", "Action required", "Meter requires changing"): a state,
  not an entity with its own life. They are the board's columns. A row per action
  would duplicate the visit's state and immediately raise "which one is true?".
  An action's free text and its owner are columns on the visit.

If either grows a life of its own (an action assigned to someone other than the
reviewer, with a due date and its own closure), it becomes a table then — from a
state that is already audited.

### The one invariant the table itself enforces

```sql
constraint programme_visits_complete_needs_portal check (
  disposition <> 'CompleteAndWorking'
  or portal_verification is not distinct from 'ConfirmedLive')
```

A good CSQ is not a working meter. "Complete & working" requires the office to
have confirmed the meter live in the external PCH portal — refused in words by
the command, and **impossible** at the table, so no command, no drag-and-drop and
no future code path can reach that state without the confirmation.

`is not distinct from`, not `=`: `portal_verification` is nullable and a CHECK
that evaluates to NULL *passes*, so with `=` an unverified visit would give
`false OR null` and slip through the constraint that exists to stop it. The
integration test for this caught exactly that bug.

## Form Builder extensions (migration `20260921100000_forms_field_types.sql`)

All generic. No PCH behaviour entered the renderer.

1. **`photo`** — answer is a list of canonical `public.evidence` ids. The engine
   checks the shape (uuids, unique, within `max`); the **consuming command**
   checks each id is evidence the actor registered against the object being
   recorded. Forms gains no bucket and no upload path.
2. **`entity`** — answer is one uuid of a named kind (`programme_property`). Again
   shape only; existence and scope belong to the consuming command. The allow-list
   exists so the builder and renderer know what to search.
3. **Condition `op: "in"`** — true when the earlier answer is any of `values`. Two
   outcomes share the same follow-up questions, so `equals` could not express the
   rule and the alternative was duplicating every follow-up per outcome.
4. **Staff submissions** — `form_submissions.invitation_id` is nullable, with
   `source` (`RecipientLink` | `Staff`) and `submitted_by`. Still immutable, still
   keyed by its revision's field ids, still validated by
   `app.forms_validate_answers`. There is **no new client entry point**: a staff
   submission is only ever created inside another command, through
   `app.forms_staff_submit`, so the command that owns the work owns the
   authorization. An installer needs no Forms rights to record a visit.
5. **A recipient link cannot carry a staff-only field type** (`FORMS_NOT_LINKABLE`).
   One check is complete: an invitation binds to one revision and revisions are
   immutable, so a link can never later acquire a type it was not checked against.

**Conditional requiredness needed no new concept.** `condition` decides whether a
question is shown and `required` applies only to shown questions (both the
database and its TypeScript mirror already skip hidden fields). "Required when
the outcome is X" is a conditional field that is required.

Renderer additions (`form-renderer.tsx`): injected `photoControl` / `lookupControl`
render props (a caller that supplies neither gets a visible "only in the app"
refusal, not a dead question), and `draftKey` — answers kept in that browser and
restored, useful to any form.

## Not trusting the client

`PROGRAMME_VISIT_SUBMIT` independently:

* validates the answers against the revision **in the database**, which drops
  hidden answers and refuses unknown fields;
* requires the revision to belong to the programme's configured form, and stores
  it on the visit, so editing the form later cannot reinterpret the submission;
* reads the canonical values out of the validated answers through the programme's
  **field map** and types them;
* re-applies the outcome's own requirements from
  `app.programme_outcome_requirements` — required values *and* required evidence —
  whatever the form said;
* requires every photograph to be a registration of *this* visit by *this* person
  of the expected kind, with its bytes actually in storage, or writes nothing.

Then it derives, server-side: `meter_serial_matches` (normalised both sides, so
case and punctuation are not differences), `signal_classification`,
`portal_check_required`, `review_reasons`, `recommended_disposition`.

A recommendation of `CompleteAndWorking` still cannot be *applied* without
`ConfirmedLive`; it only says "nothing the installer reported is wrong".

## The CSQ threshold — UNRESOLVED

The client's statement disagrees with itself about the value 4: "14 or above" is
good, "approximately 4 and 14" is advisory, "4 or below" is bad. So it is
**programme configuration with an explicit unresolved flag**, not a silent
decision in code:

```json
{ "good_min": 14, "bad_max": 4, "bad_max_inclusive": true,
  "boundary_unresolved": true, "boundary_question": "Is a CSQ of exactly 4 bad, or advisory? …" }
```

Currently configured as **4 is Bad**. The flag surfaces on the dashboard and in
the review panel. Change `bad_max_inclusive` and clear `boundary_unresolved`
once Dan/Ben confirm — nothing in the code prefers either answer. Visits already
classified keep the answer they were given, which is the honest record of what
was decided at the time.

## Commands and reads

`PROGRAMME_CREATE`, `PROGRAMME_UPDATE`, `PROGRAMME_ASSIGN`, `PROGRAMME_UNASSIGN`,
`PROGRAMME_PROPERTY_UPDATE`, `PROGRAMME_VISIT_START`, `PROGRAMME_VISIT_SUBMIT`,
`PROGRAMME_VISIT_REVIEW`, `PROGRAMME_IMPORT_CREATE`, `PROGRAMME_IMPORT_ADD_ROWS`,
`PROGRAMME_IMPORT_MAP`, `PROGRAMME_IMPORT_APPLY`, `PROGRAMME_IMPORT_DISCARD` —
registered in `app.command_registry`, module `programmes`, all requiring FN-22
Manual. Reads: `PROGRAMME_DASHBOARD`, `PROGRAMME_DAILY_REPORT`.

`PROGRAMME_VISIT_REVIEW` is the **one** canonical transition for a disposition.
The board's drag-and-drop, its status menu and the review screen's buttons all
call it, so none can bypass a rule.

## Permissions

| Permission | Admin | Manager | Office | Director | Installer / Surveyor |
| --- | :-: | :-: | :-: | :-: | :-: |
| `programme.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `programme.read.all` | ✓ | ✓ | ✓ | ✓ | |
| `programme.visit.submit` | ✓ | ✓ | | | Installer only |
| `programme.review` | ✓ | ✓ | ✓ | | |
| `programme.manage` | ✓ | ✓ | | | |
| `programme.report` | ✓ | ✓ | ✓ | ✓ | |

**Surveyors are deliberately not granted field submission.** No capability here is
granted by analogy with another role: whether Surveyors attend programme visits is
a business question that has not been answered. Adding them is one row in
`role_permissions` and no code change.

RLS: a field worker sees the properties their programme's `property_visibility`
policy allows (`Assigned`, or `AllInProgramme` for anyone assigned to the
programme) and **only their own visits**, including their own drafts. Programme
evidence is readable by `programme.read.all` holders and by the field worker whose
own visit it is — deliberately not "anyone with `programme.read`", which would let
one installer read another's photographs.

## Mobile

The installer screen is one column, no sidebar, no tabs. Targets are 44–48px, the
camera opens straight from the photo button (`capture="environment"`), the
property search is one box matched against four things, and **photographs upload
as they are taken** — on a doorstep the upload is the slow, flaky part, and doing
it at submit time would mean a failed submit loses the photos. Unsent answers are
kept on the device per form version and restored. Questions that do not apply are
not shown, so "Tenant not home" is a three-tap form.

## Synthetic fixtures

`programmes.synthetic` marks a whole programme as development fixtures, and
`app.programme_synthetic_guard` makes the flag **contagious and immutable**: a
synthetic property or visit can exist only inside a synthetic programme, and
neither flag can ever change. Fixtures cannot leak into the real programme by
mistake rather than by remembering not to.

Ten fixtures live in `supabase/seeds/006_programme_dev_fixtures.sql` (local
`db reset` only; hosted receives migrations only) inside `DEV-PCH-SIM`, covering
normal success, no access, dead meter, serial mismatch, good/advisory/bad CSQ, the
unresolved boundary value, no expected serial, and portal-never-live. The real
`PCH-SIM-2026` programme has **no properties and no visits**.

## The programme form read: deliberate, and narrow

`public.programme_visit_form` serves the visit form's questions gated on **FN-22
only**, not FN-21, and without `forms.read`. This is intended: an installer
authorised to perform a programme visit must be able to render the exact published
revision that programme requires, without gaining access to the Forms product.

Five properties keep it narrow, each with a test in
`tests/programmes.test.mjs` ("the programme form read is narrowly scoped"):

1. **Only the programme's configured, current published revision.** The query is
   `where r.form_id = programmes.visit_form_id` joined on
   `forms.current_revision_id = r.id`. An older revision of the same form is not
   reachable through it.
2. **Only with a programme capability.** `programme.visit.submit` or
   `programme.read.all`, *and* — for anyone without `read.all` — an active
   assignment to that programme. Unassigning an installer removes their access
   without touching their role.
3. **It grants no Forms access.** After calling it, `forms`, `form_revisions`,
   `form_submissions` and `form_invitations` all still return nothing to the
   installer, and the Installer role holds no `forms.*` permission at all.
4. **No unrelated form is exposed.** The only form reachable is the one the
   programme names, which only `programme.manage` can set — and
   `app.programme_assert_visit_form` now requires that to be an existing,
   published, non-template form (`PROGRAMME_VISIT_FORM_NOT_FOUND` /
   `_IS_TEMPLATE` / `_NOT_PUBLISHED`).
5. **It cannot be a generic form-read bypass.** The argument is a **programme**
   id, never a form id, so there is no shape of call that names an arbitrary
   form. Passing a form id simply finds no programme.

It returns the definition (the questions) only — never a submission, a draft, a
link or a list.

## Switching it on

```sql
update public.release_modes
set mode = 'Manual', authorised_job_scope = 'Pilot'
where function_id = 'FN-22';
```

While Disabled: every command is refused (`R1A_MODE_DENIED`), staff reads return
nothing (RLS), the menu hides Programmes and the pages say "switched off".

## Not done

* **Nothing is emailed, and no calendar is touched.** `PROGRAMME_DAILY_REPORT` is
  the read model for a PCH daily report; its format is still to be agreed with
  Ben and Dan.
* **No SimpleBot tools yet.** The read models are shaped for them
  (`PROGRAMME_DASHBOARD`, `PROGRAMME_DAILY_REPORT`, and the visit rows) — see the
  questions listed in the hand-over report.
* **No appointments, work orders or rebooking automation** — deliberately, until
  Ben/Dan decide the next workflow. "No access – rebook" and "Meter requires
  changing" are dispositions that *require* follow-up; the system records and
  reports them and does nothing further. A second visit is recorded as a new
  visit against the same property, which the data model already supports.
* `src/types/database.ts` could not be regenerated (`npm run db:types` fails in
  this environment: the generator connects on the default port inside its own
  container and fails authentication against this project's custom ports). The
  programme relations are declared in `src/features/programmes/server/db.ts`
  instead — a narrowing, not an `any` — and that file should be deleted once
  generation works again.
* No antivirus scanning of photographs (unchanged from the evidence module).

## Tests

`tests/programmes.test.mjs` — 67 assertions against a real local stack with
Storage: real sessions, real signed upload URLs, real RLS, real commands. Proves
the whole path, each of the four outcomes, serial mismatch, CSQ classification and
the configurable boundary, that a good CSQ cannot bypass portal verification
(including that the *table* refuses it to the service role), evidence
authorization, replayed submissions, form-version preservation, permissions, the
release gate and the synthetic-data invariant.

`scripts/programmes/page-smoke.mjs` — signed-in HTTP checks that the screens
render for the right people and are refused for the wrong ones. Needs the app
built and started against the local stack on :3100; see the hand-over report for
the recipe.

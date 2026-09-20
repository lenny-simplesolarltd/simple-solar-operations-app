# Planner and Google Calendar — audit and sync design

Phase E of the Planner v2 work. **No code, no schema and no calendar was
changed by this document**, and no Google Calendar API call has been made from
this repository.

The short version: the sync model already exists in the database and is
already correct about the thing that matters most — an external edit can never
move a job. What is missing is a worker to carry it out, and the facts about
the production Google Workspace that only someone with access to it can supply.

---

## A. What calendars exist

**Unknown from here, and it must not be guessed.** I have no access to the
Simple Solar Google Workspace, so this section is a question for the owner,
not a finding.

The only calendar identifier anywhere in either repository is a **DEV** one,
hardcoded in the reference implementation:

```
c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com
```

Its own documentation (`docs/CALENDAR-implementation.md` in the reference)
states plainly: *"No real Calendar call has been made from this repository.
PROD is structurally unreachable: the only calendar the service will address is
the hardcoded DEV calendar ID."*

**Needed from the owner before anything else:**

1. Which calendars operations actually used (one shared calendar, or one per
   installer?).
2. Whether they are still written to today, and by whom or what.
3. Whether the old Jotform producer still creates events. The schema knows
   about it: `calendar_links.producer` is `'LegacyJotform' | 'NewSystem'`.
4. Roughly how many events exist, and over what date range.

## B. Is there existing integration?

**Yes in the database; no in this application.**

Already built and deployed in `supabase/migrations/20260919164000_r2_calendar_resourcing.sql`:

| Piece | What it does |
|---|---|
| `calendar_links` | One row per allocation or scaffold activity: `calendar_id`, `external_event_id`, `event_uid`, `producer`, `entity_revision`, `last_synced_revision`, `status`, `last_attempt_at`, `last_success_at`, `error`, `outbox_id` |
| `outbox` | `CalendarCreate` / `CalendarUpdate` / `CalendarCancel` with a unique `idempotency_key`, `attempt_count`, `next_attempt`, backoff 1-2-4-8-16 minutes, then `NeedsReview` |
| `app.s11_calendar_capture` | Called by `PLAN_WORK_PACKAGE`, `MOVE_WORK_PACKAGE`, `CHANGE_INSTALLER_R2` — every scheduling change already queues its calendar intent |
| `app.calendar_event_spec` | The event to write: all-day, titled from the job, description tagged `[SSO:<calendar_link_id>]` |
| `app.calendar_claim_decision` | The safety gate before any external call |
| `app.calendar_drift_candidates` / `app.calendar_record_drift` | External-edit detection |
| `CALENDAR_REVIEW_RESOLVE` | Human recovery: `AdoptEvent`, `MarkCancelled`, `Retry`, `Retarget` |
| `CALENDAR_STATUS`, `CALENDAR_DISPATCH_PREVIEW` | Read-only status and a dry run |

**What is missing:** a worker. There is no `googleapis` dependency in
`package.json` and nothing in `src/` or `scripts/` drains the outbox. The
reference has one — `apps-script/calendar/CalendarSync.js`, 904 lines of Apps
Script — which has never run against a real calendar.

Current state of the gates:

- `release_modes.FN-02` ("Calendar entries") is **`Disabled`**.
- `settings['calendar.mode']` is unset, so the code reads it as **`CAPTURE`**.
- `settings['calendar.shared_calendar_id']` is unset →
  `app.s11_calendar_capture` writes the literal `NOT_CONFIGURED`.
- `settings['calendar.allowed_calendar_ids']` is empty.

So today the system **captures intent and sends nothing**. That is the correct
resting state and this work does not change it.

## C. Do events carry Simple Solar identifiers?

**Events this system creates: yes.** `app.calendar_event_spec` puts a durable
tag in every event description:

```
[SSO:<calendar_link_id>]
Job: SS-XXXX-0000
Work package: <uuid>
Revision: <n>
System managed; do not edit in Calendar
```

**Events already in the production calendar: unknown** (see A). If they were
created by the legacy Jotform producer they will almost certainly have *no*
`[SSO:…]` tag, and matching them is the hard part of any import — see F.

## D. What can safely be imported

In descending order of confidence:

1. **An event carrying an `[SSO:<uuid>]` tag** whose uuid resolves to a
   `calendar_links` row — an exact, durable link. Adopt automatically.
2. **An event whose id already appears** in `calendar_links.external_event_id`
   — already linked; reconcile state only.
3. **An event whose description or title contains a job reference matching
   `^SS-[A-HJ-NP-Z]{4}-[0-9]{4}$`** and which resolves to exactly one job —
   propose the link, but require a human to confirm it.

Anything else is a **suggestion at best** and must go to review.

## E. What should stay external only

- Anything with no confident job link (holidays, meetings, personal entries,
  supplier visits).
- Personal calendars. The reference's confirmed decision was **one shared
  calendar**, with `people.calendar_id` never consulted; keep that.
- Events on a calendar not in `calendar.allowed_calendar_ids`.

These should be *recorded as external* — "we looked at this and it is not ours"
is a useful, durable answer — and never linked to a job.

## F. Duplicate detection

Already designed; keep it exactly as it is:

1. Every outbox row has a unique `idempotency_key`, so a retry is the same row.
2. `attempt_count` is incremented and the row set to `Processing` **before**
   the external call, so a crash leaves a visibly uncertain row rather than a
   silent one.
3. On retry the service searches the calendar for the `[SSO:<link_id>]` tag and
   **adopts** the existing event instead of creating a second one.
4. Two tagged matches → `DUPLICATE_EVENTS`, `NeedsReview`, no writes.
5. A result with no event id → `UNCERTAIN_OUTCOME`, `NeedsReview`.
6. An update whose event has vanished → `EVENT_MISSING`, `NeedsReview` — never
   a silent recreate.

For an **import**, the equivalent rule is: match on the tag, then on
`external_event_id`, then stop. Never match on customer name or address
similarity. A wrong link silently attaches one customer's calendar entry to
another customer's job, and nothing downstream would ever question it.

## G. Ownership and source of truth

**The Simple Solar database is authoritative for operational scheduling.
Google Calendar is a projection of it.**

| Field | Owner |
|---|---|
| `work_packages.planned_start` / `planned_end` | Simple Solar |
| `allocations.person_id`, `start_at`, `end_at` | Simple Solar |
| `scaffold_bookings.*_planned_at` | Simple Solar |
| Event title, dates, description | Simple Solar (derived) |
| Event id, calendar id | Google (recorded by us) |
| Guest responses, attachments, colour | Google, ignored by us |

`calendar_links.entity_revision` versus `last_synced_revision` is how the
system knows a link is behind.

---

## The rule that must not be broken

**An external calendar change must never mutate operational scheduling.**

This is already implemented in `app.calendar_record_drift`, and it is worth
stating what that function does *not* do: it does not rewrite the event, and it
does not change any work package date. What it does:

```
external change detected
  → calendar_links.error = 'EXTERNAL_EDIT: start 2026-09-22 <> 2026-09-21'
  → audit CalendarExternalEdit (once per link revision)
  → one CAL-DRIFT task for the office
  → a human decides, and any actual change goes through MOVE_WORK_PACKAGE
```

So someone dragging an install from Monday to Tuesday **in Google Calendar**
produces a review task, not a moved job. The install moves only when a person
with the right role makes that change through the canonical command, with a
reason, a version check and an audit entry — exactly as the Planner does.

This is the same principle the Planner drag-and-drop follows: a drag is a
*proposal*, and only a command is a change.

## Proposed sync architecture

```
                    ┌─────────────────────────────────────┐
                    │  Simple Solar (authoritative)       │
                    │  work_packages / allocations /      │
                    │  scaffold_bookings                  │
                    └───────────────┬─────────────────────┘
                                    │ PLAN / MOVE / CHANGE_INSTALLER
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  app.s11_calendar_capture           │
                    │  calendar_links + outbox            │  ← exists
                    └───────────────┬─────────────────────┘
                                    │
             ┌──────────────────────┴───────────────────────┐
             │  WORKER (missing)                            │
             │  claim → gates → Google API → record         │
             └──────────────────────┬───────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────┐
                    │  Google Calendar (projection)       │
                    └───────────────┬─────────────────────┘
                                    │ someone edits an event
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  drift detection                    │  ← exists
                    │  error + audit + CAL-DRIFT task     │
                    │  NEVER a date change                │
                    └─────────────────────────────────────┘
```

### The worker's gates (all required, all already coded in `app.calendar_claim_decision`)

1. `FN-02` is `Automated` and its scope is `Pilot` or `All`.
2. `settings['calendar.mode'] = 'LIVE'`. Anything else is CAPTURE: report and
   leave `Pending`.
3. The link's `calendar_id` is in `calendar.allowed_calendar_ids`. Otherwise
   `NeedsReview` **before** any API call.
4. `outbox.target` agrees with the link.
5. `Processing` rows older than 15 minutes are recovered to `RetryDue`.

### Schema

**No migration is needed.** The durable identifiers §14 asks for all exist:

| §14 asks for | Column |
|---|---|
| provider | `producer` (`LegacyJotform` \| `NewSystem`) |
| external_calendar_id | `calendar_id` |
| external_event_id | `external_event_id`, plus `event_uid` |
| job_id | `job_id` (+ `allocation_id`, `scaffold_activity_id`) |
| event type | derived from which of those two is set |
| sync status | `status`, `error`, `outbox.status` |
| last synced version / time | `last_synced_revision`, `last_success_at`, `last_attempt_at` |

The only arguable gap is a place to record **external, non-job events** seen
during an import (§E). That is one small table, and it should not be created
until an import is actually authorised and the answers to §A are known.

### Import and reconciliation workflow

Read-only inventory first, then a reviewed apply — the same shape as the
historical job import that already worked:

```
Calendar import (dry run)

Found 184 events

126 linked automatically   [SSO:…] tag or known external_event_id
 31 possible matches       job reference in the text — REVIEW REQUIRED
 19 external / non-job     no job link — record and leave alone
  8 conflicts              two candidates, or dates disagree with ours

[Review the 31]  [Review the 8]
```

Rules:

- The dry run makes **no writes at all**, in either system.
- The 126 are safe because they rest on durable identifiers.
- The 31 are **never** auto-linked. Text similarity is not evidence.
- Where a linked event's dates disagree with ours, ours win and the event is
  queued for update — that is the direction of authority.
- No production calendar is written until the owner explicitly authorises it.

### Suggested order of work

1. **Owner answers §A.** Nothing else can be sized properly without it.
2. Port the worker (Node, `googleapis`, service account) with `calendar.mode`
   left at `CAPTURE`. `CALENDAR_DISPATCH_PREVIEW` already gives a dry run.
3. Run the import inventory read-only against the real calendar; review the
   counts.
4. A controlled smoke on a scratch calendar: create → replay (no-op) → update
   → delete, leaving it clean.
5. Pilot: `FN-02` → `Automated`, scope `Pilot`, `calendar.mode` → `LIVE`, for a
   handful of jobs, then back to `CAPTURE`.
6. Only then, a time-driven trigger.

Steps 2-6 are all outside this task's scope and none of them has been started.

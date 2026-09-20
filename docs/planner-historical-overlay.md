# Planner: the historical overlay

277 imported jobs carry genuine dates from the old Job Booking form. This
overlay shows them on the Planner **without making them operational**.

The whole design rests on one distinction, the same one the Job Detail fix
made: *being allowed to read a record* and *being allowed to work on it* are
different questions. Historical records are readable. They are not schedulable,
and nothing here makes them so.

---

## Where the dates actually are

The import creates **no** scheduling rows — no work packages, allocations,
tasks or scaffold bookings. It writes the whole candidate to
`intake.raw_payload_json`, and three fields under `historicalFacts` are genuine
booked work dates:

| Source column | Preserved at | Populated | Planner event |
|---|---|---|---|
| `Date Roofer` | `historicalFacts.work.roofDate` | 252 / 277 | Roof (historical) |
| `Date Sparky` | `historicalFacts.work.electricalDate` | 263 / 277 | Electrical (historical) |
| `Date Scaffolding` | `historicalFacts.scaffold.erectDate` | 196 / 277 | Scaffold up (historical) |

**Deliberately not events:**

- `jobs.sold_at` — when the form was submitted. Provenance, not work.
- `historicalFacts.commercial.invoiceIntentDate` (205/277) — an office
  *intention* to raise an invoice. The importer already refused to write it to
  `invoice_stages`; it is no more a planner event than it was an obligation.
- The repurposed panel-count column — never imported. Its meaning is an owner
  decision, and an ambiguous value must not become a confident event.

There is **no install-date column** in the source, so no "Install" event type
is invented. Where roof and electrical fall on the same day (54 of the 246
that have both), that is exactly what the form recorded and it renders as two
events on one day.

Date quality: every imported date parsed unambiguously — there is not one
`DATE_ERA_CONTRADICTION` warning across the dataset. Ranges are
`2025-02-27 → 2026-12-25` (roof), `2025-02-28 → 2026-12-01` (electrical),
`2025-03-01 → 2026-11-02` (scaffold).

## Architecture

A read projection, and nothing else.

```
app.historical_work_events     view: one row per preserved date
      │                        (intake → job, record_class = 'HistoricalImport')
      ▼
app.planner_historical_window(actor, from, to)
      │                        filtered by window AND app.can_read_job
      ▼
PLANNER_WINDOW { from, to, records: live | historical | both }
```

- **`records` is applied in the database.** "Live" does not fetch history;
  "Historical" does not fetch live work. Nothing is fetched and then hidden.
- **Authorization is `app.can_read_job`**, never `app.job_in_scope`.
  `job_in_scope` is false for every historical row, so using it would return
  nothing. `job_in_scope` and `job_actionable` remain false and untouched.
- The 186-day window cap is unchanged and applies to both halves.
- `PLANNER_HISTORICAL_COUNT` answers "how much history is in this window"
  without returning any of it, so an empty operational window can say what is
  actually there instead of looking broken.

## Why history cannot be moved

Not because a button is hidden. A historical calendar event is built with **no
`work` and no `scaffold` detail**, so it carries no work package id, no version
and no allocation id — the three things every scheduling command requires.
There is nothing to build a command from.

On top of that structural fact, `canDrag` refuses historical events first, the
panel's Move/Reassign buttons are behind `event.work`, and the drop handlers
return a refusal. Four layers, the innermost of which is "the entity does not
exist".

## Capacity, conflicts and Needs scheduling

- **Capacity**: readiness is computed by `app.rp_assess_person` from
  `public.allocations`. A historical record has none, so it contributes zero
  load and can never cause `CAPACITY_CONFLICT`.
- **Needs scheduling**: `PLANNER_UNSCHEDULED` filters on `app.job_actionable`,
  which is false for every historical row. A missing historical date means
  *not recorded*, never *needs scheduling*.
- **Team view**: driven by `RP_TEAM_PLANNER` allocations only, so history
  cannot occupy a resource row or imply someone was busy.

## Team view and historical staff — a deliberate limitation

The brief allows showing unambiguously linked historical staff in Team view.
This implementation **does not**, on purpose: Team view is a capacity surface,
and putting history into its rows is the most direct way to imply a person was
booked when no booking exists. That would work against §10 visually even while
the numbers stayed correct.

Historical staff attribution appears in the **side panel** instead, where it
can be shown with its match status and without a capacity implication:

| Role | Linked | Ambiguous | No match |
|---|---|---|---|
| Installer | 91 | 93 | 60 |
| Electrician | 219 | 38 | 5 |
| Salesperson | 45 | 47 | 1 |

A linked name shows the person *and* the original text ("Casey Lakey ·
recorded as 'Casey'"). An ambiguous or unmatched name shows only what the form
said, with why it was not resolved. The planner never guesses which current
person an old name meant, and `historical_job_people`'s own CHECK constraint
makes that a database guarantee rather than a convention.

This is easy to revisit if the office wants it — say so and it can be added as
a clearly-marked non-capacity strip.

## SimpleBot read parity (design only — nothing implemented)

The same reads should back SimpleBot, so there is one answer to any scheduling
question regardless of where it is asked.

| Question | Read | Notes |
|---|---|---|
| "What work did we have on 15 July?" | `PLANNER_WINDOW {from, to, records: 'both'}` | Answer must label which results are historical |
| "What historical installs were in Plymouth in August?" | `PLANNER_WINDOW {records: 'historical'}` + the existing planner search fields | Town/postcode are on the event already |
| "When was SS-XXXX-1234 installed?" | `PLANNER_WINDOW {records: 'historical'}` | Only from preserved facts; if no date was recorded, the answer is "not recorded", never a guess |
| "What's unscheduled?" | `PLANNER_UNSCHEDULED` | Historical is structurally absent |
| "How much history is in this window?" | `PLANNER_HISTORICAL_COUNT` | Cheap; no records returned |

Rules for the eventual tools:

1. **Read-only, and never offered a reschedule.** A historical result must not
   come with "shall I move it?" — there is nothing to move.
2. **Answer only from preserved facts.** No date recorded means "not
   recorded". Never infer one from `sold_at` or an invoice intention.
3. **Always say it is historical**, in words, in the answer text.
4. **Permissions are the user's own.** These reads are already registered for
   the office roles and refuse an installer; SimpleBot inherits that by using
   them rather than going round them.
5. **Ambiguous staff names stay ambiguous.** "Recorded as 'Dave'" is the
   answer; picking a Dave is not.

Nothing above is built. No SimpleBot scheduling mutation exists or is proposed
here.

## What was not touched

No release mode changed, no Google Calendar work, no SimpleBot mutations, no
historical record altered, and no operational row created. The only production
access used while building this was read-only SQL against hosted to audit the
dataset.

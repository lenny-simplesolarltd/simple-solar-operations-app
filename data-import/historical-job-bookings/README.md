# Historical Job Booking import

Migration tooling for the historical Job Booking form export into the current
Simple Solar operations schema.

**Status: analysis and dry run only. Nothing has been written to hosted
Supabase, and the importer has no write mode.**

---

## What must never be committed

| Path | Why |
| --- | --- |
| `source/*` | The raw export: real customer names, addresses, postcodes, emails, phone numbers and MPANs for 303 households. |
| `private/*` | Reconciliation files that deliberately contain the minimum PII needed to resolve ambiguous rows by hand. |

Both are covered by `.gitignore` at the repository root:

```
data-import/*/source/*
!data-import/*/source/.gitkeep
data-import/*/private/
```

`analysis/` **is** committed. Everything in it is redacted: customer name,
address, postcode, email, phone, MPAN and the legacy `Reference` column (which
embeds the postcode) are shown as masked values or character shapes only. Row
identity in the machine-readable report is carried by irreversible 8-character
tokens, never by a name or an address.

Before committing, re-run the dry run and check that `git status` shows no
`source/` or `private/` file.

---

## Source

- **File**: `source/job-booking-form-responses.csv`
- **Shape**: 303 data rows, 94 columns
- **Era**: submissions from February 2025 onward
- **Nature**: a booking form that evolved in place. Questions were added,
  replaced and in two cases repurposed, so the export is several generations of
  the same form flattened into one table.

It is historical source data. It is **not** authoritative over anything already
in Supabase: where the two disagree, the live record wins and the difference is
reported.

---

## Architecture

```
scripts/imports/historical-job-bookings/
  csv.ts         RFC 4180 reader. Positional, because header labels repeat.
  columns.ts     The registry: one entry per column, all 94, with destination,
                 transformation, conflict rule and disposition.
  normalise.ts   Total value parsers. Each returns a result, never a guess.
  directory.ts   Current people / companies / jobs to match against.
  match.ts       People matching and job deduplication. Both fail closed.
  transform.ts   Row -> import candidate.
  validate.ts    Classification and the proposed database operations.
  run.ts         CLI. Dry run only.
  docs.ts        Regenerates the derived analysis documents.
  __tests__/     84 tests, entirely synthetic fixtures.
```

Design rules the code holds to:

- **Deterministic.** The same row always produces the same candidate. No clock,
  no randomness, no network in the transform path.
- **No database client.** Nothing under `scripts/imports/historical-job-bookings/`
  imports `@supabase/*` or `pg`, opens a client, or calls `fetch`. A test
  asserts this.
- **Dry run is the only mode.** `--write` is recognised solely so it can be
  refused with an explanation.
- **Nothing is invented.** A value that cannot be read deterministically is
  preserved as text and flagged, never coerced.
- **No PII in logs.** Terminal output and committed reports are redacted by
  default; there is no verbose mode that lifts that.

---

## Commands

```bash
# Column profile: counts, inferred types, anomalies. Prints nothing to disk.
npm run import:historical-bookings -- --analyse

# Full dry run. Writes analysis/dry-run-report.json and private/review-required.csv.
npm run import:historical-bookings

# Regenerate the derived analysis documents from the registry and the last run.
npm run import:historical-bookings:docs

# Tests
npx vitest run scripts/imports/historical-job-bookings
```

Options: `--source <path>` to point at a different export, `--snapshot <path>`
to match against a hosted read-only snapshot instead of the staff seed.

---

## Analysis output

| File | Contents | Committed |
| --- | --- | --- |
| `analysis/column-mapping.md` | Every one of the 94 columns: meaning, quality, destination, transformation, conflict rule, disposition. Generated. | yes |
| `analysis/people-matches.md` | Every distinct historical staff value and how it resolves. Generated. | yes |
| `analysis/owner-decisions.md` | The decisions that block an import, grouped by pattern. Hand-written. | yes |
| `analysis/dry-run-report.json` | Machine-readable diagnostics, tokenised. | yes |
| `private/review-required.csv` | Rows needing manual resolution, with the minimum PII to identify them. | **no** |

---

## The dry run

Reads the whole export, transforms every row, matches it against current
records, classifies it, and writes the two reports. It performs **zero** hosted
writes and opens no database connection.

Rows are classified as:

| Class | Meaning |
| --- | --- |
| `READY` | Every constraint on every table the row would touch can be satisfied from the row itself. |
| `READY_WITH_WARNINGS` | Importable, but something was dropped or was odd. |
| `OWNER_REVIEW_REQUIRED` | A person must decide: an ambiguous staff alias, a probable duplicate job, conflicting identity. |
| `REJECTED` | A `NOT NULL` column or a `CHECK` constraint cannot be satisfied. |

A row never becomes importable automatically when it has an ambiguous
existing-job match, an ambiguous staff identity where one is required, an
invalid critical identifier, conflicting customer identity, an impossible date,
or a duplicated Submission ID.

---

## Idempotency

`public.intake` already carries `unique (form_id, submission_id)`. Every
historical row is filed under a fixed `form_id` of
`historical-job-booking-form`, with the CSV `Submission ID` as the
`submission_id`.

That makes the key the natural idempotency boundary: a second run sees the
submission already present, classifies it `ALREADY_IMPORTED`, and proposes
nothing beyond the intake row it already has. Every proposed operation carries
an idempotency key derived from it.

One caveat, and it is a blocker: the export holds only 287 distinct Submission
IDs across 303 rows. The 26 rows involved in a collision are rejected, because a
non-unique key is worse than no key — the second row would silently vanish on a
rerun. See `owner-decisions.md`, decision 3.

---

## Provenance

Every imported record will answer "where did this come from?" through its
`intake` row:

| Question | Column |
| --- | --- |
| Which system? | `form_id = 'historical-job-booking-form'` |
| Which submission? | `submission_id` |
| When was it submitted? | `received_at` |
| What did the original say? | `raw_payload_json` — all 94 columns, verbatim |
| Which legacy reference? | `source_revision` |
| Which job did it become? | `job_id` |
| Did the export change? | `payload_hash` |

Because `raw_payload_json` keeps every column, even the seven classified
`IGNORE` survive. No column is lost, whatever its disposition.

---

## Rollback philosophy

An import that cannot be undone is not safe to run, so:

- **Additive only.** The import creates records; it never edits or deletes an
  existing one. Where a historical row disagrees with live data, the live data
  wins and the difference is reported.
- **Identifiable.** Every created row traces to one `intake` row, and every
  `intake` row carries its batch and importer version. "Everything this batch
  created" is always a query, never a guess.
- **Reversible in the same order.** Rolling back means deleting what the batch
  created, youngest first. Because the import touches no live obligation table,
  a rollback cannot strand a task, an invoice or a message.
- **Rerunnable.** A partial run is recovered by running it again; completed
  submissions are skipped on their intake key.

---

## Eventual import process

Not yet possible. `owner-decisions.md` decision 1 records the blocker: inserting
a job fires an unconditional trigger that fabricates invoice stages, and no
`workflow_stage` avoids it. When the decisions are made, the order is:

1. Apply the additive migration that lets a job be marked historical.
2. Seed the scaffolder and merchant companies, if they are to exist.
3. Resolve the staff aliases in `owner-decisions.md` decision 4.
4. Resolve the duplicate Submission IDs.
5. Re-run the dry run against a hosted read-only snapshot and confirm the
   job-matching numbers.
6. Import into a restored copy of the database first, and diff.
7. Only then build and review a write mode.

---

## Hosted access

Analysis runs offline. People are matched against `supabase/seeds/001_staff.sql`,
the controlled staff list the hosted database was seeded from.

A hosted read-only check was attempted with the anon key and refused with
`42501 permission denied` on `people`, `jobs`, `intake` and `companies` — anon
holds no `SELECT` grant, which is the correct posture. No service-role
credential was used and no workaround was attempted.

The consequence is that job deduplication has not yet been exercised against
real data: with no authoritative job list, every row is provisionally
`NEW_HISTORICAL_JOB`. The matching rules are implemented and tested against
synthetic fixtures, but the counts in the current report are planning figures,
not findings. Supply a snapshot with `--snapshot` to get real ones.

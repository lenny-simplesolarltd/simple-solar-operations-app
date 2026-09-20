# Owner decisions — historical Job Booking import

Status after the second design + dry-run iteration (importer 2.0.0).
Nothing has been written to hosted Supabase; the migration has not been applied
anywhere but isolated local databases.

## Resolved

| # | Decision | How it was implemented |
| --- | --- | --- |
| 1 | Historical job architecture | `jobs.record_class` (`Live` \| `HistoricalImport`) plus `source_system` and `source_reference`. Migration `20260920150000_historical_import_model.sql`. |
| 2 | Provenance | `public.intake`, as approved: `form_id = 'historical-job-booking-form'`, `form_type = 'Booking'`. No new provenance table was needed. |
| 3 | Duplicate Submission IDs | Content-aware identity; see below — the data turned out not to match the premise of option B. |
| 4 | Staff | `Ben Q` → Ben Quick. Nothing else guessed. Unresolved names are preserved in `historical_job_people` with no person link and no allocation. Unknown staff no longer rejects a row. |
| 5 | Finance | Blank stays null. `No` → `Standard`. `Yes` → `OtherReview` **withdrawn**; see below. |
| 6 | Column 90 | Deterministic panel counts imported; date-shaped values preserved only, now a warning rather than a review. |
| 7 | Bens prompts | Preserve only. No tasks. Extraction possibility reported below. |
| 8 | Scaffold companies | No companies created. `Plym` and `Plym Group` not merged. Exact text preserved. "Not required" variants still read as `scaffold_required = false`. |
| 9 | Merchants | Preserve only. No orders, order lines or goods-in. |
| 10 | Files | Links inventoried, nothing downloaded, no evidence rows. |
| 11 | Date for invoice | Preserved in intake only. No invoice stages. |
| — | Missing price | Null for historical rows. Nothing invented. |
| — | Incomplete customer | Only a row identifying nobody is rejected; partial rows go to review. |

---

## Three findings that changed the answer

### A. The duplicate Submission IDs are not different jobs

Option B assumed the export mislabelled distinct jobs. The data says otherwise.

In **all ten** duplicate groups every row carries the same legacy `Reference`
*and* the same customer identity (surname, postcode, email, phone, submission
timestamp). Most are byte-identical across all 94 columns; in three groups one
row differs in a non-identity field only.

They are the same submission exported more than once, sometimes after an edit.
Giving them separate job records would have created duplicate jobs for one real
household — the exact failure the import must not have.

So the rule branches on evidence rather than on the count:

```
importKey(row):
  base = Submission ID                       # preserved exactly, never altered
  group = rows sharing base
  if group.size == 1:            return base
  fp = md5(surname | postcode | email | phone | submissionDate)   # normalised
  if all rows in group share one fp:
      return base                # one job; rows collapse, all recorded
  else:
      return base + '#' + fp[0:12]    # different customers; both addressable
```

This satisfies option B where option B's premise holds, and collapses where it
does not. Nothing is discarded: every contributing source row and its payload
hash is recorded on the candidate.

**Result on this export:** 303 source rows → **287 candidates**; 16 rows
collapsed; **0 identifiers reused across different customers**, so no key needed
a discriminator.

The discriminator is derived from the row's own fields, never its position, so
reordering or re-exporting cannot change a key. Editing a non-identity field
leaves the key alone and changes `payload_hash`, which is what makes a changed
re-export detectable as an update rather than a new record.

**Still needs you:** nothing blocking. Confirm the collapse is what you want —
if any of those 16 rows really is a separate job, say which and it will be
discriminated instead.

### B. `Yes` → `OtherReview` was the wrong representation

You asked whether it would mislead. It would. `finance_route` is not a label:
`OtherReview` is a live workflow route, and `app.evaluate_ready_to_book` and
`app.process_booking_gates` branch on `finance_route = 'Standard'` to decide
whether deposit evidence is required. Writing `OtherReview` onto history would
assert that a route decision was made when the form only recorded "finance was
used".

So `Yes` now leaves `finance_route` **null**, exactly like a blank, and the
original answer is preserved verbatim in the intake payload. Null means "the
legacy source did not record a route"; the fact that finance was involved is
still recoverable from the source.

**Still needs you:** confirm. The alternative is a `historical_finance_used
boolean` on the job, which is more structure than the data justifies.

### C. Staff ambiguity is one decision, not 42 row reviews

`Dave` appears on 42 rows and `Dan` on 7. Sending each row to review would ask
you the same question 49 times, which cuts against your instruction to group
repeated patterns.

Ambiguous names are now preserved unlinked and the row imports. The aliases are
reported once each here. Linking them later is a non-destructive update to
`historical_job_people` — it never touches the job.

**Still needs you**, as one table:

| Alias | Rows | Candidates |
| --- | --- | --- |
| `Lewis` | 120 | Josh Lewis, or a different person entirely (`Josh` appears separately) |
| `Dave` | 68 | Dave Hopwood or Dave Gorman |
| `Dan` | 7 | Dan Barnes or Dan Anderson |
| `Des` | 60 | nobody current |
| `Chris` | 5 | nobody current |
| `Travis` | 4 | nobody current |
| `Jordan` | 3 | nobody current |
| `Ryan` | 2 | nobody current |
| `Matt` | 1 | nobody current |

For the six with no match: existing person, new `people` row, or "subcontractor,
never create"? No row is blocked either way.

---

## Remaining decisions

1. **Confirm the duplicate collapse** (finding A).
2. **Confirm finance `Yes` → null** rather than a dedicated boolean (finding B).
3. **The nine staff aliases** (finding C).
4. **10 rows that cannot be imported as they stand.** 7 rejected, 3 review:
   5 have neither email nor phone (`customers_contact_method` requires one,
   and neither may be invented); 2 have no submission date, so no `sold_at`
   and no date era; 1 identifies no customer at all; 3 are missing a required
   customer field such as town or a valid postcode. They are listed with the
   minimum PII in the local-only `private/review-required.csv`.
5. **`Bens prompts` extraction.** `Canopy` (18 rows), `Smoke alarm` (13) and
   `Ohme` (6) are deterministically extractable from the multi-select and would
   fit `technical_details.electrical_notes`. Reported, not implemented, as
   agreed. Worth doing?
6. **Companies.** `companies` is empty on hosted (0 rows). Scaffolders and
   merchants would need seeding separately before any scaffold or order data
   could ever be linked. Not required for this import.
7. **Files.** 124 links on 73 rows, all Jotform. The separate Storage phase
   will need to know whether that form account is still active to fetch from.

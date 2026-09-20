# Customer document generation — Phase A audit and proposed architecture

**Part 1 is the audit, written before anything changed.** It records what the
repository actually contained, and nothing in it changed code, schema, settings
or storage. **Part 2, at the end, records what was then built** against the
decisions the audit asked for. No migration has been written and no hosted
environment has been touched.

The short version: **document generation does not exist.** Not partially, not
behind a flag. There is no PDF library in `package.json`, no template, no
generator, no document table, no storage category, no UI. The previous
discussion produced a proposal and nothing else, which is exactly why a
submitted presale has no quotation, no contract and no ROI.

What *does* exist, and must not be rebuilt, is substantial: an immutable
presale snapshot, a private file/evidence system, a proven background-work
engine, and a communications spine. The work is to add a generator between
them — not to invent infrastructure.

---

## A. What actually exists today

### A.1 Document generation — nothing

| Looked for | Found |
|---|---|
| PDF library (`pdf-lib`, `puppeteer`, `playwright`, `@react-pdf`, `pdfkit`, `jsPDF`) | **none** in `package.json` |
| HTML→PDF renderer, headless browser | none |
| `documents` / `quotes` / `document_revisions` table | none in 57 migrations |
| Generation command, worker, queue entry | none |
| Template files of any kind | none (`document-templates/` holds only the two master PDFs) |
| Generation status UI | none |

`docs/FILES_DOCUMENTS_ARCHITECTURE.md` already states this plainly and
pre-registers the intended shape: *"The application generates no documents
today… When document generation is built it must write the bytes into the
private `evidence` bucket through a registered row."* That constraint is
adopted below unchanged.

The only adjacent thing is `sale.quote_reference` — a **free-text string** on
the presale. It is a reference to a quote produced somewhere else, not a quote.
Contracts are likewise an external Signable reference plus a manually uploaded
signed PDF.

### A.2 Presale submission pipeline

`presale-wizard.tsx` → `submitPresale()` (`server/submit-presale.ts`) →
`public.submit_presale(p_command_id, p_payload)`.

- One RPC, one transaction: customer + job + presale + tasks + audit.
- Idempotent on `command_id` through the commands ledger (`replay: true`).
- The database re-validates everything; the server action decides nothing.
- Returns `{ job_id, job_ref, customer_id, presale_id, workflow_stage, tasks }`.

`public.presales` is **immutable** — `app.forbid_mutation()` fires on update and
delete — and `job_id` is `unique`. It stores:

```
design jsonb            -- the entire designer state
design_schema_version   -- integer
catalogue_version       -- text, e.g. 'artifact-v0.12-2026-09-16'
system_kwp, net_panels
computed_total_pence    -- what the engine calculated
agreed_price_pence      -- what was actually sold
price_breakdown jsonb   -- the line-by-line rows
surveyor_id, submitted_at, roof_notes, electrical_notes
```

**This is already a perfect document snapshot** and the architecture below
builds on it rather than duplicating it. It is the single most useful thing the
audit found.

### A.3 Files / documents

Single implementation, `src/features/files/`, backed by `public.evidence` +
`public.file_folders`. Private Supabase Storage bucket **`evidence`**
(`public: false`), RLS via `app.evidence_can_read_object` /
`_can_store_object`. Object names are identity —
`<job_id>/<evidence_id>/<safe name>` — never a filing path. Filing lives in
mutable columns (`folder_id`, `display_name`, `trashed_at`, `filing_version`).

`JobFilesTab` and the global `/dashboard/files` manager are the **same**
`FileManager` component. Anything registered as evidence appears in both for
free. `app.file_evidence_locked()` already exists to make a referenced document
untrashable — precisely the protection a sent contract needs.

### A.4 Background processing

Two separate, mature mechanisms:

| | `public.outbox` | `public.command_batches` |
|---|---|---|
| Purpose | dispatch to an **external** service | run **internal** commands in bulk |
| Registry | `app.outbox_action_types` (release gate + `live_setting`) | `operation` CHECK constraint |
| Retry | `attempt_count`, `next_attempt`, backoff, `stalled_minutes` | identical shape: 5 attempts, `[1,2,4,8,16]` min, 5 min stall |
| Claim | `outbox_claim(...) for update skip locked` | `run_batch_chunk(batch_id, limit)` |
| Recovery | `outbox_record_success/_failure/_uncertain/_release_stalled` | `batch_release_stalled`, `run_batch_recovery` |
| Progress | — | `app.batch_progress()` — derived, never stored |

`command_batches` is the right *shape* but is **task-specific**:
`operation` is CHECK-constrained to four `TASK_BATCH_*` values and
`command_batch_items.task_id` is `not null references public.tasks`. Document
generation cannot reuse it without widening both. Proposal below: a dedicated
table modelled on the same proven protocol, rather than destabilising batches.

`/dashboard/system` and `src/features/operations/` already render batch
progress (`batch-progress.tsx`, `processing-indicator.tsx`) — the visual
vocabulary for "queued / processing / failed / retrying" exists.

### A.5 Communications

`20260920250000_communications_dispatch.sql`, and `docs/COMMUNICATIONS_ARCHITECTURE.md`.

`public.communications` already carries **`attachment_ids`** and `revision`,
with status `Draft → Approved → Queued → Sent / Uncertain / Failed`, plus
`app.cmd_communication_approve / _queue / _record_sent` and
`app.read_communications`. `communication_jobs` joins a message to jobs.

Critically: **it sends nothing.** `release_modes.*` are `Disabled`,
`settings['outbound.allowed_recipients']` is `[]`, and there is no email action
type in the outbox registry. So "Email this document" can be built end-to-end
against a real, audited spine that is deliberately inert — the auditable chain
`Job → revision R1 → communication → attachment R1` is achievable today;
actual delivery stays switched off until the owner turns it on.

`src/features/communications/` currently has only `queries.ts`, `types.ts` and
`communication-actions.tsx` — there is **no compose UI yet**.

### A.6 Calculation engines

**Pricing** (`designer/calc/pricing.ts`) — complete and trustworthy. Produces
every line the quotation's goods/services table needs. Relevant defaults live in
`catalogue.ts`: `DEFAULT_DELIVERY_WASTE = 600`, `DEFAULT_VAT = 0`,
`UPLIFT = 1.18`, `FIXED_FEE_1 = 350`, `FIXED_FEE_2 = 480`,
`DEPOSIT_SPLITS` = 25 / 35 / 40 %.

**Performance** (`designer/calc/performance.ts`) — year-1 only, plus one
closed-form 30-year total:

```
annualGenerationKwh = Σ kWp × radiance × PERFORMANCE_RATIO(0.85) × (1 − shading%)
generationUsedKwh   = generation × selfConsumption%
electricitySavings  = used × tariff
segIncome           = exported × segRate
totalIncome30yr     = geometric series, r = (1 − degradation%)(1 + INFLATION 5%)
roiPct              = year-1 income / system cost × 100     ← a yield %, not payback years
```

It emits **no per-year series**. The ROI master's pages 7, 8 and 14 are
entirely a per-year series. This is the single largest calculation gap and is
detailed in §D.

### A.7 Revision / audit architecture

`public.commands` (ledger, idempotent on `command_id`), `audit_events` with
`executing_service`, `app.audit_row_change()` triggers, per-row `version`
columns with `expected_version` conflict refusal (`FILE_CONFLICT`). Everything
needed to make document revisions provable already exists as a pattern.

---

## B. The master PDFs — what they actually are

Measured, not assumed.

| | Quotation / Contract | ROI |
|---|---|---|
| File | `document-templates/presale/quotation/master.pdf` | `document-templates/presale/roi/master.pdf` |
| Title | `Presale Automation 08/09/2025 DO NOT TOUCH` | `New Master Keynote Original (ROI)` |
| Producer | Skia/PDF m155 — **Google Docs** | Google (Slides/Keynote export) |
| Pages | **24** | **15** |
| Page size | 596 × 842 pt (A4 portrait) | **1920 × 1080 pt** (16:9 landscape) |
| AcroForm | `Form: none` | `Form: none` |
| JavaScript | no | no |

Both are flat. Confirmed: the `{{…}}` tokens are ordinary drawn text.

### B.1 Placeholder census

Every `{{…}}` token, by page, extracted with exact bounding boxes, font and
size (`pdfplumber`). Full geometry is reproduced in the template map, §E.

**Quotation — 10 of 24 pages carry placeholders; 14 are wholly static.**

| Page | Content | Placeholders |
|---|---|---|
| 1 | Cover letter | `fullname`, `firstline`, `city`, `postcode`, `date`, `ref`, `firstname` |
| 2 | About / static | — |
| 3 | **Quotation table** | 24 tokens: `panel`/`panelq`, `inverter`/`inverterq`, `battery`/`batteryq`, `ev`/`evq`, `backup`/`offgridq`, `birdnettingq`, `iboostq`, `immersionq`, `optimisersq`, `gt`, `scaffq`, `st`, `gsst`, `totalcost`, + header fields |
| 4 | Warranties + payment schedule | `25`, `35`, `40` (deposit stages) |
| 5 | Acceptance | `fullname`, `date` |
| **6–17** | **Contract of Sale — terms & conditions** | **none (static legal)** |
| 18 | Contract signature page | `fullname`, `fulladdress`, `date` |
| 19 | MCS performance header | `ref`, `fulladdress`, `surveyor`, `date` |
| 20 | **MCS MIS 3002 estimate** | `capacity`, `orientation`, `inclination`, `postcodezone`, `kk`, `sf`, `output`, `archetype`, `consume`, `selfconsume`, `pvdep`, `battkwh` |
| 21 | The Figures | `archetype`, `selfconsumeperc`, `exportperc`, `savingsyear1`, `segyear1`, `totalcost`, `savings`, `totsavings`, `roi` |
| 22 | Assumptions | `date`, `surveyor` |
| 23 | Checklist | `ref` |
| 24 | Static | — |

Contract of Sale begins at page 5/6 and runs to 18 — matching the ~page-10
estimate loosely; the exact boundary is now known.

**ROI — 6 of 15 pages carry placeholders; 9 are wholly static.**

| Page | Content | Placeholders |
|---|---|---|
| 1 | Cover | `name`, `ref`, `fullname`, `address`, `phone`, `email`, `date`, `surveyorname`, `price`, `roi` |
| 2, 3, 5, 6 | Marketing / static | — |
| 4 | **System summary** | `panelquantity`, `systemsize`, `generation`, `annualsaving`, `totalsaving`, `inverter`, `battery`, `batterysize`, `price`, `annualusage`, `annualsavings`, `roi`, `priceperkw`, `segrate` |
| 7 | "If nothing changes" table | 30 numbered tokens |
| 8 | With-solar comparison table | 60 numbered tokens |
| 9–13 | Static | — |
| 14 | Recap | `54`, `130`, `73`, `148`, `53`, `154` |
| 15 | Contact | `surveyorname`, `surveyorcontact`, `surveyoremail` |

### B.2 The ~60 numbered ROI fields — now decoded

They are not undefined. They are a **row-indexed projection table**. Rows are
years 1, 2, 3, 4, 5, 10, 15, 20, 25, 30 — indexed by *row ordinal* n
(1–15 = years 1–15, n=16 → year 20, n=17 → year 25, n=18 → year 30):

| Column | Token | Verified |
|---|---|---|
| Pence per kW (no solar) | `{{54 + n}}` | n=1→55, n=10→64, n=15→69, n=16→70, n=17→71, n=18→72 ✅ |
| Monthly bill (no solar) | `{{3n − 1}}` | n=1→2, n=5→14, n=10→29, n=16→47, n=18→53 ✅ |
| Annual bill (no solar) | `{{3n}}` | n=1→3, n=10→30, n=18→54 ✅ |
| With-solar triple | `{{3n + 98/99/100}}` | n=1→101‑103, n=10→128‑130, n=16→146‑148 ✅ |

And the summary tokens resolve consistently: `{{73}}` = total 30-year spend,
`{{74}}` = monthly bill in year 30, `{{72}}` = price per kW in year 30,
`{{130}}` / `{{148}}` / `{{154}}` = cumulative savings after 10 / 20 / 30 years
(page 14 recap uses exactly these).

**One internal inconsistency in the master:** page 7 labels "Monthly
Electricity bill in 30 years" as `{{74}}`, page 14 labels the same quantity
`{{53}}`. `{{53}}` is the row-18 monthly figure, so page 14 is right and page 7's
`{{74}}` is a separate (probably duplicate) token. Flagged for owner review.

### B.3 Fonts — measured

Every font in both masters is **embedded as a subset**.

| Master | Fonts used by placeholder text |
|---|---|
| Quotation | `TimesNewRomanPSMT` 9/10 pt, `TimesNewRomanPS-BoldMT` 9/10 pt — black, and nothing else |
| ROI | `Poppins-Regular` 18/24/30 pt, `Poppins-Bold` 24/30/33 pt, `HelveticaNeue` 30 pt — black |

Two findings that decide the architecture:

1. **The subsets cannot be reused to draw new text.** Extracting every embedded
   font program shows `Poppins-*`, `HelveticaNeue*` and `Arial*` have **no
   `cmap` table at all** (Identity-H CID subsets: `glyf, head, hhea, hmtx,
   loca, maxp` only). `TimesNewRomanPSMT` has a format-4 cmap covering just 79
   codepoints — **missing `&`, `8`, `J`, `X`, `Z`**. A customer named *Jones*,
   or any price containing an *8*, could not be rendered. Re-embedding the
   masters' own fonts is therefore not an option.

2. **The Times really is Times.** Comparing advance widths of the extracted
   subset against macOS `Times New Roman.ttf`: same 2048 upem, **56 glyphs
   compared, zero width mismatches**. It is genuine Monotype Times New Roman,
   not Google's Tinos substitute. Same applies to Helvetica Neue.

Consequences for "pixel-perfect" are set out in §F, and are the first thing
needing a decision.

---

## C. Master content conflicts, re-audited against current `main`

Every item from the previous audit, re-checked against today's code.

| # | Master content | Where | Current app | **Classification** |
|---|---|---|---|---|
| 1 | "SUNPOWER Premier Partner", "We only ever install SUNPOWER Performance Panels", "{{panelquantity}} SUNPOWER panels" | ROI p2, p3, p4, p6 | `PANELS` contains exactly two entries, *SunPower M Class 475 W* and *SunPower P7 510 W* | **CANONICAL APP VALUE** — accurate today, but must be **derived from the selected panel**, never baked in. The brand word inside body copy on p4 must become dynamic; the partner claim on p2/p3 is **STATIC LEGAL/MARKETING COPY** and stays. |
| 2 | `Delivery costs: £600.00` — printed literally, *not* a placeholder | Quotation p3 | `DEFAULT_DELIVERY_WASTE = 600`, but `design.pricing.deliveryWaste` is an editable field | **CANONICAL APP VALUE** — a bug in the master. Must become a new dynamic region; printing £600 when the surveyor entered something else would misstate the contract price. |
| 3 | `VAT: £0` — printed literally | Quotation p3 | `DEFAULT_VAT = 0`, `design.pricing.vat` editable | **CANONICAL APP VALUE** — same treatment. (0 % on domestic retrofit is currently correct UK law, but the value is a field, not a constant.) |
| 4 | "we have assumed an increase of **7%** in electricity prices"; "*Based on a **7%** yearly increase*" | Quotation p22, ROI p7 | `ELECTRICITY_INFLATION_PCT = 5` | **MISSING BUSINESS DECISION** — blocking. See §G.1. |
| 5 | ~60 numbered ROI fields | ROI p7, p8, p14 | decoded (§B.2); the underlying **series is not computed** | **CALCULATED VALUE — engine gap.** See §D. |
| 6 | Yearly series / goods-services split | ROI p7‑8; Quotation p3 | goods/services split **is** derivable from `breakdownRows()`; the yearly series is **not** | Goods/services: **CALCULATED VALUE (available)**. Yearly series: **CALCULATED VALUE (missing)**. |
| 7 | Panel warranty "30 Years" | Quotation p4 | `mclass-475.warrantyYears = 40`, `p7-510 = 30` | **CANONICAL APP VALUE** — must be derived per selected panel, currently mis-stated for M Class. |
| 8 | Page 7 `{{74}}` vs page 14 `{{53}}` for the same figure | ROI | n/a | **DEPRECATED MASTER CONTENT** — owner to confirm p14 is correct. |

Nothing else in the 24-page quotation contradicts the app. Pages 6–17 are
contract terms and are treated as **STATIC LEGAL COPY**, untouched.

---

## D. ROI — required inputs and outputs, and the exact gap

### D.1 What the master requires

Per projection row n ∈ {1…15, 20, 25, 30}:

```
price_per_kwh(n)      = tariff × (1 + inflation)^(n−1)
annual_bill_no_pv(n)  = annual_consumption_kwh × price_per_kwh(n)
monthly_bill_no_pv(n) = annual_bill_no_pv(n) / 12
generation(n)         = generation_y1 × (1 − degradation)^(n−1)
self_consumed(n)      = generation(n) × self_consumption_pct
exported(n)           = generation(n) − self_consumed(n)
saving(n)             = self_consumed(n) × price_per_kwh(n) + exported(n) × seg_rate(n)
annual_bill_with_pv(n)= annual_bill_no_pv(n) − self_consumed(n) × price_per_kwh(n)
cumulative_saving(n)  = Σ saving(1..n)
```

Plus scalars: total 30-year spend, price per kW in year 30, price per kWp
(`{{priceperkw}}`), payback/ROI (`{{roi}}`), `{{segrate}}`.

### D.2 What the engine provides

| Required | Status |
|---|---|
| `generation_y1` | ✅ `annualGenerationKwh` |
| `self_consumption_pct`, `tariff`, `seg_rate` | ✅ `design.performance.*` |
| `degradation` | ✅ `PANEL_DEGRADATION_PCT` / `FALLBACK_DEGRADATION_PCT` |
| `system_cost` | ✅ `pricing.total` |
| **`annual_consumption_kwh`** | ⚠️ **optional and nullable today** (`annualConsumptionKwh: ''` by default; `Performance.annualConsumptionKwh: number \| null`) |
| **inflation rate** | ❌ **5 % vs 7 % unresolved** |
| **per-year series (any of the above)** | ❌ **not computed — no loop exists** |
| **`seg_rate` escalation** | ❌ undefined: does SEG inflate with the tariff, or stay flat? |
| `{{roi}}` semantics | ⚠️ ambiguous: engine's `roiPct` is a year-1 **yield %**; the ROI cover and page 4 read like **payback in years** |

**The series itself is straightforward to implement** — it is a loop over
existing inputs. It is not blocked by missing maths. It is blocked by three
inputs: the inflation rate, whether SEG escalates, and `{{roi}}`'s meaning.
Per the brief, none of those will be invented.

`annual_consumption_kwh` being optional is a **hard generation gate**: without
it, every "no solar" bill in pages 7, 8 and 14 is unresolvable. The document
must refuse rather than fabricate.

### D.3 MCS page — a separate, compliance-grade gap

Quotation pages 19–21 are a **certifiable MCS MIS 3002 / MGD 003 performance
estimate**, not marketing. The app does not hold what it declares:

| Master field | App |
|---|---|
| `{{orientation}}` degrees from south | `slope.orientation` is an **enum**, not degrees |
| `{{inclination}}` degrees | ✅ `slope.pitchDeg` |
| `{{postcodezone}}` MCS postcode region | ❌ not held |
| `{{kk}}` radiation from the MCS table | ⚠️ app has a free-typed `radiance`, not a table lookup |
| `{{sf}}` Shade Factor | ⚠️ app has `shadingPct`; SF is a different MCS quantity |
| `{{output}}` = kWp × Kk × SF | ⚠️ **the app computes `kWp × radiance × 0.85 × (1 − shading%)`** — an extra performance ratio the MCS method does not have |
| `{{archetype}}` occupancy archetype | ❌ not held |
| `{{pvdep}}` self-sufficiency % | ❌ not held (different from self-consumption %) |
| single orientation/inclination | ⚠️ the designer supports **many elevations** |

So the declared method and the computed number **do not agree**, and four
fields have no source at all. Page 20/21 cannot be honestly generated today.
Recommendation in §G.4: generate the quotation and contract now, and gate the
MCS section behind the missing inputs rather than approximate a certifiable
document.

---

## E. Rendering architecture — the decision, with evidence

The brief asked for options A–D to be investigated before choosing.

| Option | Verdict |
|---|---|
| **A** — keep original pages, place content in defined regions | **Chosen.** |
| **B** — surgically mask/replace dynamic regions, keep the rest | **Chosen** — A and B are the same technique here; B is A plus removal of the existing token glyphs. |
| **C** — reconstruct only pages that need dynamic layout | **Adopted for ROI pages 7 and 8 only**, where row count and column content are genuinely tabular and variable. |
| **D** — full HTML/CSS rebuild | **Rejected.** 23 of 39 pages are static legal or design pages with embedded artwork and licensed fonts. Rebuilding them guarantees visual drift, risks altering contract wording, and the brief explicitly forbids introducing drift on static pages. |

### E.1 Why B is viable here

Every placeholder is a single, black, horizontally-set text run on a flat page,
with a known bbox, font and size. There is no reflowing paragraph containing a
token mid-sentence except ROI page 4 and quotation page 21 — both of which sit
on solid backgrounds and are handled as measured inline regions.

### E.2 The pipeline

```
presales row (immutable)  ──┐
public.jobs / customers     ├─→  DocumentInput  (typed, validated, versioned)
people (surveyor)           │         │
catalogue (versioned)     ──┘         ▼
                             resolve variable registry
                                      │
                    ┌─────────────────┴─────────────────┐
              all required resolved              any required missing
                    │                                   │
                    ▼                                   ▼
         snapshot → document_revisions           status = Failed
                    │                            actionable error, no PDF
                    ▼
      render: pdf-lib loads master.pdf
              → per page, for each region:
                  cover original token run (background-matched rect)
                  draw value in licensed full font at mapped origin
              → ROI p7/p8: draw generated table rows
              → flatten, strip metadata
                    │
                    ▼
      checksum (sha256) → private `evidence` bucket
              storage_path = <job_id>/<evidence_id>/<safe name>
                    │
                    ▼
      evidence row, category 'GeneratedDocument'
              → appears in Job > Files and /dashboard/files automatically
              → app.file_evidence_locked() keeps a sent revision undeletable
                    │
                    ▼
      Job Detail "Customer documents" card · Operations centre · Communications compose
```

**Library:** `pdf-lib` (MIT, pure JS, no native binaries, runs in a Next.js
server action / route handler). It can load the master, draw text and
rectangles on existing pages, embed a full TrueType font via `@pdf-lib/fontkit`,
and save a flattened PDF. No headless browser, no system dependency, no
Chromium in the deploy image.

**HTML preview** is a separate, honest surface: a server-rendered page showing
the *resolved variable set* and a page-by-page PNG preview of the real PDF —
not a second renderer that could disagree with the PDF. Preview and download
therefore cannot drift, satisfying "the downloaded artifact looks the same as
Preview" by construction.

### E.3 Template map

A checked-in, typed, versioned map — `document-templates/presale/*/map.v1.json`
— generated from the master by the extraction script and then reviewed by hand.
One entry per dynamic region:

```jsonc
{
  "template": "quotation-contract",
  "version": "1.0.0",
  "master": "document-templates/presale/quotation/master.pdf",
  "masterSha256": "…",
  "pageSize": [596, 842],
  "regions": [
    {
      "id": "customer.full_name@p1",
      "page": 1,
      "token": "{{fullname}}",
      "bounds": { "x0": 72.0, "y0": 97.7, "x1": 126.7, "y1": 107.7 },
      "source": "customer.full_name",
      "font": "Times-Roman", "size": 10, "colour": "#000000",
      "align": "left",
      "required": true,
      "overflow": "wrap",          // wrap | shrink-to-min | truncate-ellipsis
      "minSize": 8,                // never below this — legibility floor
      "maxLines": 2,
      "fallback": null             // required regions have no fallback
    }
  ]
}
```

Rules the map enforces, per the brief:

- `overflow: "shrink-to-min"` never goes below `minSize`; below that it wraps,
  and if it still does not fit, generation **fails** rather than overlapping.
- Every region declares `required` explicitly. A missing required value fails
  the whole document with a named error.
- Regions are collision-checked at build time: no two regions on a page may
  overlap after layout.

The masters' own SHA-256 is recorded so a changed master invalidates the map
loudly instead of silently mis-positioning text.

---

## F. Fonts — the honest position

| Master font | Used for | Licence | Plan |
|---|---|---|---|
| **Poppins** Regular / Bold | all ROI dynamic text except p4 numerics | **SIL OFL 1.1** | ✅ ship the full family; **glyph-identical to the master** |
| **Times New Roman** Regular / Bold | **all** quotation + contract dynamic text | Monotype, proprietary, **not redistributable** | ⚠️ decision required |
| **Helvetica Neue** | ROI p4: `panelquantity`, `systemsize`, `inverter`, `generation`, `battery`, `batterysize`, `roi`, `annualsavings` | Monotype/Apple, proprietary | ⚠️ decision required |

For Times New Roman the metric-compatible libre substitute is **Tinos**
(Apache 2.0, Steve Matteson) — identical advance widths, so line breaks,
alignment and column positions are **exactly** right; glyph outlines differ
slightly. For Helvetica Neue there is **no metric-compatible libre clone**;
the nearest is Arial/Arimo, whose metrics differ.

So, stated plainly rather than glossed:

- **Static pages: genuinely pixel-identical**, because the original page bytes
  are preserved and nothing is redrawn.
- **Dynamic text: pixel-identical only if the licensed fonts are supplied.**
  With Tinos, quotation dynamic text is metrically perfect and visually
  near-identical. With any substitute for Helvetica Neue, ROI page 4's eight
  numeric values will differ visibly in letterform.

This is a licensing decision, not a technical one — see §G.2.

---

## G. Blocking decisions

Four. Everything else in the brief can be implemented without further input.

### G.1 Electricity price inflation — 5 % or 7 %?
The masters print 7 % as a customer-facing assumption in two places; the app
computes with 5 %. This changes every figure in ROI pages 7, 8 and 14 and the
payback headline on the cover. **Cannot be inferred**; approximating it would
put a wrong financial projection in front of a customer.

### G.2 Font licensing
Either (a) supply licensed Times New Roman and Helvetica Neue files for
embedding, or (b) accept Tinos for Times (metrically exact) and nominate a
substitute for Helvetica Neue, or (c) accept a small, documented visual
deviation on ROI page 4 only. Affects whether "pixel-identical" can be claimed.

### G.3 `{{roi}}` — yield % or payback years?
The engine computes a year-1 yield percentage. The cover reads as a payback
period. One of the two is wrong on a customer-facing document.

Related: does the SEG rate inflate with the tariff, or stay flat for 30 years?

### G.4 MCS pages 19–21
Four fields have no source (`postcodezone`, `archetype`, `pvdep`, degrees-from-
south), and the declared MCS method disagrees with the implemented formula
(§D.3). Options: (i) collect the missing inputs in the presale wizard and align
the formula, (ii) generate the quotation/contract without the MCS section for
now, or (iii) leave the section blank-but-present. This is a certification
question, so it is the owner's call.

---

## H. Proposed schema (for review — not written)

```sql
-- One logical customer document per job per type.
create table public.job_documents (
  id, job_id, document_type,        -- 'QuotationContract' | 'ROI'
  current_revision_id, created_at,
  unique (job_id, document_type)
);

-- Immutable. One row per generation attempt that produced, or tried to
-- produce, a customer-facing artifact.
create table public.document_revisions (
  id, job_document_id, revision_number,
  command_id uuid unique,           -- idempotency: a retried click replays
  document_type, template_id, template_version, master_sha256,
  presale_id,                       -- the frozen source
  input_snapshot   jsonb not null,  -- every resolved variable, as rendered
  calculation_snapshot jsonb not null,
  status text check (status in
    ('Pending','Preparing','Rendering','Generated','Failed','Superseded')),
  evidence_id      uuid,            -- the stored PDF, null until Generated
  content_sha256   text,
  page_count       integer,
  generated_at, generated_by, source text,  -- 'ui' | 'simplebot' | 'system'
  error_code, error_detail jsonb,
  attempt_count, next_attempt, claimed_at,
  unique (job_document_id, revision_number)
);
-- app.forbid_mutation() on anything except status/attempt bookkeeping.
```

- **Idempotency**: `command_id` is frozen when the request is made, exactly as
  `command_batch_items` does. A worker retry, a double click or a browser
  refresh replays the existing revision instead of creating a second one.
- **Immutability**: an input/calculation snapshot never changes. Regeneration
  marks the old revision `Superseded` and inserts a new one. Nothing is
  overwritten.
- **Files**: `evidence.category = 'GeneratedDocument'`, `context = Job`, so it
  appears in the existing Files surfaces with no new repository.
- **Email traceability**: `communications.attachment_ids` holds the
  `evidence_id` of the exact revision. R2 existing later does not change what
  an earlier email points at.

Filenames: `SS-WDDG-5412-Quotation-Contract-R1.pdf`, normalised through the
existing `src/features/files/names.ts` safe-name helper.

---

## I. When to generate

`submit_presale` succeeds → enqueue **`Pending`** revisions for both document
types, then kick generation immediately from the server action (a user-triggered
generation must start at once; recovery only mops up interrupted work — no cron
as the primary path).

**Gates, before any legally meaningful document is produced:**

| Gate | Refusal |
|---|---|
| `system_kwp > 0` **and** `net_panels > 0` | `INCOMPLETE_DESIGN` |
| `annual_consumption_kwh` present *(ROI only)* | `MISSING_CONSUMPTION` |
| `annualGenerationKwh > 0`, no `missingRadiance` *(ROI only)* | `MISSING_GENERATION_FORECAST` |
| job is not a `HistoricalImport` | `HISTORICAL_IMPORT` |
| every `required` region resolved | `UNRESOLVED_VARIABLE:<id>` |

**On the `0.00 kWp / 0 panels` case raised in the brief** — the audit explains
it. `presales.system_kwp` has check `>= 0`, and `netPanelsForSlope()` returns 0
whenever a slope's geometry is incomplete or no panel fits. So a presale can be
submitted with a real `agreed_price_pence` and a zero system, and today nothing
objects. That is exactly the state that must **never** produce a contract or an
ROI; the first gate above is the fix, and whether `submit_presale` itself should
reject it is a further question for the owner.

---

## J. What implementation will cover

Document types: Quotation & Contract (one combined artifact, matching the
master — the Contract of Sale pages 5–18 are internally a separate template
section so it can later be emitted alone, but is **not** split now, because the
master's pagination and its page-5 acceptance block bind them).
ROI: second artifact.

Then: the template maps, the variable registry, generation commands and worker,
revision/status model, Job Detail "Customer documents" card with Preview /
Download / Email / ⋯ (Regenerate, View revisions, View generation details),
Files integration, Operations-centre exposure, Communications compose
integration attaching the exact stored revision, and the visual regression
harness (master vs generated at identical raster resolution, dynamic regions
masked for the structural pass and asserted separately, diff artifacts per
page).

**Accepted constraint:** the visual-regression report, the example PDFs and the
pixel diffs are produced for manual inspection **before** any production
deployment, and no hosted migration runs without the target and migration set
being confirmed first.

---

# Part 2 — What was built

The four decisions in §G were answered as: inflation becomes a **configurable
setting** captured per revision; fonts are **Tinos for Times, Poppins for the
ROI's Helvetica Neue numerics**; `{{roi}}` on the ROI report is a **payback
period in years**; and the MCS section gets its **missing inputs collected and
the formula aligned**. Everything below follows from those.

## The rendering core (built, verified)

| Piece | Where |
|---|---|
| Region extraction from the masters | `scripts/documents/extract-regions.py` → `regions.v1.json` |
| Placeholder redaction | `scripts/documents/build-template.py` → `master.redacted.pdf` |
| Template map (token → variable) | `src/features/documents/bindings.ts` |
| Typed snapshot + resolver | `src/features/documents/resolve.ts`, `types.ts` |
| 30-year projection | `src/features/documents/calc/projection.ts` |
| Renderer | `src/features/documents/render/` |
| Sample generation | `scripts/documents/render-samples.ts` (`npm run documents:samples`) |
| Visual regression | `scripts/documents/visual-regression.py` (`npm run documents:visual`) |

### Redaction, not masking

The first working version covered placeholders with a background-coloured
rectangle. The documents *looked* right and `pdftotext` still found all 42
tokens — copy-paste, search and a screen reader would have found them too. That
does not meet "zero unresolved placeholders", so placeholders are now **removed
from the page content stream** at build time (738 glyphs from the quotation,
977 from the ROI; both masters now extract zero `{{`).

The two masters needed different handling, and the difference matters:

- The quotation (Google Docs) draws **one glyph per operator**, each with its
  own absolute text matrix, and a token spans eighteen of them. They are found
  by reassembling the page's text in stream order, not per operator.
- The ROI (Slides) draws **whole sentences per operator** — `(Hi {{name}}, here
  is you personalised )` is a single `Tj`. Deleting glyphs from the middle would
  pull the rest of the sentence leftward, so the token's glyphs are replaced
  with an exact kerning advance taken from the font's `/W` array. Every
  surviving glyph stays on the same point of the page.

### Measured results

| | Quotation | ROI |
|---|---|---|
| Pages out | 21 (3 MCS pages withheld) | 15 |
| Regions drawn | 45 | 126 |
| Unresolved `{{...}}` in output | **0** | **0** |
| **Static drift vs master** | **0.000000 %** | **0.007999 %** |

Static drift masks every dynamic region in *both* images and compares what is
left — the artwork, tables, borders and the whole 13-page Contract of Sale.
Zero means the generator disturbed nothing it had no business touching. The
ROI's 0.008 % is rasteriser antialiasing around redrawn glyph edges.

### Fonts, verified rather than asserted

Tinos vs real Times New Roman: **95 printable ASCII glyphs compared, zero
advance-width mismatches**. Every master token's measured width reproduces
within 0.07 pt (`{{fullname}}` 54.74 vs 54.70; `{{surveyorname}}` 218.54 vs
218.50). Column alignment and right-aligned edges are therefore exact.

Subsetting is **off**: pdf-lib's subsetter silently drops glyphs from these
files — "Jane Okonkwo" rendered as "J". Fonts are embedded lazily instead, so a
quotation carries Tinos only and an ROI carries Poppins only.

## Known defects and open items

1. **Inline reflow gap (ROI p1).** "Hi {{name}}," is inside a sentence. The
   name is drawn and its comma moves with it, but the rest of the sentence
   cannot reflow in a flat PDF, so a short name leaves a visible gap before
   "here is you personalised". Fix: redact and redraw the *whole* run rather
   than the token, using the run text the builder already decodes. Not yet done.
2. **Discount and adjustments** are folded into the Services Total, because the
   master has no row for either. The arithmetic a customer can check is always
   right, but a discount is not shown as a discount. **Owner decision needed.**
3. **MCS pages 19–21 are withheld** pending the agreed work: the presale has no
   compass azimuth at all (`slope.orientation` is panel portrait/landscape),
   no postcode zone, no MCS Kk lookup, no Shade Factor and no occupancy
   archetype. **The MCS Kk irradiance tables are licensed reference data that
   is not in this repository and will not be invented** — they have to be
   supplied before the section can be generated.
4. **`{{74}}` vs `{{53}}`** — the master labels the same quantity two ways.
   Both are bound to the row-18 monthly figure, which is the only
   self-consistent reading. Confirm.
5. **Panel warranty** now follows the catalogue, so an M Class quotation will
   say 40 years where the master said 30. Confirm that is intended.

## Not yet built

The persistence and surface layers are specified in Part 1 (§H, §I) and not
implemented: `job_documents` / `document_revisions` migration, generation
commands and worker, Job Detail "Customer documents" card, Files registration,
Operations-centre exposure, and Communications compose integration. The
renderer is a pure function of a stored snapshot, which is what those layers
need — nothing about them requires the rendering core to change.

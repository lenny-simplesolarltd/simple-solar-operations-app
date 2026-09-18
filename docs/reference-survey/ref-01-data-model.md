# Reference survey 01 — Data model, constants, roles

Source repo (read-only): `/Users/lennybeadle/:reference` — Google Sheets + AppSheet + Apps Script implementation of "Simple Solar Operations".
All paths below are relative to that repo unless absolute. Line numbers are as of the survey date (2026-09-18).

Conventions used in this report:
- "verbatim" = the literal string from the source file.
- "inferred" = my deduction; the source does not state it. Everything not marked inferred is cited.
- Classification: **BUSINESS ENTITY** (port to Postgres) / **PLATFORM PLUMBING** (exists only because of Sheets/AppSheet/Apps Script) / **UNCLEAR**.

## 0. Headline facts

| Fact | Evidence |
|---|---|
| Schema version `S02-1.0`, authority "01 Developer Build Specification §4, edition 2.0; RA01 v1.0" | `schema/tables.json:2-3` |
| **64 tables** in `tables.json` today. S02 closure validated **60**; PersonSkills, PersonAvailability, Teams, TeamMembers were added 12 Sep 2026 ("additive, provision missing tabs only") | `schema/tables.json:5`; `docs/S02-closure.md:7` |
| 114 declared foreign keys (all `→ <Table>.id`) | `schema/tables.json:5949-6634` |
| Global rules (verbatim): "Money is integer pence. IDs are immutable text, never row numbers. TEXT columns must be Format > Number > Plain text in Sheets. Columns ending _at are UTC timestamps. Columns ending _pence are integer pence. Nullable means unknown/not yet supplied, not zero or No." | `schema/tables.json:5` |
| Every column is either `required:true` or `nullable:true` (no column is unspecified — verified programmatically) | `schema/tables.json` |
| Column types used: `TEXT`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`, `TIMESTAMP` only. **There is no enum type** — every enum lives in a free-text `notes` string and is enforced (if at all) in module code | `schema/tables.json` |
| The schema file contains **no per-table release tag**. Release is explicit only on `Jobs.release_scope` (`tables.json` Jobs table) and `ReleaseModes.target_release`. Per-table release below is *inferred* from the function→release map in `schema/config-seed.json:103-122` and `docs/release-plan.md:17-20` | — |
| 14 extra AppSheet "request" helper tabs exist **outside** `tables.json` (`DEV*Requests`) — pure platform plumbing | `r1-appsheet/request-row.js:8-29` |
| `apps-script/**` is generated output (bundles of the root modules + embedded schema/seed); do not treat as a second source of truth | `schema/generate-embedded.js:2-5` |

### Release model (DEC-002 / RA01)
R1 Office operations → R2 Materials & scaffolding (incl. stores + Calendar adapter) → R3 Installer commissioning → R4 Finance & reporting (incl. archive). `docs/implementation-decisions.md:27-34`. R3/R4 may swap only with Ben's documented approval (`:34`). Commissioning content is provisional pending a "separate commissioning amendment" (`:40`).

---

## 1. Tables (all 64), generated directly from `schema/tables.json`

Standard trailing columns recur on most tables; I call them the **audit block**: `created_at, created_by, updated_at, updated_by, version, source_system, source_record_id, commit_id`. Only `People`, `Jobs`, `Customers` carry all eight; most mutable tables omit `source_record_id` (and some omit `source_system`); append-only tables carry only `created_at` + `commit_id`. See section 6.

### 1.1 People  — `schema/tables.json:8`

- **Purpose (verbatim):** User directory and role assignments
- **Primary key:** `id` TEXT — Immutable primary key
- **Classification:** **BUSINESS ENTITY** — Staff/partner directory. Port; link to Supabase auth.users by email. `calendar_id` is Google-Calendar-specific.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  | Immutable primary key |
| `email` | TEXT | required | yes |  | Normalised login; case-insensitive unique |
| `display_name` | TEXT | required |  |  |  |
| `role` | TEXT | required |  |  | Admin/Manager/Office/Finance/Store/Installer/Scaffolder/ReadOnly |
| `company_id` | TEXT | nullable |  | Companies.id | FK Companies; partner link |
| `active` | BOOLEAN | required |  |  |  |
| `calendar_id` | TEXT | nullable |  |  | Validated target calendar |
| `notification_email` | TEXT | nullable |  |  | Verified address |
| `capacity_per_day` | INTEGER | nullable |  |  | Advisory only |
| `available_from` | DATE | nullable |  |  |  |
| `available_to` | DATE | nullable |  |  |  |
| `backup_person_id` | TEXT | nullable |  | People.id | FK People |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  | Positive integer, optimistic locking |
| `source_system` | TEXT | required |  |  |  |
| `source_record_id` | TEXT | nullable |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.2 PersonRoles  — `schema/tables.json:125`

- **Purpose (verbatim):** Join table for multi-role people
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Real multi-role join; the R1 adapter authorises ONLY from active rows here (r1-appsheet/adapter.js:22-23).
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `person_id` | TEXT | required |  | People.id | FK People |
| `role` | TEXT | required |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.3 PersonSkills  — `schema/tables.json:188`

- **Purpose (verbatim):** Installer trade competence (resource planning); absence of rows means no skill constraint
- **Primary key:** `id` TEXT — SK-<person_id>-<skill>
- **Classification:** **BUSINESS ENTITY** — Installer trade competence used by readiness ranking (resource/planning.js:98-113, 215-219).
- **Release:** not stated (added 12 Sep 2026, resource planning)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  | SK-<person_id>-<skill> |
| `person_id` | TEXT | required |  | People.id | FK People |
| `skill` | TEXT | required |  |  | Roof/Electrical (WorkPackages.trade taxonomy) |
| `level` | TEXT | required |  |  | Lead/Member/Apprentice |
| `certified_until` | DATE | nullable |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.4 PersonAvailability  — `schema/tables.json:264`

- **Purpose (verbatim):** Leave and other unavailability periods (resource planning)
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Leave/unavailability periods; blocks allocation (resource/planning.js:220-221).
- **Release:** not stated (added 12 Sep 2026)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `person_id` | TEXT | required |  | People.id | FK People |
| `type` | TEXT | required |  |  | Leave/Sick/Training/Unavailable/Available |
| `from_date` | DATE | required |  |  |  |
| `to_date` | DATE | nullable |  |  | Inclusive; null = single day |
| `reason` | TEXT | nullable |  |  |  |
| `approved_by` | TEXT | nullable |  |  | FK People |
| `active` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.5 Teams  — `schema/tables.json:345`

- **Purpose (verbatim):** Flexible installer teams (no fixed crews invented)
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Flexible installer teams.
- **Release:** not stated (added 12 Sep 2026)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `name` | TEXT | required |  |  |  |
| `trade` | TEXT | required |  |  | Roof/Electrical/Mixed |
| `active` | BOOLEAN | required |  |  |  |
| `notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.6 TeamMembers  — `schema/tables.json:408`

- **Purpose (verbatim):** Team membership with role
- **Primary key:** `id` TEXT — TM-<team_id>-<person_id>
- **Classification:** **BUSINESS ENTITY** — Team membership; one active Lead per team enforced (resource/planning.js:178-181).
- **Release:** not stated (added 12 Sep 2026)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  | TM-<team_id>-<person_id> |
| `team_id` | TEXT | required |  | Teams.id | FK Teams |
| `person_id` | TEXT | required |  | People.id | FK People |
| `role` | TEXT | required |  |  | Lead/Member/Apprentice (confirmed 12 Sep 2026) |
| `from_date` | DATE | nullable |  |  |  |
| `to_date` | DATE | nullable |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.7 PermissionRules  — `schema/tables.json:484`

- **Purpose (verbatim):** Role-based access control rules
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Data-driven RBAC, but only S04 COMPLETE_TASK reads it (s04/processor.js:48-59); every later module hard-codes role lists. In Postgres this becomes RLS/policy code; port the *rules* not necessarily the table.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `role` | TEXT | required |  |  |  |
| `action` | TEXT | required |  |  |  |
| `entity` | TEXT | required |  |  |  |
| `scope` | TEXT | required |  |  | All/Assigned/OwnCompany/FinanceOnly |
| `allowed` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.8 Companies  — `schema/tables.json:557`

- **Purpose (verbatim):** Merchant, scaffolder, finance provider directory
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Merchants/scaffolders/finance providers.
- **Release:** R1 (seeded), used R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `name` | TEXT | required |  |  |  |
| `type` | TEXT | required |  |  | Merchant/Scaffolder/FinanceProvider/Other |
| `active` | BOOLEAN | required |  |  |  |
| `standard_lead_days` | INTEGER | nullable |  |  |  |
| `delivery_weekday` | INTEGER | nullable |  |  | 1=Mon...7=Sun |
| `notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.9 Contacts  — `schema/tables.json:636`

- **Purpose (verbatim):** People at partner companies
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Partner contacts.
- **Release:** R1 (seeded), used R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `company_id` | TEXT | required |  | Companies.id | FK Companies |
| `name` | TEXT | required |  |  |  |
| `email` | TEXT | nullable |  |  | TEXT — do not infer from name |
| `phone` | TEXT | nullable |  |  | TEXT — preserve leading zero |
| `contact_role` | TEXT | nullable |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `preferred_channel` | TEXT | nullable |  |  |  |
| `verified_at` | TIMESTAMP | nullable |  |  |  |
| `verified_by` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.10 Jobs  — `schema/tables.json:731`

- **Purpose (verbatim):** Core job record — one per installation project
- **Primary key:** `id` TEXT — Immutable primary key
- **Classification:** **BUSINESS ENTITY** — Core aggregate. `pilot_job`/`release_scope` are rollout plumbing columns (see section 2 notes).
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  | Immutable primary key |
| `job_id` | TEXT | required | yes |  | SS-XXXX-XXXX random reference; generated with collision retry. Use job_id for external display and id for internal FK references. |
| `customer_id` | TEXT | required |  | Customers.id | FK Customers |
| `display_name` | TEXT | required |  |  | Surname and postcode, optionally work label |
| `sold_submission_id` | TEXT | nullable |  | Intake.id | FK Intake |
| `booking_submission_id` | TEXT | nullable |  | Intake.id | FK Intake |
| `sold_at` | TIMESTAMP | nullable |  |  |  |
| `salesperson_id` | TEXT | nullable |  | People.id | FK People |
| `lead_source` | TEXT | nullable |  |  |  |
| `quote_reference` | TEXT | nullable |  |  | TEXT |
| `presale_file_id` | TEXT | nullable |  |  |  |
| `finance_route` | TEXT | required |  |  | Standard/Phoenix/OtherReview |
| `contract_status` | TEXT | required |  |  | NotSent/Sent/Signed/Cancelled |
| `contract_id` | TEXT | nullable |  |  |  |
| `contract_signed_at` | TIMESTAMP | nullable |  |  |  |
| `contract_evidence_id` | TEXT | nullable |  |  |  |
| `original_net_pence` | INTEGER | nullable |  |  |  |
| `original_vat_pence` | INTEGER | nullable |  |  |  |
| `original_gross_pence` | INTEGER | nullable |  |  |  |
| `approved_change_pence` | INTEGER | nullable |  |  |  |
| `current_contract_gross_pence` | INTEGER | nullable |  |  |  |
| `valuation_basis` | TEXT | nullable |  |  |  |
| `sold_booking_match_status` | TEXT | required |  |  | Pending/Match/Review/ApprovedDifference |
| `customer_details_verified_at` | TIMESTAMP | nullable |  |  |  |
| `customer_details_verified_by` | TEXT | nullable |  |  |  |
| `deposit_bank_confirmed_at` | TIMESTAMP | nullable |  |  |  |
| `deposit_bank_confirmed_by` | TEXT | nullable |  |  |  |
| `deposit_bank_reference` | TEXT | nullable |  |  | Redacted evidence reference, not bank credentials |
| `roof_required` | BOOLEAN | required |  |  |  |
| `electrical_required` | BOOLEAN | required |  |  |  |
| `scaffold_required` | BOOLEAN | required |  |  |  |
| `workflow_stage` | TEXT | required |  |  | Prebooking/ReadyToBook/BookingInProgress/Booked/AwaitingInstallation/InProgress/Aftercare/OperationallyComplete/CancellationInProgress/Cancelled |
| `booking_approved_at` | TIMESTAMP | nullable |  |  |  |
| `booking_approved_by` | TEXT | nullable |  |  |  |
| `operational_complete_at` | TIMESTAMP | nullable |  |  |  |
| `operational_complete_by` | TEXT | nullable |  |  |  |
| `customer_happy_at` | TIMESTAMP | nullable |  |  |  |
| `customer_happy_by` | TEXT | nullable |  |  |  |
| `handover_status` | TEXT | required |  |  | NotReady/Ready/Generating/Review/Approved/Sent |
| `financial_status` | TEXT | required |  |  | Derived from InvoiceStages |
| `cancellation_at` | TIMESTAMP | nullable |  |  |  |
| `cancellation_by` | TEXT | nullable |  |  |  |
| `cancellation_reason` | TEXT | nullable |  |  |  |
| `archived_at` | TIMESTAMP | nullable |  |  |  |
| `next_action_at` | TIMESTAMP | nullable |  |  | Derived from earliest pending task/event |
| `account_policy_version` | TEXT | nullable |  |  |  |
| `pilot_job` | BOOLEAN | required |  |  | RA01: pilot scope tracking |
| `release_scope` | TEXT | required |  |  | RA01: R1/R2/R3/R4 — which release enrolled this job |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `source_record_id` | TEXT | nullable |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.11 Customers  — `schema/tables.json:1037`

- **Purpose (verbatim):** Customer contact and address records
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Customer record.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `first_name` | TEXT | required |  |  |  |
| `last_name` | TEXT | required |  |  |  |
| `address_line1` | TEXT | required |  |  |  |
| `address_line2` | TEXT | nullable |  |  |  |
| `town` | TEXT | required |  |  |  |
| `postcode` | TEXT | required |  |  | TEXT — preserve formatting |
| `email` | TEXT | nullable |  |  |  |
| `phone` | TEXT | nullable |  |  | TEXT — preserve leading zero |
| `alternate_contact` | TEXT | nullable |  |  |  |
| `contact_notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `source_record_id` | TEXT | nullable |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.12 CustomerChanges  — `schema/tables.json:1141`

- **Purpose (verbatim):** Audit trail of customer detail changes from intake
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Proposed-vs-current customer field differences from Booking intake, with Accept/Keep/Correct resolution.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `field_name` | TEXT | required |  |  |  |
| `previous_value` | TEXT | nullable |  |  |  |
| `incoming_value` | TEXT | nullable |  |  |  |
| `source_submission_id` | TEXT | required |  |  |  |
| `resolution` | TEXT | required |  |  | Accept/Keep/Correct |
| `resolved_value` | TEXT | nullable |  |  |  |
| `resolved_at` | TIMESTAMP | nullable |  |  |  |
| `resolved_by` | TEXT | nullable |  |  |  |
| `reason` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.13 Intake  — `schema/tables.json:1215`

- **Purpose (verbatim):** Raw Jotform/Zapier submission records
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Raw Jotform/Zapier submission log + idempotency (form_id+submission_id). Business need = duplicate-intake protection and review queue; the Jotform envelope itself is integration plumbing. Keep a slimmer inbound-submission table if any external form remains.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `intake_id` | TEXT | required | yes |  |  |
| `form_type` | TEXT | required |  |  | Sold/Booking |
| `form_id` | TEXT | required |  |  | TEXT — Jotform form ID |
| `submission_id` | TEXT | required |  |  | TEXT — unique with form_id |
| `source_revision` | TEXT | nullable |  |  |  |
| `received_at` | TIMESTAMP | required |  |  |  |
| `raw_payload_json` | TEXT | nullable |  |  |  |
| `payload_hash` | TEXT | nullable |  |  |  |
| `job_id` | TEXT | nullable |  | Jobs.id | FK Jobs — set after processing |
| `processing_status` | TEXT | required |  |  | Pending/Processed/Review/Rejected |
| `validation_errors` | TEXT | nullable |  |  |  |
| `processed_at` | TIMESTAMP | nullable |  |  |  |
| `retry_count` | INTEGER | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.14 MappingRules  — `schema/tables.json:1308`

- **Purpose (verbatim):** Jotform question-to-field mapping configuration
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Jotform question-id → field mapping config. Only needed while Jotform is the producer; native Next.js forms make it redundant. The mapped *target fields* (s05/mapping.js:106-160) are business knowledge.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `form_id` | TEXT | required |  |  | TEXT |
| `question_id` | TEXT | required |  |  | TEXT |
| `source_label` | TEXT | required |  |  |  |
| `target_table` | TEXT | required |  |  |  |
| `target_field` | TEXT | required |  |  |  |
| `transform` | TEXT | nullable |  |  |  |
| `required_when` | TEXT | nullable |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `mapping_version` | TEXT | required |  |  |  |
| `effective_from` | DATE | required |  |  |  |
| `owner` | TEXT | required |  |  |  |
| `disposition` | TEXT | required |  |  | Import/Transform/RetainRaw/Retired/RequiresDecision |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.15 WorkPackages  — `schema/tables.json:1413`

- **Purpose (verbatim):** Per-trade work scheduling within a job
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Per-trade schedulable unit of a job.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `trade` | TEXT | required |  |  | Roof/Electrical/ReturnVisit/Other |
| `required` | BOOLEAN | required |  |  |  |
| `planned_start` | DATE | nullable |  |  |  |
| `planned_end` | DATE | nullable |  |  |  |
| `actual_start` | DATE | nullable |  |  |  |
| `actual_end` | DATE | nullable |  |  |  |
| `status` | TEXT | required |  |  | Unscheduled/Scheduled/InProgress/ReportedComplete/ConfirmedComplete/ReturnRequired/Cancelled |
| `need_by_date` | DATE | nullable |  |  |  |
| `completion_outcome` | TEXT | nullable |  |  |  |
| `installer_confirmation_at` | TIMESTAMP | nullable |  |  |  |
| `installer_confirmation_by` | TEXT | nullable |  |  |  |
| `commissioning_required` | BOOLEAN | required |  |  |  |
| `sequence` | INTEGER | required |  |  |  |
| `revision` | INTEGER | required |  |  |  |
| `parent_package_id` | TEXT | nullable |  | WorkPackages.id | FK WorkPackages — for return visits |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.16 Allocations  — `schema/tables.json:1544`

- **Purpose (verbatim):** Installer assignment to work packages
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Installer assignment to a work package; replaced rather than edited (replaced_allocation_id).
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `work_package_id` | TEXT | required |  | WorkPackages.id | FK WorkPackages |
| `person_id` | TEXT | required |  | People.id | FK People |
| `role` | TEXT | required |  |  | Lead/Second/Support |
| `start_at` | DATE | nullable |  |  |  |
| `end_at` | DATE | nullable |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `replaced_allocation_id` | TEXT | nullable |  | Allocations.id | FK Allocations |
| `cancellation_reason` | TEXT | nullable |  |  |  |
| `calendar_link_id` | TEXT | nullable |  | CalendarLinks.id | FK CalendarLinks |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.17 Tasks  — `schema/tables.json:1641`

- **Purpose (verbatim):** Work items generated from templates or manually
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Central work-item table.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | nullable |  | Jobs.id | FK Jobs; null for daily system tasks |
| `template_code` | TEXT | required |  |  | PRE01–SYS02 etc. |
| `instance_key` | TEXT | required | yes |  | template + entity + revision/episode; prevents duplicates |
| `group` | TEXT | required |  |  | Prebooking/Booking/Materials/Install/Aftercare/Finance/Cancellation/System |
| `title` | TEXT | required |  |  |  |
| `owner_id` | TEXT | required |  | People.id | FK People |
| `backup_id` | TEXT | nullable |  | People.id | FK People |
| `related_entity_type` | TEXT | nullable |  |  |  |
| `related_entity_id` | TEXT | nullable |  |  |  |
| `due_at` | TIMESTAMP | nullable |  |  |  |
| `original_due_at` | TIMESTAMP | nullable |  |  |  |
| `priority` | INTEGER | required |  |  |  |
| `status` | TEXT | required |  |  | Blocked/Open/InProgress/Waiting/Complete/Cancelled/NotRequired |
| `blocking_reason` | TEXT | nullable |  |  |  |
| `next_followup_at` | TIMESTAMP | nullable |  |  |  |
| `completed_at` | TIMESTAMP | nullable |  |  |  |
| `completed_by` | TEXT | nullable |  |  |  |
| `completion_note` | TEXT | nullable |  |  |  |
| `evidence_id` | TEXT | nullable |  |  |  |
| `revision_required` | BOOLEAN | required |  |  |  |
| `created_rule_version` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.18 TaskDependencies  — `schema/tables.json:1801`

- **Purpose (verbatim):** Prerequisite relationships between tasks
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Task prerequisites / named gates.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `task_id` | TEXT | required |  | Tasks.id | FK Tasks |
| `prerequisite_task_id` | TEXT | nullable |  | Tasks.id | FK Tasks; null for named gate |
| `named_gate` | TEXT | nullable |  |  |  |
| `satisfied_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.19 TaskEvents  — `schema/tables.json:1845`

- **Purpose (verbatim):** Immutable task history log
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Immutable task history.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `task_id` | TEXT | required |  | Tasks.id | FK Tasks |
| `action` | TEXT | required |  |  |  |
| `old_status` | TEXT | nullable |  |  |  |
| `new_status` | TEXT | nullable |  |  |  |
| `old_owner` | TEXT | nullable |  |  |  |
| `new_owner` | TEXT | nullable |  |  |  |
| `old_due` | TIMESTAMP | nullable |  |  |  |
| `new_due` | TIMESTAMP | nullable |  |  |  |
| `reason` | TEXT | nullable |  |  |  |
| `actor` | TEXT | required |  |  |  |
| `timestamp` | TIMESTAMP | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.20 Calls  — `schema/tables.json:1923`

- **Purpose (verbatim):** Phone call records linked to jobs/packages
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Call attempts/outcomes; carries customer_happy and strip_authorised facts.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `work_package_id` | TEXT | nullable |  | WorkPackages.id | FK WorkPackages |
| `task_id` | TEXT | nullable |  | Tasks.id | FK Tasks |
| `type` | TEXT | required |  |  | Installer/Customer/Payment/Supplier |
| `contact_id` | TEXT | nullable |  | Contacts.id | FK Contacts |
| `person_id` | TEXT | nullable |  | People.id | FK People |
| `attempted_at` | TIMESTAMP | required |  |  |  |
| `attempted_by` | TEXT | required |  |  |  |
| `outcome` | TEXT | required |  |  | NoAnswer/Complete/ReturnRequired/Unhappy/Confirmed/Other |
| `notes` | TEXT | nullable |  |  |  |
| `next_attempt_at` | TIMESTAMP | nullable |  |  |  |
| `actual_completion_confirmed` | BOOLEAN | required |  |  |  |
| `customer_happy` | BOOLEAN | nullable |  |  |  |
| `strip_authorised` | BOOLEAN | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.21 Issues  — `schema/tables.json:2022`

- **Purpose (verbatim):** Variations, remedials, complaints
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Variations/remedials/complaints.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `work_package_id` | TEXT | nullable |  | WorkPackages.id | FK WorkPackages |
| `type` | TEXT | required |  |  | Variation/Remedial/Complaint |
| `category` | TEXT | required |  |  |  |
| `description` | TEXT | required |  |  |  |
| `raised_at` | TIMESTAMP | required |  |  |  |
| `raised_by` | TEXT | required |  |  |  |
| `responsible_person_id` | TEXT | nullable |  | People.id | FK People |
| `responsible_company_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `office_owner_id` | TEXT | required |  | People.id | FK People — default Tanya |
| `severity` | TEXT | required |  |  |  |
| `status` | TEXT | required |  |  | Open/Acknowledged/InProgress/AwaitingCustomer/AwaitingSupplier/Resolved/Closed |
| `due_at` | TIMESTAMP | nullable |  |  |  |
| `next_followup_at` | TIMESTAMP | nullable |  |  |  |
| `blocks_completion` | BOOLEAN | required |  |  |  |
| `blocks_strip` | BOOLEAN | required |  |  |  |
| `estimated_value_pence` | INTEGER | nullable |  |  |  |
| `approved_value_pence` | INTEGER | nullable |  |  |  |
| `approval_status` | TEXT | required |  |  |  |
| `approved_at` | TIMESTAMP | nullable |  |  |  |
| `approved_by` | TEXT | nullable |  |  |  |
| `resolution` | TEXT | nullable |  |  |  |
| `resolved_at` | TIMESTAMP | nullable |  |  |  |
| `closed_at` | TIMESTAMP | nullable |  |  |  |
| `closed_by` | TEXT | nullable |  |  |  |
| `customer_resolution_confirmed` | BOOLEAN | nullable |  |  |  |
| `linked_return_package_id` | TEXT | nullable |  | WorkPackages.id | FK WorkPackages |
| `evidence_folder_id` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.22 IssueEvents  — `schema/tables.json:2217`

- **Purpose (verbatim):** Immutable issue history log
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Immutable issue history.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `issue_id` | TEXT | required |  | Issues.id | FK Issues |
| `event_type` | TEXT | required |  |  |  |
| `actor` | TEXT | required |  |  |  |
| `timestamp` | TIMESTAMP | required |  |  |  |
| `note` | TEXT | nullable |  |  |  |
| `previous_status` | TEXT | nullable |  |  |  |
| `new_status` | TEXT | nullable |  |  |  |
| `evidence_id` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.23 Products  — `schema/tables.json:2280`

- **Purpose (verbatim):** Product catalogue with SKUs and units
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Catalogue.
- **Release:** R2 (seeded in S02)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `sku` | TEXT | required | yes |  |  |
| `name` | TEXT | required |  |  |  |
| `category` | TEXT | required |  |  |  |
| `wattage` | INTEGER | nullable |  |  |  |
| `manufacturer` | TEXT | nullable |  |  |  |
| `model` | TEXT | nullable |  |  |  |
| `unit` | TEXT | required |  |  | Each/Metre/Roll/Length/Set |
| `unit_precision` | INTEGER | required |  |  |  |
| `stock_tracked` | BOOLEAN | required |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `default_supplier_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `standard_lead_days` | INTEGER | nullable |  |  |  |
| `unit_cost_pence` | INTEGER | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.24 Materials  — `schema/tables.json:2395`

- **Purpose (verbatim):** Material requirements per job/package
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Material requirement lines.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `work_package_id` | TEXT | required |  | WorkPackages.id | FK WorkPackages |
| `product_id` | TEXT | nullable |  | Products.id | FK Products; null for Other |
| `description` | TEXT | nullable |  |  | Required when product_id is null (Other) |
| `required_quantity` | DECIMAL | required |  |  |  |
| `unit` | TEXT | required |  |  |  |
| `source` | TEXT | required |  |  | ToOrder/AlreadyOrdered/Stock |
| `need_by_date` | DATE | required |  |  |  |
| `merchant_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `order_line_id` | TEXT | nullable |  | OrderLines.id | FK OrderLines |
| `already_ordered_reference` | TEXT | nullable |  |  |  |
| `notes` | TEXT | nullable |  |  |  |
| `revision` | INTEGER | required |  |  |  |
| `cancelled_quantity` | DECIMAL | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.25 Reservations  — `schema/tables.json:2519`

- **Purpose (verbatim):** Stock reservations for picking/issuing
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Stock reservations.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `material_id` | TEXT | required |  | Materials.id | FK Materials |
| `product_id` | TEXT | required |  | Products.id | FK Products |
| `location_id` | TEXT | required |  | StockLocations.id | FK StockLocations |
| `quantity` | DECIMAL | required |  |  |  |
| `status` | TEXT | required |  |  | Active/Released/Issued/Cancelled |
| `picked_quantity` | DECIMAL | required |  |  |  |
| `picked_at` | TIMESTAMP | nullable |  |  |  |
| `picked_by` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.26 Orders  — `schema/tables.json:2605`

- **Purpose (verbatim):** Merchant/supplier purchase orders
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Purchase orders with revision/confirmed_revision.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `merchant_id` | TEXT | required |  | Companies.id | FK Companies |
| `work_type` | TEXT | required |  |  | Roof/Electrical/Other |
| `requested_delivery_date` | DATE | required |  |  |  |
| `delivery_location_id` | TEXT | nullable |  | StockLocations.id | FK StockLocations |
| `delivery_address` | TEXT | nullable |  |  |  |
| `status` | TEXT | required |  |  | Draft/Review/Requested/Confirmed/PartReceived/Received/Cancelled |
| `revision` | INTEGER | required |  |  |  |
| `supplier_reference` | TEXT | nullable |  |  |  |
| `sent_message_id` | TEXT | nullable |  | Communications.id | FK Communications |
| `confirmed_revision` | INTEGER | nullable |  |  |  |
| `confirmed_at` | TIMESTAMP | nullable |  |  |  |
| `confirmed_by` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.27 OrderLines  — `schema/tables.json:2723`

- **Purpose (verbatim):** Line items within orders
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — PO lines.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `order_id` | TEXT | required |  | Orders.id | FK Orders |
| `material_id` | TEXT | nullable |  | Materials.id | FK Materials |
| `product_id` | TEXT | nullable |  | Products.id | FK Products |
| `description_snapshot` | TEXT | required |  |  |  |
| `quantity` | DECIMAL | required |  |  |  |
| `unit` | TEXT | required |  |  |  |
| `unit_net_cost_pence` | INTEGER | nullable |  |  |  |
| `vat_code` | TEXT | nullable |  |  |  |
| `cancelled_quantity` | DECIMAL | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.28 Deliveries  — `schema/tables.json:2793`

- **Purpose (verbatim):** Physical delivery receipts against orders
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Expected/actual deliveries.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `order_id` | TEXT | required |  | Orders.id | FK Orders |
| `expected_date` | DATE | required |  |  |  |
| `actual_received_at` | TIMESTAMP | nullable |  |  |  |
| `received_by` | TEXT | nullable |  |  |  |
| `delivery_note_reference` | TEXT | nullable |  |  |  |
| `receipt_status` | TEXT | required |  |  |  |
| `discrepancy_note` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.29 ReceiptLines  — `schema/tables.json:2851`

- **Purpose (verbatim):** Line-level delivery receipt detail
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Good/damaged receipt quantities.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `delivery_id` | TEXT | required |  | Deliveries.id | FK Deliveries |
| `order_line_id` | TEXT | required |  | OrderLines.id | FK OrderLines |
| `quantity_good` | DECIMAL | required |  |  |  |
| `quantity_damaged` | DECIMAL | required |  |  |  |
| `evidence_id` | TEXT | nullable |  |  |  |
| `stock_movement_ids` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.30 StockLocations  — `schema/tables.json:2905`

- **Purpose (verbatim):** Physical stock storage locations
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Ledger locations incl. virtual ones (External/Installed/Disposed).
- **Release:** R2 (seeded in S02)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `name` | TEXT | required |  |  |  |
| `type` | TEXT | required |  |  | Store/JobSite/Installed/Quarantine/Supplier/Disposed |
| `job_id` | TEXT | nullable |  | Jobs.id | FK Jobs |
| `usable` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.31 StockMovements  — `schema/tables.json:2969`

- **Purpose (verbatim):** Immutable stock movement ledger
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Immutable double-entry-style stock ledger with idempotency_key.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `product_id` | TEXT | required |  | Products.id | FK Products |
| `quantity` | DECIMAL | required |  |  | Positive |
| `from_location_id` | TEXT | required |  | StockLocations.id | FK StockLocations |
| `to_location_id` | TEXT | required |  | StockLocations.id | FK StockLocations |
| `movement_type` | TEXT | required |  |  | Opening/Receipt/Issue/Install/Return/Damage/SupplierReturn/Disposal/Adjustment |
| `job_id` | TEXT | nullable |  | Jobs.id | FK Jobs |
| `receipt_line_id` | TEXT | nullable |  | ReceiptLines.id | FK ReceiptLines |
| `reason` | TEXT | nullable |  |  |  |
| `evidence_id` | TEXT | nullable |  |  |  |
| `approval_id` | TEXT | nullable |  |  |  |
| `movement_at` | TIMESTAMP | required |  |  |  |
| `idempotency_key` | TEXT | required | yes |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.32 Stocktakes  — `schema/tables.json:3059`

- **Purpose (verbatim):** Physical stock count sessions
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Count sessions. `cut_off_commit_id` ties to the CommitJournal concept → replace with a cut-off timestamp/movement id.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `location_id` | TEXT | required |  | StockLocations.id | FK StockLocations |
| `counted_at` | TIMESTAMP | required |  |  |  |
| `cut_off_commit_id` | TEXT | required |  |  |  |
| `status` | TEXT | required |  |  | Draft/Review/Approved |
| `counted_by` | TEXT | required |  |  |  |
| `approved_by` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.33 StocktakeLines  — `schema/tables.json:3113`

- **Purpose (verbatim):** Per-product stocktake counts
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Count lines.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `stocktake_id` | TEXT | required |  | Stocktakes.id | FK Stocktakes |
| `product_id` | TEXT | required |  | Products.id | FK Products |
| `expected_quantity_at_cutoff` | DECIMAL | required |  |  |  |
| `counted_quantity` | DECIMAL | required |  |  |  |
| `variance` | DECIMAL | required |  |  |  |
| `reason` | TEXT | nullable |  |  |  |
| `adjustment_movement_id` | TEXT | nullable |  | StockMovements.id | FK StockMovements |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.34 PanelUse  — `schema/tables.json:3173`

- **Purpose (verbatim):** Per-job panel installation counts
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Per-job panel reconciliation.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `roof_package_id` | TEXT | required |  | WorkPackages.id | FK WorkPackages |
| `product_id` | TEXT | required |  | Products.id | FK Products |
| `issued_quantity` | INTEGER | required |  |  | Derived from stock movements |
| `installed_quantity` | INTEGER | required |  |  |  |
| `unused_quantity` | INTEGER | required |  |  |  |
| `defective_quantity` | INTEGER | required |  |  |  |
| `broken_quantity` | INTEGER | required |  |  |  |
| `photos` | TEXT | nullable |  |  |  |
| `roofer_notes` | TEXT | nullable |  |  |  |
| `reported_by` | TEXT | required |  |  |  |
| `reported_at` | TIMESTAMP | required |  |  |  |
| `reviewed_by` | TEXT | nullable |  |  |  |
| `reviewed_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.35 ScaffoldBookings  — `schema/tables.json:3269`

- **Purpose (verbatim):** Scaffold erect/strip bookings per job
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Scaffold lifecycle.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `company_id` | TEXT | required |  | Companies.id | FK Companies |
| `erect_planned_at` | DATE | nullable |  |  |  |
| `erect_confirmed_at` | TIMESTAMP | nullable |  |  |  |
| `erect_actual_at` | DATE | nullable |  |  |  |
| `strip_forecast_at` | DATE | nullable |  |  |  |
| `strip_authorised_at` | TIMESTAMP | nullable |  |  |  |
| `strip_authorised_by` | TEXT | nullable |  |  |  |
| `strip_planned_at` | DATE | nullable |  |  |  |
| `strip_confirmed_at` | TIMESTAMP | nullable |  |  |  |
| `strip_actual_at` | DATE | nullable |  |  |  |
| `status` | TEXT | required |  |  |  |
| `revision` | INTEGER | required |  |  |  |
| `confirmed_revision` | INTEGER | nullable |  |  |  |
| `access_notes` | TEXT | nullable |  |  |  |
| `scope_file_id` | TEXT | nullable |  |  |  |
| `quoted_cost_pence` | INTEGER | nullable |  |  |  |
| `actual_cost_pence` | INTEGER | nullable |  |  |  |
| `invoice_reference` | TEXT | nullable |  |  |  |
| `related_issue_ids` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.36 Communications  — `schema/tables.json:3418`

- **Purpose (verbatim):** Outbound messages (email, calendar invites, lists)
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Outbound message records with snapshots/revisions.
- **Release:** R2 (R1 manual notices)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | nullable |  | Jobs.id | FK Jobs; null for grouped lists |
| `company_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `type` | TEXT | required |  |  |  |
| `subject` | TEXT | required |  |  |  |
| `body_snapshot` | TEXT | nullable |  |  |  |
| `attachment_ids` | TEXT | nullable |  |  |  |
| `recipients_snapshot` | TEXT | required |  |  |  |
| `covered_week_start` | DATE | nullable |  |  |  |
| `delivery_date` | DATE | nullable |  |  |  |
| `revision` | INTEGER | required |  |  |  |
| `status` | TEXT | required |  |  | Draft/Approved/Queued/Sent/Uncertain/Failed |
| `approved_at` | TIMESTAMP | nullable |  |  |  |
| `approved_by` | TEXT | nullable |  |  |  |
| `sent_at` | TIMESTAMP | nullable |  |  |  |
| `external_message_id` | TEXT | nullable |  |  |  |
| `outbox_id` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.37 CommunicationJobs  — `schema/tables.json:3543`

- **Purpose (verbatim):** Join: communications covering multiple jobs
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Join table.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `communication_id` | TEXT | required |  | Communications.id | FK Communications |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `order_id` | TEXT | nullable |  | Orders.id | FK Orders |
| `scaffold_booking_id` | TEXT | nullable |  | ScaffoldBookings.id | FK ScaffoldBookings |
| `entity_revision` | INTEGER | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.38 Acknowledgements  — `schema/tables.json:3594`

- **Purpose (verbatim):** Supplier/scaffolder confirmations to communications
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Supplier/scaffolder confirmation of a specific revision.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `communication_id` | TEXT | required |  | Communications.id | FK Communications |
| `company_id` | TEXT | required |  | Companies.id | FK Companies |
| `entity_id` | TEXT | required |  |  |  |
| `acknowledged_revision` | INTEGER | required |  |  |  |
| `response` | TEXT | required |  |  | Confirmed/ChangesNeeded/Unable |
| `response_text` | TEXT | nullable |  |  |  |
| `received_at` | TIMESTAMP | required |  |  |  |
| `recorded_by` | TEXT | required |  |  |  |
| `evidence_id` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.39 CommissioningTemplates  — `schema/tables.json:3664`

- **Purpose (verbatim):** Versioned per-trade commissioning form definitions
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Versioned form definitions (content awaits commissioning amendment, implementation-decisions.md:40).
- **Release:** R3

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `trade` | TEXT | required |  |  |  |
| `equipment_type` | TEXT | required |  |  |  |
| `template_version` | TEXT | required |  |  |  |
| `effective_from` | DATE | required |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `approved_by` | TEXT | nullable |  |  |  |
| `approved_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.40 CommissioningQuestions  — `schema/tables.json:3741`

- **Purpose (verbatim):** Questions within commissioning templates
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Form questions.
- **Release:** R3

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `template_id` | TEXT | required |  | CommissioningTemplates.id | FK CommissioningTemplates |
| `question_key` | TEXT | required |  |  |  |
| `label` | TEXT | required |  |  |  |
| `data_type` | TEXT | required |  |  |  |
| `required_when` | TEXT | nullable |  |  |  |
| `allowed_values` | TEXT | nullable |  |  |  |
| `photo_category` | TEXT | nullable |  |  |  |
| `review_rule` | TEXT | nullable |  |  |  |
| `help_text` | TEXT | nullable |  |  |  |
| `display_order` | INTEGER | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.41 CommissioningSubmissions  — `schema/tables.json:3834`

- **Purpose (verbatim):** Installer commissioning form submissions
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Submissions.
- **Release:** R3 (also written in R1 as office-recorded, source_system=R1A-office-manual)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `work_package_id` | TEXT | required |  | WorkPackages.id | FK WorkPackages |
| `allocation_id` | TEXT | nullable |  | Allocations.id | FK Allocations |
| `installer_id` | TEXT | nullable |  | People.id | FK People |
| `template_version` | TEXT | required |  |  |  |
| `status` | TEXT | required |  |  | Draft/Submitted/UnderReview/Returned/Accepted |
| `submitted_at` | TIMESTAMP | nullable |  |  |  |
| `reviewed_at` | TIMESTAMP | nullable |  |  |  |
| `reviewed_by` | TEXT | nullable |  |  |  |
| `review_notes` | TEXT | nullable |  |  |  |
| `supersedes_submission_id` | TEXT | nullable |  | CommissioningSubmissions.id | FK CommissioningSubmissions |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | nullable |  |  | Provenance: R1A-office-manual for office-recorded R1 acceptance; service tag for R3 writers |
| `commit_id` | TEXT | required |  |  |  |

### 1.42 CommissioningAnswers  — `schema/tables.json:3938`

- **Purpose (verbatim):** Individual answers within submissions
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Answers (typed value columns).
- **Release:** R3

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `submission_id` | TEXT | required |  | CommissioningSubmissions.id | FK CommissioningSubmissions |
| `question_key` | TEXT | required |  |  |  |
| `value_text` | TEXT | nullable |  |  |  |
| `value_number` | DECIMAL | nullable |  |  |  |
| `value_date` | DATE | nullable |  |  |  |
| `value_boolean` | BOOLEAN | nullable |  |  |  |
| `not_applicable_reason` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.43 Evidence  — `schema/tables.json:3996`

- **Purpose (verbatim):** File/document references linked to jobs/submissions/issues
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — File references. `drive_file_id` is Google-Drive-specific → Supabase Storage path.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `submission_id` | TEXT | nullable |  | CommissioningSubmissions.id | FK CommissioningSubmissions |
| `issue_id` | TEXT | nullable |  | Issues.id | FK Issues |
| `category` | TEXT | required |  |  |  |
| `drive_file_id` | TEXT | required |  |  |  |
| `filename` | TEXT | required |  |  |  |
| `mime_type` | TEXT | nullable |  |  |  |
| `upload_status` | TEXT | required |  |  |  |
| `captured_at` | TIMESTAMP | nullable |  |  |  |
| `captured_by` | TEXT | nullable |  |  |  |
| `received_at` | TIMESTAMP | nullable |  |  |  |
| `customer_shareable` | BOOLEAN | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `checksum` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.44 FinancePlans  — `schema/tables.json:4091`

- **Purpose (verbatim):** Per-job finance configuration and stage tracking
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Per-job payment plan 25/35/40.
- **Release:** R4

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `route` | TEXT | required |  |  | Standard/Phoenix |
| `agreed_gross_pence` | INTEGER | required |  |  |  |
| `currency` | TEXT | required |  |  |  |
| `policy_version` | TEXT | required |  |  |  |
| `vat_basis` | TEXT | required |  |  |  |
| `deposit_pct` | INTEGER | required |  |  | 25 |
| `interim_pct` | INTEGER | required |  |  | 35 |
| `balance_pct` | INTEGER | required |  |  | 40 |
| `first_installation_date` | DATE | nullable |  |  |  |
| `interim_due_date` | DATE | nullable |  |  |  |
| `operational_earned_date` | DATE | nullable |  |  |  |
| `accounting_recognition_date` | DATE | nullable |  |  |  |
| `finance_agreement_status` | TEXT | required |  |  |  |
| `finance_provider_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.45 InvoiceStages  — `schema/tables.json:4219`

- **Purpose (verbatim):** Per-stage invoice tracking (deposit/interim/balance etc.)
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Invoice stage tracking.
- **Release:** R4 (deposit row already used by R1 gates PRE01/PRE03)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `stage` | TEXT | required |  |  | Deposit/Interim/Balance/Variation/Finance/RefundReview |
| `amount_net_pence` | INTEGER | required |  |  |  |
| `vat_pence` | INTEGER | required |  |  |  |
| `gross_pence` | INTEGER | required |  |  |  |
| `due_date` | DATE | nullable |  |  |  |
| `status` | TEXT | required |  |  | Planned/Draft/Authorised/Sent/PartPaid/Paid/Voided/Credited |
| `xero_invoice_id` | TEXT | nullable |  |  | TEXT |
| `invoice_number` | TEXT | nullable |  |  | TEXT |
| `xero_contact_id` | TEXT | nullable |  |  | TEXT |
| `reference` | TEXT | nullable |  |  | TEXT — includes Job ID |
| `request_id` | TEXT | nullable |  |  |  |
| `last_synced_at` | TIMESTAMP | nullable |  |  |  |
| `source_status` | TEXT | nullable |  |  |  |
| `sent_at` | TIMESTAMP | nullable |  |  |  |
| `cancelled_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `source_system` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.46 Payments  — `schema/tables.json:4353`

- **Purpose (verbatim):** Payment records reconciled against invoice stages
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Payments against stages.
- **Release:** R4

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `invoice_stage_id` | TEXT | required |  | InvoiceStages.id | FK InvoiceStages |
| `xero_payment_id` | TEXT | nullable |  |  | TEXT |
| `amount_pence` | INTEGER | required |  |  |  |
| `payment_date` | DATE | required |  |  |  |
| `status` | TEXT | required |  |  | Reported/Reconciled/Reversed |
| `reconciliation_evidence` | TEXT | nullable |  |  |  |
| `last_synced_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.47 ManualBankChecks  — `schema/tables.json:4413`

- **Purpose (verbatim):** Ben's independent bank deposit confirmations
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Director bank confirmation evidence.
- **Release:** R1 (FN-15 Manual)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `stage` | TEXT | required |  |  |  |
| `checked_at` | TIMESTAMP | required |  |  |  |
| `checked_by` | TEXT | required |  |  |  |
| `amount_pence` | INTEGER | required |  |  |  |
| `outcome` | TEXT | required |  |  |  |
| `evidence_reference` | TEXT | nullable |  |  | Redacted — never bank credentials |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.48 AccountingEvents  — `schema/tables.json:4472`

- **Purpose (verbatim):** Proposed/posted accounting journal entries
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Proposed journals.
- **Release:** R4

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `policy_version` | TEXT | required |  |  |  |
| `event_type` | TEXT | required |  |  |  |
| `effective_date` | DATE | required |  |  |  |
| `net_amount_pence` | INTEGER | required |  |  |  |
| `debit_account` | TEXT | required |  |  | NOT_CONFIGURED until supplied by accountant |
| `credit_account` | TEXT | required |  |  | NOT_CONFIGURED until supplied by accountant |
| `xero_journal_id` | TEXT | nullable |  |  | TEXT |
| `status` | TEXT | required |  |  | Proposed/Reviewed/Posted/Reversed |
| `reviewed_by` | TEXT | nullable |  |  |  |
| `reviewed_at` | TIMESTAMP | nullable |  |  |  |
| `source_invoice_ids` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.49 JobCosts  — `schema/tables.json:4579`

- **Purpose (verbatim):** Job-level cost tracking
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Job costing.
- **Release:** R4

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `category` | TEXT | required |  |  |  |
| `supplier_id` | TEXT | nullable |  | Companies.id | FK Companies |
| `source_document_id` | TEXT | nullable |  |  |  |
| `amount_net_pence` | INTEGER | required |  |  |  |
| `vat_pence` | INTEGER | required |  |  |  |
| `status` | TEXT | required |  |  | Estimated/Committed/Actual/Accrued |
| `accounting_date` | DATE | nullable |  |  |  |
| `policy_version` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.50 GHLTasks  — `schema/tables.json:4669`

- **Purpose (verbatim):** GoHighLevel CRM task tracking
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Human GoHighLevel progression task detail.
- **Release:** R1 (FN-11 Manual in every release)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `task_id` | TEXT | required |  | Tasks.id | FK Tasks |
| `opportunity_id` | TEXT | nullable |  |  | NOT_CONFIGURED |
| `target_pipeline_id` | TEXT | nullable |  |  | NOT_CONFIGURED |
| `target_stage_id` | TEXT | nullable |  |  | NOT_CONFIGURED |
| `template_id` | TEXT | nullable |  |  | NOT_CONFIGURED |
| `readiness_snapshot` | TEXT | nullable |  |  |  |
| `completed_at` | TIMESTAMP | nullable |  |  |  |
| `completed_by` | TEXT | nullable |  |  |  |
| `evidence_reference` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.51 Handover  — `schema/tables.json:4747`

- **Purpose (verbatim):** Customer handover pack tracking
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Handover pack tracking.
- **Release:** R3

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `checklist_version` | TEXT | required |  |  |  |
| `required_document_types` | TEXT | required |  |  |  |
| `completeness_status` | TEXT | required |  |  |  |
| `generated_file_id` | TEXT | nullable |  |  |  |
| `generated_version` | INTEGER | nullable |  |  |  |
| `reviewed_at` | TIMESTAMP | nullable |  |  |  |
| `reviewed_by` | TEXT | nullable |  |  |  |
| `approved_at` | TIMESTAMP | nullable |  |  |  |
| `approved_by` | TEXT | nullable |  |  |  |
| `sent_at` | TIMESTAMP | nullable |  |  |  |
| `communication_id` | TEXT | nullable |  | Communications.id | FK Communications |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.52 CalendarLinks  — `schema/tables.json:4851`

- **Purpose (verbatim):** Google Calendar event tracking per allocation/scaffold
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Google Calendar sync state per allocation/scaffold. Business only if Calendar sync is retained; `producer=LegacyJotform` and outbox_id are migration/integration plumbing.
- **Release:** R2

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `allocation_id` | TEXT | nullable |  | Allocations.id | FK Allocations |
| `scaffold_activity_id` | TEXT | nullable |  | ScaffoldBookings.id | FK ScaffoldBookings |
| `calendar_id` | TEXT | required |  |  |  |
| `external_event_id` | TEXT | nullable |  |  | TEXT |
| `event_uid` | TEXT | nullable |  |  |  |
| `producer` | TEXT | required |  |  | LegacyJotform/NewSystem |
| `entity_revision` | INTEGER | required |  |  |  |
| `last_synced_revision` | INTEGER | required |  |  |  |
| `status` | TEXT | required |  |  | Pending/Active/UpdatePending/Cancelled/Error |
| `start_at` | TIMESTAMP | nullable |  |  |  |
| `end_at` | TIMESTAMP | nullable |  |  |  |
| `all_day` | BOOLEAN | required |  |  |  |
| `guest_person_ids` | TEXT | nullable |  |  |  |
| `description_snapshot` | TEXT | nullable |  |  |  |
| `last_attempt_at` | TIMESTAMP | nullable |  |  |  |
| `last_success_at` | TIMESTAMP | nullable |  |  |  |
| `error` | TEXT | nullable |  |  |  |
| `outbox_id` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.53 TechnicalDetails  — `schema/tables.json:4994`

- **Purpose (verbatim):** Per-job technical specifications
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — 1:1 job technical spec. *_file_id are Drive ids.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `system_kw` | DECIMAL | nullable |  |  |  |
| `battery_kwh` | DECIMAL | nullable |  |  |  |
| `annual_generation_kwh` | DECIMAL | nullable |  |  |  |
| `annual_consumption_kwh` | DECIMAL | nullable |  |  |  |
| `mpan` | TEXT | nullable |  |  | TEXT — preserve formatting |
| `fuse_rating_amps` | INTEGER | nullable |  |  |  |
| `roof_type` | TEXT | nullable |  |  |  |
| `mounting_orientation` | TEXT | nullable |  |  |  |
| `survey_file_id` | TEXT | nullable |  |  |  |
| `roof_design_file_id` | TEXT | nullable |  |  |  |
| `schematic_file_id` | TEXT | nullable |  |  |  |
| `shutdown_file_id` | TEXT | nullable |  |  |  |
| `g99_status` | TEXT | nullable |  |  |  |
| `g99_reference` | TEXT | nullable |  |  | TEXT |
| `technical_review_at` | TIMESTAMP | nullable |  |  |  |
| `technical_review_by` | TEXT | nullable |  |  |  |
| `roof_notes` | TEXT | nullable |  |  |  |
| `electrical_notes` | TEXT | nullable |  |  |  |
| `ordering_notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.54 JobEquipment  — `schema/tables.json:5139`

- **Purpose (verbatim):** Installed equipment per job/package
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Planned/installed equipment.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `work_package_id` | TEXT | required |  | WorkPackages.id | FK WorkPackages |
| `equipment_type` | TEXT | required |  |  |  |
| `planned_product_id` | TEXT | nullable |  | Products.id | FK Products |
| `installed_product_id` | TEXT | nullable |  | Products.id | FK Products |
| `quantity` | INTEGER | required |  |  |  |
| `planned_location` | TEXT | nullable |  |  |  |
| `installed_location` | TEXT | nullable |  |  |  |
| `serial_number` | TEXT | nullable |  |  |  |
| `commissioning_submission_id` | TEXT | nullable |  | CommissioningSubmissions.id | FK CommissioningSubmissions |
| `variation_id` | TEXT | nullable |  | Issues.id | FK Issues |
| `technical_review_status` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.55 AuditEvents  — `schema/tables.json:5247`

- **Purpose (verbatim):** Immutable audit log
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Immutable audit log (before/after JSON). Port as jsonb; could be trigger-driven.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `entity_type` | TEXT | required |  |  |  |
| `entity_id` | TEXT | required |  |  |  |
| `action` | TEXT | required |  |  |  |
| `before_json` | TEXT | nullable |  |  |  |
| `after_json` | TEXT | nullable |  |  |  |
| `initiating_actor` | TEXT | required |  |  |  |
| `executing_service` | TEXT | required |  |  |  |
| `timestamp` | TIMESTAMP | required |  |  |  |
| `correlation_id` | TEXT | nullable |  |  |  |
| `reason` | TEXT | nullable |  |  |  |
| `commit_id` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |

### 1.56 CommitJournal  — `schema/tables.json:5319`

- **Purpose (verbatim):** Write-ahead commit journal for recovery
- **Primary key:** `id` TEXT
- **Classification:** **PLATFORM PLUMBING** — Write-ahead journal that exists because Sheets has no multi-row transactions (s04/processor.js:119-184). Postgres transactions replace it. KEEP only the idempotency idea: unique command_id → stored result.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `commit_id` | TEXT | required | yes |  |  |
| `state` | TEXT | required |  |  | Prepared/Applying/Committed/RecoveryRequired |
| `command_id` | TEXT | required |  |  |  |
| `entity_type` | TEXT | required |  |  |  |
| `entity_id` | TEXT | required |  |  |  |
| `expected_version` | INTEGER | nullable |  |  |  |
| `changes_json` | TEXT | required |  |  |  |
| `prepared_at` | TIMESTAMP | required |  |  |  |
| `committed_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |

### 1.57 Outbox  — `schema/tables.json:5383`

- **Purpose (verbatim):** Outbound message queue with retry tracking
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Transactional-outbox for external side-effects (Calendar, Xero via Zapier). Not AppSheet-specific; needed only if the new app still calls external systems asynchronously.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `idempotency_key` | TEXT | required | yes |  |  |
| `action_type` | TEXT | required |  |  |  |
| `target` | TEXT | required |  |  |  |
| `payload_hash` | TEXT | required |  |  |  |
| `job_revision` | INTEGER | nullable |  |  |  |
| `attempt_count` | INTEGER | required |  |  |  |
| `next_attempt` | TIMESTAMP | nullable |  |  |  |
| `external_id` | TEXT | nullable |  |  |  |
| `response_summary` | TEXT | nullable |  |  |  |
| `correlation_id` | TEXT | nullable |  |  |  |
| `status` | TEXT | required |  |  | Pending/Processing/Succeeded/RetryDue/NeedsReview/Cancelled |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.58 HealthChecks  — `schema/tables.json:5462`

- **Purpose (verbatim):** Integration health monitoring results
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Integration health results + follow-up task. Operational monitoring; business requirement SYS01 references it, but implementation is infra.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `integration` | TEXT | required |  |  |  |
| `checked_at` | TIMESTAMP | required |  |  |  |
| `outcome` | TEXT | required |  |  |  |
| `last_success` | TIMESTAMP | nullable |  |  |  |
| `error_code` | TEXT | nullable |  |  |  |
| `next_action_task_id` | TEXT | nullable |  | Tasks.id | FK Tasks |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.59 ArchiveIndex  — `schema/tables.json:5515`

- **Purpose (verbatim):** Archive manifest for restored records
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Six-month archive/restore manifest. Driven by Sheets capacity AND stated as RA01 FN-13 obligation; in Postgres likely a simple archived_at flag.
- **Release:** R4

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `job_id` | TEXT | required |  | Jobs.id | FK Jobs |
| `archive_location` | TEXT | required |  |  |  |
| `archived_at` | TIMESTAMP | required |  |  |  |
| `record_counts` | TEXT | required |  |  |  |
| `checksum` | TEXT | required |  |  |  |
| `schema_version` | TEXT | required |  |  |  |
| `restored_at` | TIMESTAMP | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.60 ReportSnapshots  — `schema/tables.json:5573`

- **Purpose (verbatim):** Frozen periodic report data
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — Frozen finance reports = business; but report_type values actually written are BackupManifest/DataBackup/RestoreRehearsal (backup/service.js:85,159; s16/health.js:369) = plumbing.
- **Release:** R4 (also R1 backup)

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `period_start` | DATE | required |  |  |  |
| `period_end` | DATE | required |  |  |  |
| `as_of_at` | TIMESTAMP | required |  |  |  |
| `policy_version` | TEXT | required |  |  |  |
| `report_type` | TEXT | required |  |  |  |
| `totals_json` | TEXT | required |  |  |  |
| `underlying_job_ids` | TEXT | required |  |  |  |
| `file_id` | TEXT | nullable |  |  |  |
| `generated_by` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.61 Settings  — `schema/tables.json:5640`

- **Purpose (verbatim):** Versioned system configuration values
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Versioned key/value business config (timezone, staffed days, percentages).
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `key` | TEXT | required |  |  |  |
| `typed_value` | TEXT | required |  |  |  |
| `scope` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `effective_from` | DATE | required |  |  |  |
| `changed_by` | TEXT | required |  |  |  |
| `reason` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.62 Holidays  — `schema/tables.json:5697`

- **Purpose (verbatim):** Office closure calendar
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Office closure dates used by staffed-day maths.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `local_date` | DATE | required | yes |  |  |
| `description` | TEXT | required |  |  |  |
| `office_closed` | BOOLEAN | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.63 TaskTemplates  — `schema/tables.json:5740`

- **Purpose (verbatim):** Versioned task generation templates
- **Primary key:** `id` TEXT
- **Classification:** **BUSINESS ENTITY** — Task catalogue.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `template_code` | TEXT | required | yes |  | PRE01–SYS02 etc. |
| `title` | TEXT | required |  |  |  |
| `group` | TEXT | required |  |  |  |
| `default_owner_role` | TEXT | required |  |  |  |
| `trigger_event` | TEXT | required |  |  |  |
| `due_rule` | TEXT | required |  |  |  |
| `evidence_required` | TEXT | required |  |  |  |
| `active` | BOOLEAN | required |  |  |  |
| `template_version` | TEXT | required |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

### 1.64 ReleaseModes  — `schema/tables.json:5829`

- **Purpose (verbatim):** RA01 per-function release mode tracking
- **Primary key:** `id` TEXT
- **Classification:** **UNCLEAR** — RA01 phased-rollout switchboard (Disabled/Manual/Automated per function + pilot scope). Exists to coexist with legacy producers; the Manual-vs-Automated distinction for GHL/bank/Phoenix is real business policy, the pilot-scope gating is migration plumbing.
- **Release:** R1

| Column | Type | Req/Null | Unique | FK | Notes / enum (verbatim) |
|---|---|---|---|---|---|
| `id` | TEXT | required | PK |  |  |
| `function_id` | TEXT | required | yes |  | FN-01–FN-20 |
| `function_name` | TEXT | required |  |  |  |
| `mode` | TEXT | required |  |  | Disabled/Manual/Automated |
| `mode_record_basis` | TEXT | required |  |  |  |
| `authorised_job_scope` | TEXT | required |  |  | RA01: pilot/non-pilot boundary |
| `target_release` | TEXT | required |  |  | R1/R2/R3/R4 |
| `planned_target_mode` | TEXT | required |  |  |  |
| `current_system` | TEXT | required |  |  | RA01: existing route description |
| `fallback` | TEXT | required |  |  | RA01: manual fallback procedure |
| `external_ids_protected_reference` | TEXT | nullable |  |  |  |
| `activation_time` | TIMESTAMP | nullable |  |  |  |
| `approved_version` | TEXT | nullable |  |  |  |
| `ben_approval_reference` | TEXT | nullable |  |  | RA01: Ben's recorded approval per R?-S20 |
| `scope_boundary_notes` | TEXT | nullable |  |  |  |
| `created_at` | TIMESTAMP | required |  |  |  |
| `created_by` | TEXT | required |  |  |  |
| `updated_at` | TIMESTAMP | required |  |  |  |
| `updated_by` | TEXT | required |  |  |  |
| `version` | INTEGER | required |  |  |  |
| `commit_id` | TEXT | required |  |  |  |

---

## 2. Classification summary and plumbing that must NOT be ported

### 2.1 Table-level summary

| Class | Tables |
|---|---|
| **BUSINESS ENTITY (54)** | People, PersonRoles, PersonSkills, PersonAvailability, Teams, TeamMembers, Companies, Contacts, Jobs, Customers, CustomerChanges, WorkPackages, Allocations, Tasks, TaskDependencies, TaskEvents, Calls, Issues, IssueEvents, Products, Materials, Reservations, Orders, OrderLines, Deliveries, ReceiptLines, StockLocations, StockMovements, Stocktakes, StocktakeLines, PanelUse, ScaffoldBookings, Communications, CommunicationJobs, Acknowledgements, CommissioningTemplates, CommissioningQuestions, CommissioningSubmissions, CommissioningAnswers, Evidence, FinancePlans, InvoiceStages, Payments, ManualBankChecks, AccountingEvents, JobCosts, GHLTasks, Handover, TechnicalDetails, JobEquipment, AuditEvents, Settings, Holidays, TaskTemplates |
| **PLATFORM PLUMBING (1 in schema + 14 outside it)** | CommitJournal; plus the AppSheet helper tabs listed in 2.2 |
| **UNCLEAR (9)** | PermissionRules, Intake, MappingRules, CalendarLinks, Outbox, HealthChecks, ArchiveIndex, ReportSnapshots, ReleaseModes |

(54 + 1 + 9 = 64. Per-table reasoning is on each table in section 1.)

### 2.2 AppSheet request/command-queue tabs (outside `tables.json`) — PLATFORM PLUMBING

AppSheet cannot call the processor directly, so a form writes a row into a helper tab, a bot hands the row id to Apps Script, the script builds a canonical command and writes only `result_*` columns back (`r1-appsheet/request-row.js:1-4`). Command → tab map (`r1-appsheet/request-row.js:8-29`):

| Command type(s) | Helper tab |
|---|---|
| SOLD_INTAKE | `DEVNewJobSoldRequests` |
| BOOKING_INTAKE | `DEVBookingIntakeRequests` |
| DEPOSIT_CONFIRM (legacy) | `DEVDepositConfirmRequests` |
| CONFIRM_BOOKING | `DEVConfirmBookingRequests` |
| TASK_COMPLETE | `DEVTaskCompleteRequests` |
| TASK_REOPEN | `DEVTaskReopenRequests` |
| TASK_EVIDENCE_ATTACH | `DEVTaskEvidenceAttachRequests` |
| ISSUE_UPDATE | `DEVIssueUpdateRequests` |
| ISSUE_CREATE | `DEVCreateIssueRequests` |
| IW_START, IW_PROGRESS, IW_REPORT_COMPLETION, IW_REPORT_PROBLEM, IW_REPORT_VARIATION, IW_COMMISSIONING_DRAFT, IW_COMMISSIONING_SUBMIT, COMMISSIONING_REVIEW | `DEVInstallerCommandRequests` |
| GOODS_IN_RECEIVE | `DEVGoodsInRequests` (+ child `DEVGoodsInRequestLines`) |
| STOCK_QUARANTINE | `DEVStockCommandRequests` |
| COMMISSIONING_RECORD | `DEVCommissioningRecordRequests` |
| (upload retry) | `R1URetryUploadRequests` (`r1-appsheet/upload-retry.js`) |

Plumbing columns on those tabs: `id`, `command_id` (both `UNIQUEID()`), `submitted_by`/`requested_by` (= `USEREMAIL()` initial value), `submitted_at`/`requested_at` (`NOW()`), `status` initial `"Ready"`, and the shared result contract `result_status, result_message, result_code, result, result_at` (+ optional `result_job_id, result_job_id_human, result_version, result_workflow_stage, result_issue_id, result_stage_id`). Evidence: `docs/R1-office-appsheet-configuration.md:410`, `r1-appsheet/request-row.js:35-43`, `r1-appsheet/command-result.js:14-18`. Result vocabulary: `Succeeded | FollowUpRequired | ActionRequired | Failed | UploadPending` (`command-result.js:14`).

**What survives the port from these tabs:** the *payload field lists* (they are the real form contracts — e.g. DEPOSIT_CONFIRM needs `reference`(text), `deposit_bank_confirmed`(bool), `deposit_amount`(number), `deposit_received_date`(date): `request-row.js:53-58`; CONFIRM_BOOKING has no payload, just `job_id`+`expected_version`: `:60`), the `expected_version` snapshot, and the idempotent `command_id`. In Next.js these become server actions / RPCs; the tabs themselves vanish.

### 2.3 Column-level plumbing inside business tables

| Column(s) | Why it is plumbing | Port as |
|---|---|---|
| `commit_id` (every table) | Links the row to a CommitJournal write-ahead entry; seed writes `'S02-SEED-'+Date.now()` (`schema/provisioner.js:298`), modules write `'R1A-'+command_id`, `'S06-'+key`, etc. | Drop, or keep one nullable `last_command_id`/`request_id` for traceability |
| `source_system`, `source_record_id` | Provenance tags like `S05-intake`, `R1-AppSheet`, `S06-gates`, `*-fixture` (`s05/intake.js:63,110`). **But** AppSheet slices filter on `Jobs.source_system="R1-AppSheet"` to find pilot jobs (`docs/R1-office-appsheet-configuration.md:203`) and S04 requires `source_system='S04-synthetic'` (`s04/processor.js:70`) → rollout plumbing | Optional provenance text; never use for authorisation |
| `Jobs.pilot_job`, `Jobs.release_scope`, all of `ReleaseModes` | RA01 coexistence with legacy producers; every command refuses non-pilot jobs (`r1-appsheet/adapter.js:37`, `processor/modes.js:23-52`) | Feature flags, if at all |
| "TEXT must be plain-text format" list | Sheets auto-coercion protection (`schema/tables.json:6635-6661`; `provisioner.js:152-164`). The *business* rule hidden in it: these values are strings, never numbers — postcode, phone, Jotform ids, Xero ids, invoice numbers, MPAN, G99 ref, serial numbers, calendar event ids, GHL ids | `text` columns |
| Leading-apostrophe escaping of `=`/`'` strings | Formula-injection guard (`s04/sheet-store.js:60-61`) | n/a |
| `Evidence.drive_file_id`, `Jobs.presale_file_id`, `TechnicalDetails.*_file_id`, `ScaffoldBookings.scope_file_id`, `Handover.generated_file_id`, `ReportSnapshots.file_id`, `Issues.evidence_folder_id` | Google Drive file/folder ids | Supabase Storage object paths |
| `People.calendar_id`, `CalendarLinks.*` | Google Calendar ids/events | Keep only if Calendar sync stays |
| JSON / id-lists stuffed into TEXT: `Intake.raw_payload_json`, `AuditEvents.before_json/after_json`, `CommitJournal.changes_json` (capped at 45,000 chars because of the Sheets cell limit — `s04/processor.js:80`), `ReportSnapshots.totals_json/underlying_job_ids`, `ArchiveIndex.record_counts`, `CalendarLinks.guest_person_ids`, `Communications.attachment_ids/recipients_snapshot`, `ScaffoldBookings.related_issue_ids` (JSON array — `scaffold/workflow.js:579`), `ReceiptLines.stock_movement_ids`, `AccountingEvents.source_invoice_ids`, `Handover.required_document_types`, `PanelUse.photos`, `CommissioningQuestions.allowed_values` | No array/json type in Sheets | `jsonb`, arrays or proper join tables |
| Booleans stored as `'TRUE'/'FALSE'` strings; modules accept `true/'TRUE'/'true'/1` (`resource/planning.js:24`; `provisioner.js:276`) | Sheets | `boolean` |
| `_findSheetByName` enumeration workaround, `Sheet1`/`S01_Setup` placeholder | Apps Script quirk (`docs/S02-closure.md:25-27`; `tables.json:6728`) | n/a |
| DEV sheet-id guards (`1z7PNZtD…`) in every module | Environment pinning (`r1-appsheet/adapter.js:4,30-32`) | n/a |

Reserved-word warning for Postgres: columns named `group` (Tasks, TaskTemplates), `key` (Settings), `timestamp` (TaskEvents, IssueEvents, AuditEvents), `role`, `type`, `unit`, `action`, `state`, `mode`, `scope`, `source` exist and need quoting or renaming.

---

## 3. Enums / status vocabularies (exact literals)

### 3.1 Declared in `schema/tables.json` (notes strings, verbatim; line = the notes line)

| Table.column | Values | Line |
|---|---|---|
| People.role | `Admin` `Manager` `Office` `Finance` `Store` `Installer` `Scaffolder` `ReadOnly` | 34 |
| PersonSkills.skill | `Roof` `Electrical` ("WorkPackages.trade taxonomy") | 208 |
| PersonSkills.level | `Lead` `Member` `Apprentice` | 214 |
| PersonAvailability.type | `Leave` `Sick` `Training` `Unavailable` `Available` | 283 |
| Teams.trade | `Roof` `Electrical` `Mixed` | 363 |
| TeamMembers.role | `Lead` `Member` `Apprentice` ("confirmed 12 Sep 2026") | 434 |
| PermissionRules.scope | `All` `Assigned` `OwnCompany` `FinanceOnly` | 512 |
| Companies.type | `Merchant` `Scaffolder` `FinanceProvider` `Other` | 575 |
| Companies.delivery_weekday | integer `1=Mon…7=Sun` | Companies table |
| Jobs.finance_route | `Standard` `Phoenix` `OtherReview` | 803 |
| Jobs.contract_status | `NotSent` `Sent` `Signed` `Cancelled` | 809 |
| Jobs.sold_booking_match_status | `Pending` `Match` `Review` `ApprovedDifference` | 860 |
| Jobs.workflow_stage | `Prebooking` `ReadyToBook` `BookingInProgress` `Booked` `AwaitingInstallation` `InProgress` `Aftercare` `OperationallyComplete` `CancellationInProgress` `Cancelled` | 907 (mirrored in `processor/types.js:55-66`) |
| Jobs.handover_status | `NotReady` `Ready` `Generating` `Review` `Approved` `Sent` | 943 |
| Jobs.release_scope | `R1` `R2` `R3` `R4` | Jobs table |
| CustomerChanges.resolution | `Accept` `Keep` `Correct` | 1180 |
| Intake.form_type | `Sold` `Booking` | 1234 (enforced `s05/intake.js:26`) |
| Intake.processing_status | `Pending` `Processed` `Review` `Rejected` | 1278 |
| MappingRules.disposition | `Import` `Transform` `RetainRaw` `Retired` `RequiresDecision` | 1378 |
| WorkPackages.trade | `Roof` `Electrical` `ReturnVisit` `Other` | 1432 |
| WorkPackages.status | `Unscheduled` `Scheduled` `InProgress` `ReportedComplete` `ConfirmedComplete` `ReturnRequired` `Cancelled` | 1463 |
| Allocations.role | `Lead` `Second` `Support` | 1569 |
| Tasks.group | `Prebooking` `Booking` `Materials` `Install` `Aftercare` `Finance` `Cancellation` `System` | 1673 |
| Tasks.status | `Blocked` `Open` `InProgress` `Waiting` `Complete` `Cancelled` `NotRequired` | 1721 (mirrored `processor/types.js:45-53`) |
| Calls.type | `Installer` `Customer` `Payment` `Supplier` | 1954 |
| Calls.outcome | `NoAnswer` `Complete` `ReturnRequired` `Unhappy` `Confirmed` `Other` | 1982 |
| Issues.type | `Variation` `Remedial` `Complaint` | 2047 |
| Issues.status | `Open` `Acknowledged` `InProgress` `AwaitingCustomer` `AwaitingSupplier` `Resolved` `Closed` | 2096 |
| Products.unit | `Each` `Metre` `Roll` `Length` `Set` | 2324 |
| Materials.source | `ToOrder` `AlreadyOrdered` `Stock` | 2442 (`materials/workflow.js:15`) |
| Reservations.status | `Active` `Released` `Issued` `Cancelled` | 2555 |
| Orders.work_type | `Roof` `Electrical` `Other` | 2630 |
| Orders.status | `Draft` `Review` `Requested` `Confirmed` `PartReceived` `Received` `Cancelled` | 2652 (`materials/workflow.js:17`) |
| StockLocations.type | `Store` `JobSite` `Installed` `Quarantine` `Supplier` `Disposed` | 2923 |
| StockMovements.movement_type | `Opening` `Receipt` `Issue` `Install` `Return` `Damage` `SupplierReturn` `Disposal` `Adjustment` | 3006 (`stock/workflow.js:23`) |
| Stocktakes.status | `Draft` `Review` `Approved` | 3088 |
| Communications.status | `Draft` `Approved` `Queued` `Sent` `Uncertain` `Failed` | 3483 |
| Acknowledgements.response | `Confirmed` `ChangesNeeded` `Unable` | 3629 |
| CommissioningSubmissions.status | `Draft` `Submitted` `UnderReview` `Returned` `Accepted` | 3876 |
| FinancePlans.route | `Standard` `Phoenix` | 4110 |
| InvoiceStages.stage | `Deposit` `Interim` `Balance` `Variation` `Finance` `RefundReview` | 4238 |
| InvoiceStages.status | `Planned` `Draft` `Authorised` `Sent` `PartPaid` `Paid` `Voided` `Credited` | 4264 |
| Payments.status | `Reported` `Reconciled` `Reversed` | 4388 |
| AccountingEvents.status | `Proposed` `Reviewed` `Posted` `Reversed` | 4529 |
| JobCosts.status | `Estimated` `Committed` `Actual` `Accrued` | 4624 |
| CalendarLinks.producer | `LegacyJotform` `NewSystem` | 4898 |
| CalendarLinks.status | `Pending` `Active` `UpdatePending` `Cancelled` `Error` | 4914 |
| CommitJournal.state | `Prepared` `Applying` `Committed` `RecoveryRequired` | 5338 (`processor/types.js:29-34`) |
| Outbox.status | `Pending` `Processing` `Succeeded` `RetryDue` `NeedsReview` `Cancelled` | 5447 (`processor/types.js:36-43`) |
| ReleaseModes.mode / planned_target_mode | `Disabled` `Manual` `Automated` | 5854 (`processor/types.js:23-27`) |
| ReleaseModes.target_release | `R1` `R2` `R3` `R4` | ReleaseModes table |
| ReleaseModes.authorised_job_scope | not enumerated in schema; code recognises `None`, `Pilot`, `All` | `processor/modes.js:30-37` |

### 3.2 Defined ONLY in code (schema column has no enum note)

| Table.column | Values actually used | Evidence |
|---|---|---|
| ScaffoldBookings.status | `Requested` `Confirmed` `Erected` `StripAuthorised` `StripPlanned` `StripConfirmed` `Stripped` `Cancelled` | `scaffold/workflow.js:17` |
| Issues.severity | R1 create accepts only `Normal` or `Medium` (default `Normal`) | `r1-appsheet/services.js:654-655`; `s10/operations.js:109` |
| Issues.approval_status | `NotRequired` (default), `Pending` (Variations). No other value found | `s10/operations.js:109`; `installer/workflow.js:95,239` |
| Issues.category | installer problems: `Access` `Damage` `Technical` `Safety` `MaterialsShort` `Other`; scaffold complaints: `MissedAppointment` `Access` `Damage` `UnsafeConcern` `Other`; office: `CustomerCall`, `ReturnRequired`; materials: `Supply` | `installer/workflow.js:17`; `scaffold/workflow.js:18`; `s10/operations.js:98-99`; `materials/workflow.js:514` |
| IssueEvents.event_type | `Opened` `Reassigned` `Resolved` `Closed` | `s10/operations.js:110,118,127` |
| TaskEvents.action | S03 core: `CREATED` `COMPLETED` (upper-case, `processor/tasks.js:66,88`); later modules: `Complete` `Reopen` `Reassign` `FollowUp` `Cancel` `Supersede` `CallOutcome` `EvidenceAttach` (mixed casing across modules) | enum harvest of `insert('TaskEvents'…)` |
| Tasks.priority | integers `0`, `1`, `2` only; `1` dominant, BKG04/BKG05 use `2` | `s06/gates.js:568`; harvest |
| Tasks.related_entity_type | table names: `Jobs` `Orders` `Deliveries` `ScaffoldBookings` `Issues` `InvoiceStages` `CalendarLinks` `HealthChecks` | harvest (e.g. `materials/workflow.js:426`, `xero/adapter.js:141`) |
| Deliveries.receipt_status | `Expected`, `Cancelled` found; received states not located as literals in my search | `materials/workflow.js:383,447` |
| Evidence.upload_status | `Uploaded`, `Referenced` | `r1-appsheet/services.js:64`; `materials/workflow.js:483` |
| Evidence.category | installer: `Progress` `Completion` `Commissioning` `Problem` `Variation` `Return`; materials: `DeliveryNote`; R1 passes a caller-supplied category | `installer/workflow.js:18`; `materials/workflow.js:483`; `r1-appsheet/services.js:55-60` |
| WorkPackages.completion_outcome | `Complete`, `ReturnRequired` | `installer/workflow.js:16,186,196` |
| JobEquipment.technical_review_status | `Planned`, `MappingRequired`, `Pending` | `s05/booking-apply.js:365`; `s12/commissioning.js:97` |
| Handover.completeness_status | `Pending` (only value found) | `s12/commissioning.js:138` |
| ManualBankChecks.stage / outcome | stage `deposit` (lower-case); outcome `Confirmed` | `r1-appsheet/services.js:192,220` |
| Communications.type | `ScaffoldWeeklyList` (only literal found) | `scaffold/workflow.js:560` |
| Outbox.action_type | `CalendarCancel`, `XeroInvoice` (+ calendar create/update in `calendar/service.js`) | `s11/planner.js:42`; `s13/payments.js:88` |
| ReportSnapshots.report_type | `BackupManifest` `DataBackup` `RestoreRehearsal` | `s16/health.js:369`; `backup/service.js:85,159` |
| Jobs.financial_status | `Pending` on creation; `Complete` only in fixtures. Schema says "Derived from InvoiceStages" but no derivation vocabulary is defined | `s05/intake.js:103` |
| Jobs.valuation_basis | `Standard` in all non-fixture writers | harvest |
| FinancePlans.vat_basis / finance_agreement_status, TechnicalDetails.g99_status, AccountingEvents.event_type, JobCosts.category, Settings.scope (only `Global` seen), Contacts.preferred_channel / contact_role (`Sales` in seed) | **No vocabulary found in code** — free text today | — |

### 3.3 Non-table constant vocabularies

- `CommandType` (S03 generic): `COMPLETE_TASK RECORD_CALL RAISE_ISSUE MOVE_JOB CHANGE_INSTALLER CANCEL_JOB APPROVE_OPERATIONAL_COMPLETE CREATE_ORDER RECEIVE_DELIVERY STOCK_MOVEMENT SUBMIT_COMMISSIONING REVIEW_COMMISSIONING SEND_COMMUNICATION RECONCILE HEALTH_CHECK PROCESS_INTAKE` — `processor/types.js:4-21`.
- R1 bound commands (the ones really wired): `COMMISSIONING_RECORD TASK_COMPLETE TASK_REOPEN TASK_EVIDENCE_ATTACH CALL_RECORD ISSUE_UPDATE ISSUE_CREATE PLANNER_UPDATE MOVE_JOB CHANGE_INSTALLER CANCEL_JOB REINSTATE_JOB DEPOSIT_CONFIRM OPERATIONAL_COMPLETE BOOKING_GATES CONFIRM_BOOKING SOLD_INTAKE BOOKING_INTAKE IW_START IW_PROGRESS IW_REPORT_COMPLETION IW_REPORT_PROBLEM IW_REPORT_VARIATION IW_COMMISSIONING_DRAFT IW_COMMISSIONING_SUBMIT COMMISSIONING_REVIEW GOODS_IN_RECEIVE STOCK_QUARANTINE` — `r1-appsheet/adapter.js:6`.
- R1 reads: `r1-appsheet/adapter.js:5`; queues `booking calls issues payments ghl cancellation intake_review` — `:7`.
- `FailureCategory`: `Validation Permission Concurrency DisabledMode PilotScope Transient Authentication Uncertain Fatal` — `processor/types.js:79-89`.
- Task due classes: `OVERDUE DUE_TODAY DUE_TOMORROW NEXT_7_DAYS NORMAL_LATER NO_DUE` — `s05/priority.js:27`.
- Readiness reason codes: `INSTALLER_INACTIVE_OR_WRONG_ROLE CAPACITY_NOT_CONFIGURED INSTALLER_UNAVAILABLE SKILL_MISMATCH ON_LEAVE OFFICE_HOLIDAY CAPACITY_CONFLICT`; warnings `CERTIFICATION_EXPIRES_BEFORE_END APPRENTICE_NEEDS_SUPERVISION` — `resource/planning.js:210-229`.
- Placeholder sentinels: `NOT_CONFIGURED` (seed and code treat it as "no value", e.g. `s06/gates.js:24`), `NEED_APPROVAL` (product map), Jobs.job_id temporary `'PENDING'` (`s05/intake.js:76`).

### 3.4 Enum contradictions between schema and code (must be resolved before writing Postgres enums)

1. **InvoiceStages.stage** — schema: `Deposit/Interim/Balance/…` (`tables.json:4238`); S13 writes lower-case `deposit`/`interim`/**`final`** (`s13/payments.js:8,22-34`), ids `IS-<job>-<stage>`; S14 reads the lower-case values (`s14/reporting.js:38-40`); S06/R1 compare case-insensitively to `deposit` (`s06/gates.js:19,87,92`; `r1-appsheet/services.js:296`). "Balance" vs "final" is a genuine naming conflict.
2. **InvoiceStages.status** — schema list lacks `Pending` and `Confirmed`, but S13 creates rows with `Pending` (`s13/payments.js:38`) and the deposit confirmation path sets `Confirmed` (`r1-appsheet/services.js:199`; gate requires it `s06/gates.js:96`). R1 code treats `Confirmed Paid PartPaid Voided Credited` as terminal-ish and otherwise sets `Sent` (`services.js:333`).
3. **Tasks.group** — schema omits `Scaffold`, yet seed templates SCA02–SCA05 use `group:"Scaffold"` (`config-seed.json:76-79`; `scaffold/workflow.js:20-24`). SCA01 is filed under `Materials` (`config-seed.json:75`). S17 queue code also references groups `Calls`, `Commissioning`, `Handover`, `CRM` (`s17/admin.js:411-417`).
4. **Roles** — schema/`ActorRole` list 8 roles; code and seed also use `Director` and `VariationApprover`; the runbook staff list adds `Surveyor` (see section 4).
5. **Job reference format** — `schema/keys.js:4-20` generates `SS-[0-9A-Z]{4}-[0-9A-Z]{4}` (tested by `tests/schema.test.cjs:12`), but the live intake path generates and validates **`SS-[A-Z]{4}-\d{4}`** with letters excluding `I` and `O` (`s05/mapping.js:219-236`; validators `r1-appsheet/services.js:1219,1289`). `keys.js` is imported only by the schema test.
6. **Units** — schema `Each/Metre/…`; booking apply writes `ea` (`s05/booking-apply.js:309`) and the product map uses `ea`/`m` (`config/booking-product-map.example.json:5-32`).
7. **TaskEvents.action** casing differs by module (`CREATED/COMPLETED` vs `Complete/Reopen/…`).
8. **MOVE_JOB activity name** `Return` maps to trade `ReturnVisit` (`s11/planner.js:81-86`); resource planner uses activities `Roof|Electrical|Scaffold` (`resource/planning.js:288`).

---

## 4. Roles, People, PersonRoles, PersonSkills — exact semantics

### 4.1 Role codes

| Role code | Where defined | What it may do (as far as code/data says) |
|---|---|---|
| `Admin` | schema `:34`; `ActorRole` `processor/types.js:69`; seed Ben + Lenny (`config-seed.json:18,25,30,33`) | Everything. Wildcard rule `PERM-admin-all` action `*` entity `*` scope `All` (`config-seed.json:37`); bypasses assignment and task-owner checks (`r1-appsheet/adapter.js:26,39,66`). |
| `Manager` | schema; `ActorRole` | Treated as **identical to Admin** in the R1 adapter (`_r1aAdmin` = Admin OR Manager, `adapter.js:26`). Not in seed. Fixtures make "Ben" a Manager (`s16/fixture.js:151`); S16 looks up Ben by `role==='Manager'` + name contains "ben" (`s16/health.js:799`), resilience by Admin/Manager + "ben" (`resilience/review.js:35`). No PermissionRules row for Manager. |
| `Director` | **NOT in schema enum nor `ActorRole`**; seed Dan (`config-seed.json:19,31`), rule `PERM-director-assigned-tasks` CompleteTask/Tasks/`Assigned` (`:39`) | Superset of Office in R1 (`_r1aDirector` = Admin/Manager/Director, `adapter.js:27`). Only role class (with Admin/Manager) allowed `DEPOSIT_CONFIRM` (`adapter.js:188-190`). Eligible to own PRE03 "Confirm bank deposit" (`s06/gates.js:609-614`). Is **not** in `_r1aOfficeManager`, so a pure Director cannot `CONFIRM_BOOKING`, `OPERATIONAL_COMPLETE` or `COMMISSIONING_RECORD` (`adapter.js:29,191-198,209-210`). |
| `Office` | schema; seed Tanya, Hannah | All R1 office commands on jobs they are "assigned" to (see 4.4); `PERM-office-tasks` CompleteTask/Tasks/`All` (`config-seed.json:38`); config actor for skills/leave/teams (`resource/planning.js:19`); goods-in (`operations-contract.js:41`); commissioning review (`:53`); cancellation (`s15/cancellation.js:40`). Default owner of most task templates. S03 default matrix: `processor/actor.js:8-17`. |
| `VariationApprover` | **code only** (`adapter.js:28`; `installer/workflow.js:22`; `services.js:629`; `s10/operations.js:108`). Runbook: "Hannah Harvey — Office + VariationApprover" (`docs/AGENT_RUNBOOK.md:193`). **Not in schema, `ActorRole`, or seed PersonRoles** | Counts as an R1 office role (`adapter.js:28`); default owner of `ISS01 Review variation`; S10 requires **exactly one** active holder (`s10/operations.js:46-51`). |
| `Finance` | schema; rule `PERM-finance-reports` View/Reports/`FinanceOnly` (`config-seed.json:42`) | View reports only (`processor/actor.js:29-31`). No person seeded; no R1 command path admits it. |
| `Store` | schema; seed `PERSON-store` | `GOODS_IN_RECEIVE` (with Office/Manager/Admin) and `STOCK_QUARANTINE`/`STOCK_BALANCE` (Store/Manager/Admin — Office excluded) (`operations-contract.js:41,48`); default owner of MAT03/MAT04, falling back to Office if no Store person (`materials/workflow.js:108`). No PermissionRules row. |
| `Installer` | schema; seed Installer A/B | `IW_*` commands only on work packages where they hold an **active Allocation**; office roles may act instead but must give a `reason` (`operations-contract.js:53-59`; `installer/workflow.js:56-60`). Rule `PERM-installer-own` View/Jobs/`Assigned` (`config-seed.json:40`). Denied all R1 office commands (`adapter.js:173`). |
| `Scaffolder` | schema; seed Scaffolder (test) | `PERM-scaffolder-own` View/ScaffoldBookings/`OwnCompany` (`config-seed.json:41`) — `People.company_id` is the partner link (`tables.json` People). No command path implemented for it. |
| `ReadOnly` | schema; `ActorRole` | Defined, never referenced by any rule or module. |
| `Surveyor` | **docs only**: four named surveyors (`docs/AGENT_RUNBOOK.md:195-198`) | Not in schema, seed or any code. |

### 4.2 People (`tables.json:8`)
- `email` "Normalised login; case-insensitive unique" (`:23`). Actor resolution lower-cases and trims, requires **exactly one** match (`adapter.js:18-20`; `s04/processor.js:41-42`). AppSheet side: `People.email = USEREMAIL()` (`docs/R1-office-appsheet-configuration.md:17`).
- `role` = single **primary** role, required (`:34`). `active` boolean is the only soft-delete; inactive actor is refused (`adapter.js:21`).
- `company_id` nullable FK → Companies, "partner link" (Scaffolder scoping).
- `capacity_per_day` INTEGER nullable "Advisory only" — but the planner **blocks** when it is not an integer ≥ 1 (`CAPACITY_NOT_CONFIGURED`, `resource/planning.js:211-212`; `s11/planner.js:38`) and when used ≥ capacity (`CAPACITY_CONFLICT`, `:229`). Seed leaves it null for everyone.
- `available_from` / `available_to` DATE nullable = employment/availability window; outside it → `INSTALLER_UNAVAILABLE` (`resource/planning.js:213-214`).
- `backup_person_id` nullable self-FK — a person-level backup. **No code reads it** in the modules I searched; task backups are set explicitly per task (`Tasks.backup_id`), e.g. PRE03 owner `PERSON-ben`, backup `PERSON-dan` hard-coded (`s06/gates.js:609-614`).
- `notification_email` "Verified address"; `calendar_id` "Validated target calendar".

### 4.3 PersonRoles (`tables.json:125`)
- Columns: `id, person_id (FK People), role, active` + audit. **No date range, no primary flag, no scope.** Seed id pattern `PROLE-<name>-<role>`.
- Semantics differ by module — this is a real inconsistency:
  - R1 adapter and S04: roles come **only** from active PersonRoles rows; `People.role` is ignored; zero rows → `R1A_NO_ACTIVE_ROLE` / `NO_ACTIVE_ROLE` (`adapter.js:22-23`; `s04/processor.js:44-45`).
  - S03 core: `People.role` + optional `additionalRoles` (`processor/actor.js:40-42`).
  - Resource planning, installer workflow, S15, S06 `personHasActiveRole`: **union** of `People.role` and active PersonRoles (`resource/planning.js:58`; `installer/workflow.js:51`; `s15/cancellation.js:40`; `s06/gates.js:597-602`).
  - "Is an installer?" checks use `People.role === 'Installer'` only (`resource/planning.js:64,210`; `s11/planner.js:38`; `s05/booking-apply.js:67`); materials owner lookup uses `People.role` only (`materials/workflow.js:105`).
  - Seed gives PersonRoles rows to Tanya, Ben, Dan, Hannah, Lenny only — Store/Installer/Scaffolder people have **none** (`config-seed.json:28-34`), so under the R1 adapter rule they cannot authenticate.
- Role → person resolution for task ownership: first active PersonRoles row in sheet order (`s06/gates.js:586-590`, acknowledged as nondeterministic in the comment at `:604-608`), with name fallbacks `'PERSON-tanya'` / `'PERSON-ben'` (`:640-641`); S10 prefers `PERSON-tanya` for Office else requires exactly one (`s10/operations.js:46-51`).

### 4.4 "Assigned" scope (row-level access rule to port as RLS)
Non-admin office users may open/act on a job only if they own or back up a task on it, are responsible person/office owner of an issue on it, or are its salesperson (`adapter.js:38-43`). Task commands additionally require owner or backup or Admin/Manager (`adapter.js:177-178`). TEAM_TASKS redacts customer name/postcode for jobs the actor is not assigned to (`adapter.js:71-72`).

### 4.5 PermissionRules (`tables.json:484`, seed `config-seed.json:36-43`)
Six rows (quoted in section 5). Evaluated only by S04: rule matches when `role ∈ actor.roles`, `action ∈ {CompleteTask,*}`, `entity ∈ {Tasks,*}`; scope must be `All` or `Assigned` (else `INVALID_PERMISSION_RULE`); an applicable `allowed=false` rule is an immediate deny; at least one applicable allow is required (`s04/processor.js:48-59`). `OwnCompany` and `FinanceOnly` scopes are never evaluated anywhere.

### 4.6 PersonSkills (`tables.json:188`)
- id format `SK-<person_id>-<skill>` → one row per (person, skill) (`tables.json` id note; `resource/planning.js:106`).
- `skill` ∈ `Roof|Electrical`; `level` ∈ `Lead|Member|Apprentice`, default `Member` (`planning.js:101-103`); `certified_until` DATE nullable; `active` default true; `notes`.
- Only people with `People.role==='Installer'` may hold skills (`planning.js:100`).
- Purpose note (verbatim): "absence of rows means no skill constraint". Code: if a person has **any** active skill rows and none matches the package trade → blocking `SKILL_MISMATCH`; zero rows → no constraint (`planning.js:215-217`).
- `certified_until < package end` → **warning only** `CERTIFICATION_EXPIRES_BEFORE_END`; `Apprentice` → warning `APPRENTICE_NEEDS_SUPERVISION` (`:218-219`). Ranking: ready first, then level order Lead<Member<Apprentice, then lowest load, then name (`:246-252`).
- **There is no primary/backup concept on skills.** "Backup" exists only as `People.backup_person_id` and `Tasks.backup_id`.

### 4.7 PersonAvailability / Teams / TeamMembers
- PersonAvailability: `to_date` inclusive, null = single day (`tables.json` note; code stores `to = from`, `planning.js:130`). Any active row whose type ≠ `Available` overlapping the window → `ON_LEAVE` (`:203,220-221`). Cancel = set `active=false` with mandatory reason (`:142-152`). id `AV-<person>-<command_id>`. Setting leave returns conflicting active allocations + `replan_required` but does not change them (`:137-140`). `approved_by` defaults to the actor (`:132`); noted "FK People" in the column but **missing from the `foreign_keys` array**.
- Teams: id `TEAM-<slug(name)>` (`:161`); trade `Roof|Electrical|Mixed`.
- TeamMembers: id `TM-<team_id>-<person_id>`; role default `Member`; **at most one active `Lead` per team** (`:178-181`); members must be Installers (`:173`). `from_date`/`to_date` are stored but **never evaluated** — only `active` is (`:193,204,243`).

---

## 5. Config seed (`schema/config-seed.json`, version `S02-CONFIG-1.0`, generated 2026-09-12)

Header note (verbatim, `:4`): "Synthetic seed data only. Missing real addresses/emails/IDs marked NOT_CONFIGURED. Exception: PERSON-lenny-dev uses the approved DEV implementer email so rebuild/reseed preserves Admin authorization. No real customer or financial data."

Row counts now: Companies 2, Contacts 2, People 9, PersonRoles 5, PermissionRules 6, Products 2, StockLocations 5, TaskTemplates 28, Holidays 0, Settings 8, ReleaseModes 20. (S02 closure recorded 7/3/5/3/15 for People/PersonRoles/PermissionRules/StockLocations/TaskTemplates — the seed grew afterwards; `docs/S02-closure.md:9-21`.)

### 5.1 BUSINESS configuration (port as seed data)

**Settings** (`:91-100`) — all `scope:"Global"`, `version:1`, `effective_from:"2026-01-01"`, `changed_by:"S02-config-seed"`; `typed_value` is a JSON-encoded string, highest `version` per key wins (`resource/planning.js:44`):

| key | typed_value |
|---|---|
| `office.timezone` | `Europe/London` |
| `office.staffed_weekdays` | `[1,2,3,4,5]` (Mon–Fri) |
| `office.hours` | `{"start":"09:00","end":"17:00"}` |
| `products.panel_lead_days` | `14` |
| `finance.interim_send_lead_days` | `7` |
| `finance.deposit_pct` | `25` |
| `finance.interim_pct` | `35` |
| `finance.balance_pct` | `40` |

(S13 hard-codes the same split as `{deposit:25, interim:35, final:40}` and VAT as gross/1.2 — `s13/payments.js:8,29-31` — rather than reading Settings.)

**TaskTemplates** (`:58-87`) — 28 rows, all `active:true`, `template_version:"1.0"`, id `TPL-<code>`:

| Code | Title | Group | Owner role | Trigger | Due rule | Evidence required |
|---|---|---|---|---|---|---|
| PRE01 | Send deposit invoice | Prebooking | Office | New Standard sale | Same day | Confirmed invoice ID and sent status |
| PRE02 | Check contract sent/signed | Prebooking | Office | New sale | Same day then daily | Signable reference and signed evidence |
| PRE03 | Confirm bank deposit | Prebooking | Admin | Deposit expected | Next staffed day | Verified amount/date |
| PRE04 | Check customer details and sold/presale amount | Prebooking | Office | New sale | Before booking approval | Checked fields and source references |
| PRE05 | Check finance agreement approval | Prebooking | Office | Finance job | Before booking approval | Provider/agreement evidence |
| BKG01 | Prepare booking | Booking | Office | Booking intake received | Before booking confirmation | Survey, presale, extras, board capacity |
| BKG02 | Book dates and allocations | Booking | Office | Booking intake received | Before booking confirmation | Customer contact outcome and installer/scaffold allocations |
| BKG03 | Reconcile booking response | Booking | Office | Booking response | Before booking confirmation | Value/contact match or approved documented changes |
| BKG04 | Send customer booking email | Booking | Office | Booking confirmed | Same staffed day | Approved message and sent record |
| BKG05 | Check calendar events and document pack | Booking | Office | Booking confirmed | Same staffed day | Event links and required survey/design/schematic/shutdown documents |
| MAT01 | Place material order | Materials | Office | Material ToOrder created | Need-by minus lead days | Order lines, delivery date, sent reference |
| MAT02 | Verify already-ordered materials | Materials | Office | AlreadyOrdered | Same staffed day | Supplier confirmation of reference/date/quantities; no duplicate order |
| MAT03 | Reserve and pick stock | Materials | Store | Stock source | Before collection | Quantities and location; short or damaged goods create a separate action |
| MAT04 | Receive and check delivery | Materials | Store | Expected delivery | Delivery date | Good/damaged/short quantities and delivery note |
| MAT05 | Friday merchant expected-delivery lists | Materials | Office | Every Friday | Friday 12:00 | Reviewed/sent snapshot for next Thursday |
| MAT06 | Merchant confirmation of latest revision | Materials | Office | Sent/changed order/list | Next staffed day default, urgent same day | Acknowledgement of latest revision |
| SCA01 | Notify and confirm scaffolder erect | **Materials** | Office | Scheduled erect | Before need date per lead time | Latest revision confirmed |
| SCA02 | Confirm scaffold erected | Scaffold | Office | Erect expected | Erect day end | Actual erect date or delay task |
| SCA03 | Book scaffold strip | Scaffold | Office | Customer happy and strip authorised | Next staffed day | Strip date/company plus instruction and confirmation |
| SCA04 | Confirm scaffold stripped | Scaffold | Office | Strip expected | Strip day end | Actual removal evidence or chase task |
| SCA05 | Friday scaffolder erect/strip list | Scaffold | Office | Every Friday | Friday 12:00 | Sent snapshot per company and acknowledgement task |
| INS01 | Installer confirmation call | Install | Office | Work package ending or reported complete | Next staffed day | Complete/return/unknown outcome with actual date |
| INS02 | Missing commissioning reminder | Install | Installer | Missing commissioning forms | Two working days after completion | Submitted evidence or reminder follow-up |
| FIN01 | Interim draft check/send | Finance | Office | Installation confirmed | Seven days before due | Confirmed invoice status |
| FIN03 | Balance invoice authorise/send | Finance | Office | Operational approval | Same staffed day | Confirmed invoice and send result |
| GHL01 | Move GHL opportunity | Aftercare | Office | Operational approval + payment message ready | Next staffed day | Pipeline/stage and action evidence |
| SYS01 | Check authorisation/integration health | System | Office | Every staffed day | 09:00 | Last-success timestamps, failures assigned |
| SYS02 | End-of-day review | System | Office | Every staffed day | 16:30 | Unresolved actions assigned |

`trigger_event` and `due_rule` are **human-readable prose, not machine rules** — the actual triggers/due maths are coded per module. There is no FIN02 row, although code comments name FIN02 as the interim-chase milestone (`s13/payments.js:196`; `r1-appsheet/services.js:1225`). Templates that exist **only in code**, created on demand: `ISS01 Review variation` (owner VariationApprover) and `ISS02 Investigate and resolve issue` (`r1-appsheet/services.js:627-631`; installer variant title "Review installer problem report" `installer/workflow.js:23`), `REM01` ("Agree return date with customer" `s10/fixture.js:5` vs "Arrange remedial return visit" `installer/workflow.js:21`), `INS04 Customer call` (`s10/fixture.js:5`), `STK-RECONCILE`, `STK-CLAIM`, `STK-COUNT` (`stock/workflow.js:24-28`), `S06-UNPAID-INTERIM`, `S13-INTERIM-CHASE`, `S13-GHL-PROGRESSION`, `S15-CAN-*` cancellation set (CALENDAR, CUSTOMER, FINANCE, GHL, INSTALLER, LEGACY, MERCHANT, PHOENIX, REVIEW, SALES, SCAFFOLD, SIGNABLE, STOCK, STRIP, XERO), `S15-REOPEN-REVIEW`, `CAL-DRIFT`, `XO-REVIEW-CANCEL` (`xero/adapter.js:141`).

**Named personal responsibility (code constant, not seed):** PRE03 owner `PERSON-ben`, backup `PERSON-dan`, eligible roles `Admin|Manager|Director`; fails loudly rather than reassigning (`s06/gates.js:609-634`). Note the seed template says owner role `Admin` while code ignores role lookup for PRE03.

**Booking-readiness gates (code, `s06/gates.js:102-135+`)** — names: `sold_linked`, `finance_route_valid`, `signed_contract_evidence`, `PRE01_satisfied` (Standard only), `PRE02_satisfied`, `PRE04_satisfied`, `customer_value_verified`, `PRE03_satisfied` + `deposit_confirmation_evidence` (Standard only), else `PRE05_satisfied` (Phoenix/OtherReview). Task "satisfied" = status `Complete` or `NotRequired` (NotRequired needs a completion_note or evidence_id) (`:9,75-77`), and PRE01–PRE04 additionally require hard evidence on InvoiceStages/Jobs/ManualBankChecks (`:15-73`). (Detailed gate logic belongs to the workflow survey; listed here because `TaskDependencies.named_gate` has no seeded vocabulary.)

**PermissionRules** (`:36-43`): `PERM-admin-all` Admin `*`/`*`/All; `PERM-office-tasks` Office CompleteTask/Tasks/All; `PERM-director-assigned-tasks` Director CompleteTask/Tasks/Assigned; `PERM-installer-own` Installer View/Jobs/Assigned; `PERM-scaffolder-own` Scaffolder View/ScaffoldBookings/OwnCompany; `PERM-finance-reports` Finance View/Reports/FinanceOnly — all `allowed:true`.

**Companies** (`:6-9`): `COMP-greentech` "Greentech", Merchant, `standard_lead_days:14`, `delivery_weekday:4` (Thursday), notes "Roofing merchant. Contact: Tom"; `COMP-cef` "CEF", Merchant, `standard_lead_days:7`, `delivery_weekday:4`, notes "Electrical merchant. Contact: Luke". **Contacts** (`:11-14`): `CONT-greentech-tom` Tom, `CONT-cef-luke` Luke, both `contact_role:"Sales"`, emails/phones `NOT_CONFIGURED`. No scaffolder company is seeded (fixtures create `COMP-scaffold-dev`, `s09/fixture.js:13`).

**Products** (`:45-48`): `PROD-P460` sku `P460` "460W Solar Panel" and `PROD-P515` sku `P515` "515W Solar Panel"; both category `Panel`, unit `Each`, `unit_precision:0`, `stock_tracked:true`, default supplier `COMP-greentech`, `standard_lead_days:14`, `unit_cost_pence:null`, manufacturer/model `NOT_CONFIGURED`.

**StockLocations** (`:50-56`): `LOC-store` "Main Store" Store usable=true; `LOC-quarantine` "Quarantine" Quarantine false; `LOC-external` "External (balancing)" Supplier false; `LOC-installed` "Installed" Installed false; `LOC-disposal` "Disposed" Disposed false. These ids are hard-coded in the stock/materials modules (`stock/workflow.js:22`; `materials/workflow.js:18`).

**Holidays**: empty array (`:89`); `config/README.md:9` stresses null/empty means "not supplied", not "no holidays".

**Booking → product map** (`config/booking-product-map.example.json`, `mapping_version "R1-BOOKING-PRODUCTS-1.0"`): 33 material keys (Renusol hooks R420181/R420150 slate/concrete portrait/landscape/total, L bracket REN-420353, hook rest rubber, end clamps REN-420081-B, end caps REN-900276, mid clamps REN-420082-B, rail REN-400572, splice REN-400531, K2 flat/curved multi/mini rails, Genius Speed flashing, K2 1000074 hook, K2 mid clamps 2004540, K2 end clamps 2004545, K2 end caps, K2 rail, K2 splice, panels 515/460/M-Class, bird netting (m), optimisers, Fox junction box, dongle, gateway, EV charger) and 2 equipment keys (`inverter_to_order`→Inverter, `battery_to_order`→Battery). **Every `product_id` is `NEED_APPROVAL`** (`:3` "do not invent identities"). Rule: `skip_component_when_authoritative_total_present: true` — when a `*_total` line (flag `authoritative_total`) is present, the component lines are skipped (`:7,10,43`).

**Intake field mapping** (business knowledge of the two Jotform forms; `s05/mapping.js:106-160+`, `mapping_version 'S05-DEV-2.0'`): Sold form → Customers (first/last name, address1/2, town, postcode[uppercase], email[lowercase], phone), Jobs (lead_source, quote_reference, finance_route[required], salesperson_id, presale_file_id, roof/electrical/scaffold_required, original_gross_pence, valuation_basis), TechnicalDetails (roof_notes, electrical_notes). Booking form → exact `Job ID` match only ("NEVER surname/address fallback", `:131`), customer *proposals*, system kW, cost of job (mismatch check only), finance, merchant, annual generation, roofer/sparky/scaffold dates, installers resolved by exact `display_name`, scaffold company/PDF/notes, material quantities.

### 5.2 Rollout / environment plumbing in the seed

- **ReleaseModes** FN-01…FN-20 (`:102-123`), all seeded `mode:"Disabled"`, `authorised_job_scope:"None"`. Function → target release / planned mode: FN-01 Office core R1 Automated; FN-02 Calendar R2 Automated; FN-03 Orders/merchant messages R2 Automated; FN-04 Scaffold R2 Automated; FN-05 Panel stock R2 Automated; FN-06 Installer app R3 Automated; FN-07 Commissioning review R3 Automated; FN-08 Handover R3 Automated; FN-09 Invoices/payments R4 Automated; FN-10 Phoenix R4 **Manual**; FN-11 GHL progression R1 **Manual** ("Remains Manual in every release"); FN-12 Accounting/reporting R4 Automated; FN-13 Archive R4 Automated; FN-14 Backup/health R1 Automated; FN-15 Bank deposit confirmation R1 Manual; FN-16 Daily health review R1 Manual; FN-17 GHL cancellation R1 Manual; FN-18 Missing-form reminder R1 Manual; FN-19 Operational completion approval R1 Manual; FN-20 Customer/installer notices R1 Manual. The **Manual list is business policy worth keeping** (humans do GHL, bank checks, Phoenix, completion approval, notices); the Disabled/Pilot machinery is migration plumbing.
- People/PersonRoles seed rows are synthetic placeholders (`email:"NOT_CONFIGURED"` for all but `lenny@simplesolarltd.co.uk`). Real staff names/trades are listed only in `docs/AGENT_RUNBOOK.md:178-203`.
- `config/environment.example.json`: environment, `mode:"CAPTURE"`, sheet/script/folder/AppSheet ids, recipient & calendar allow-lists — all environment plumbing; the only business facts in it are `timezone:"Europe/London"` and `staffedWeekdays [1..5]`.
- `config/environment-register.csv`: empty governance register (every row "BLOCKED — INPUT REQUIRED").

---

## 6. Versioning, audit, soft-delete, timestamps

**Optimistic locking.** `version INTEGER required`, "Positive integer, optimistic locking" (`tables.json` People.version note). Starts at 1 (`provisioner.js:297`); each update writes `Number(row.version||0)+1` (e.g. `s06/gates.js:551`; `resource/planning.js:87`). Clients send `expected_version`; mismatch → `STALE_VERSION`/`R1A_STALE_VERSION`/`MAT_STALE` (`s04/processor.js:25,73`; `r1-appsheet/adapter.js:47`; `materials/workflow.js:112`). R1 requires a safe integer ≥ 1. S03 generic `checkVersion` lets a null expected version pass (`processor/locking.js:4-5`) — the stricter R1 behaviour is the one in use. `CommitJournal.expected_version` records what was asserted. Tables **without** `version`: all append-only/event tables (CustomerChanges, Intake, TaskDependencies, TaskEvents, Calls, IssueEvents, OrderLines, Deliveries, ReceiptLines, StockMovements, Stocktakes, StocktakeLines, PanelUse, CommunicationJobs, Acknowledgements, CommissioningAnswers, Payments, ManualBankChecks, GHLTasks, AuditEvents, CommitJournal, Outbox, HealthChecks, ArchiveIndex, ReportSnapshots, Holidays). Note several of those *are* updated in practice (Deliveries.receipt_status, Outbox.status, Intake.processing_status, Stocktakes.status) without a version. `Settings.version` and `Evidence.version` are *record* versions (new row per change / file version), not lock counters.

**Separate "revision" counters** (business, not locking): `WorkPackages.revision`, `Materials.revision`, `Orders.revision` + `confirmed_revision`, `ScaffoldBookings.revision` + `confirmed_revision`, `Communications.revision`, `CommunicationJobs.entity_revision`, `Acknowledgements.acknowledged_revision`, `CalendarLinks.entity_revision` + `last_synced_revision`, `Outbox.job_revision`. Rule: an acknowledgement is outstanding while `confirmed_revision < revision` (`scaffold/workflow.js:581`).

**Idempotency keys.** `Tasks.instance_key` unique — "template + entity + revision/episode" (`tables.json:1667`), concrete form `<CODE>-<job.id>-ROOT-nodue` (`s06/gates.js:558,648`); `StockMovements.idempotency_key` and `Outbox.idempotency_key` unique; `Intake` unique on (`form_id`,`submission_id`) + `payload_hash`; `CommitJournal.command_id` with replay-returns-stored-result and "same id, different content → conflict" (`s04/processor.js:120-127`; `processor/command.js:18-27`).

**Audit.** `created_at/created_by/updated_at/updated_by` on mutable tables; `*_by` columns are untyped TEXT holding a mix of `People.id` (R1 paths, e.g. `services.js:199`), service tags (`'S06-gates'`, `'S13-payments'`, `'S02-provisioner'`) and in S03 an email — no FK is declared on any `*_by` column. `AuditEvents` = immutable log with `entity_type, entity_id, action, before_json, after_json, initiating_actor, executing_service, timestamp, correlation_id (= command_id), reason, commit_id` (`processor/audit.js:9-27`; `s04/processor.js:155-159`). Domain histories: TaskEvents, IssueEvents. Sheet store forbids updating TaskEvents/AuditEvents (`s04/sheet-store.js:42`).

**Soft delete.** No `deleted_at` anywhere and no production code path deletes rows (only fixtures call `store.delete`, `s16/fixture.js:343,365`). Conventions: `active BOOLEAN` on reference data (People, PersonRoles, PersonSkills, PersonAvailability, Teams, TeamMembers, Companies, Contacts, Products, MappingRules, Allocations, CommissioningTemplates, TaskTemplates); status `Cancelled`/`Voided`/`Reversed` on transactional rows; `cancelled_quantity` on Materials/OrderLines instead of deleting lines; replacement chains `Allocations.replaced_allocation_id`, `CommissioningSubmissions.supersedes_submission_id`, `WorkPackages.parent_package_id`; Jobs use `cancellation_at/by/reason` + stages `CancellationInProgress`→`Cancelled`, and `archived_at`. Ledgers (StockMovements, AuditEvents, TaskEvents, IssueEvents) are append-only; corrections are new rows (`Adjustment`, `Reversed`).

**Timestamps / timezone.**
- `_at` TIMESTAMP columns are **UTC ISO-8601** strings (`tables.json:5`; every writer uses `new Date().toISOString()`).
- DATE columns are **Europe/London local calendar dates** `yyyy-MM-dd` (each module's date helper formats in `Europe/London`: `resource/planning.js:30-31`, `s10/operations.js:24-25`, `materials/workflow.js:38-39`, …). Caution: three columns end in `_at` but are typed DATE — `Allocations.start_at`, `Allocations.end_at`, `ScaffoldBookings.erect_planned_at/erect_actual_at/strip_forecast_at/strip_planned_at/strip_actual_at` — contradicting the "`_at` = UTC timestamp" rule.
- Business timezone `Europe/London` "not the workstation's timezone" (`config/README.md:9`; Setting `office.timezone`; `config/environment.example.json:3`); Apps Script project must be Europe/London (`calendar/cloud-adapter.js:140`).
- Staffed days Mon–Fri from Setting `office.staffed_weekdays` minus `Holidays` where `office_closed` (`resource/planning.js:45-46`); office hours 09:00–17:00. Wall-clock due times are converted London→UTC with DST handling (`installer/workflow.js:44`; e.g. variation review due 17:00 London same/next staffed day `:239`). Weak spots: S03 `todayDate()` uses the **UTC** date (`processor/clock.js:9-12`); S10 builds `…T09:00:00.000Z` i.e. 09:00 **UTC** not London (`s10/operations.js:44`); `stock/workflow.js:70` detects BST by string-matching `GMT+1`.
- Money: integer pence everywhere (`*_pence`); R1 converts GBP text to pence, max 2 dp (`r1-appsheet/services.js:169-170`); VAT derived as `round(gross/1.2)` (`s13/payments.js:29-31`). `Jobs.current_contract_gross_pence` = original + approved change (by naming; not verified in code). Quantities are DECIMAL to 3 dp max (`stock/workflow.js:35-39`).

**ID formats.**
| Entity | Format | Evidence |
|---|---|---|
| Job (internal PK `Jobs.id`) | `J-<base36 ms>-<6 base36>` | `s05/mapping.js:238-240` |
| Job public reference `Jobs.job_id` | `SS-LLLL-DDDD`, letters A–Z minus I,O; 20 collision retries | `s05/mapping.js:219-236` (but see contradiction 3.4 #5) |
| Customer | `CUST-<base36 ms>-<6>` | `s05/mapping.js:242-244` |
| Task | `TASK-<base36 ms>-<6>` or deterministic `TASK-<instance_key>` | `s06/gates.js:565`; `xero/adapter.js:141` |
| Generic | `<PREFIX>-<base36 ms>-<8 chars 0-9A-Z>` | `schema/keys.js:22-26` |
| Command | `CMD-<base36 ms>-<8>`; R1 validates `^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$` | `processor/types.js:95`; `s04/processor.js:22` |
| Derived-from-command | `MBC-R1A-<cmd>`, `CJ-RP-<cmd>`, `AUD-RP-<cmd>-…`, `TE-<commit>`, `AE-<commit>`, `AV-<person>-<cmd>` | `services.js:191`; `planning.js:69,81,133`; `s04/processor.js:154-155` |
| Natural/composite | `SK-<person>-<skill>`, `TM-<team>-<person>`, `TEAM-<slug>`, `IS-<job>-<stage>`, `IE-<issue>-<EVENT>-<version>` | `planning.js:106,161,177`; `s13/payments.js:23`; `s10/operations.js:118` |
| Seed | `PERSON-`, `PROLE-`, `PERM-`, `COMP-`, `CONT-`, `PROD-`, `LOC-`, `TPL-`, `SET-`, `RM-FNnn` | `config-seed.json` |

Foreign keys reference the internal `id`, never the public `job_id` ("Use job_id for external display and id for internal FK references", Jobs.job_id note). Beware the naming collision: column `job_id` on **child** tables holds `Jobs.id` (`J-…`), whereas `Jobs.job_id` holds `SS-…`.

---

## 7. Open questions / ambiguities

1. **Role list is not closed.** Schema/`ActorRole` = 8 roles; code + seed add `Director` and `VariationApprover`; runbook adds `Surveyor`; `Manager` ≡ `Admin` in practice; `Finance` and `ReadOnly` are defined but unused. Which set is authoritative for the port? Should Director stay excluded from CONFIRM_BOOKING / OPERATIONAL_COMPLETE (looks accidental: `adapter.js:27-29`)?
2. **Two sources of role truth** (`People.role` vs `PersonRoles`), read differently by different modules (section 4.3). Seeded Store/Installer/Scaffolder people have no PersonRoles rows. Recommend one `person_roles` table and dropping `people.role` — needs confirmation.
3. **PermissionRules is mostly decorative** — only S04 CompleteTask reads it; `OwnCompany`/`FinanceOnly` scopes are never evaluated. Port as data, or translate into RLS policies and drop?
4. **InvoiceStages vocab conflict**: `Balance` (schema/Settings key `finance.balance_pct`/template FIN03 "Balance invoice") vs `final` (S13/S14 code); lower-case vs Title-case; statuses `Pending`/`Confirmed` not in schema (3.4 #1-2).
5. **Job reference format** `SS-XXXX-XXXX` alphanumeric (keys.js + schema note) vs `SS-LLLL-DDDD` (live intake + validators).
6. **Tasks.group** needs `Scaffold` (and possibly `Calls`, `Commissioning`, `Handover`, `CRM` used by S17 queues); why is SCA01 under `Materials`?
7. **Many status columns have no defined vocabulary at all**: FinancePlans.vat_basis & finance_agreement_status, TechnicalDetails.g99_status, AccountingEvents.event_type, JobCosts.category, Handover.completeness_status, Deliveries.receipt_status (received states), Communications.type, Issues.severity beyond Normal/Medium, Issues.approval_status beyond NotRequired/Pending, Jobs.financial_status derivation, TaskDependencies.named_gate values, Contacts.preferred_channel. These depend on the (unread-by-me) DOCX spec 01 §4 or on the pending commissioning/finance amendments.
8. **`trigger_event` / `due_rule` on TaskTemplates are prose.** The machine rules live in code per module; the port needs an explicit decision whether to encode them as data.
9. **`People.capacity_per_day` "Advisory only" vs code that blocks** when it is missing or exceeded; `People.backup_person_id` is never read; `TeamMembers.from_date/to_date` never evaluated; `PersonSkills.certified_until` only warns.
10. **`_at` columns typed DATE** (Allocations.start_at/end_at, five ScaffoldBookings columns) break the stated naming rule — rename in Postgres (`*_on`/`*_date`)?
11. **`*_by` columns hold mixed identifiers** (person id / service tag / email) with no FK. Decide: `uuid references people` + separate `actor_service text`?
12. **`PersonAvailability.approved_by`** is noted "FK People" but absent from `foreign_keys`. Other implied-but-undeclared references: `Tasks.evidence_id`, `IssueEvents.evidence_id`, `ReceiptLines.evidence_id`, `StockMovements.evidence_id/approval_id`, `Acknowledgements.evidence_id/entity_id`, `Jobs.contract_evidence_id` (→ Evidence?), `Communications.outbox_id`/`CalendarLinks.outbox_id` (→ Outbox), `InvoiceStages.request_id`, `Stocktakes.cut_off_commit_id` (→ CommitJournal.commit_id), `CommissioningSubmissions.template_version`/`CommissioningAnswers.question_key` (string joins to templates/questions, not id FKs), `Tasks.template_code` (→ TaskTemplates.template_code, string join), polymorphic `Tasks.related_entity_type/id`, `AuditEvents.entity_type/id`.
13. **Cardinalities not declared**: TechnicalDetails, FinancePlans, Handover look 1:1 with Jobs; InvoiceStages one per (job, stage) per id scheme; ScaffoldBookings possibly many per job. No unique constraints are declared beyond `People.email`, `Jobs.job_id`, `Intake.intake_id`, `Products.sku`, `Tasks.instance_key`, `StockMovements.idempotency_key`, `CommitJournal.commit_id`, `Outbox.idempotency_key`, `Holidays.local_date`, `TaskTemplates.template_code`, `ReleaseModes.function_id`. (`Intake` form_id+submission_id uniqueness is only a note.)
14. **Hard-coded people in logic**: `PERSON-ben`, `PERSON-dan`, `PERSON-tanya`, plus display-name matching on "ben"/"tanya" (`s16/health.js:799`; `materials/workflow.js:106`; `s10/operations.js:49`). Needs a configurable "responsibility" mapping in the new app.
15. **Validator limits acknowledged by the repo itself**: no duplicate-PK scan, no checksum, TEXT check on row 2 only (`docs/S02-closure.md:31-33`) — i.e. existing Sheet data (if migrated) has never been integrity-checked.
16. **Scope of my reading**: I did not open the four DOCX specifications (binary) — enum gaps in item 7 may be answered there ("01 Developer Build Specification §4").

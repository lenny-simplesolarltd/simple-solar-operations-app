# REF-04 — Operational modules, test suite and release status (reference repo survey)

Reference repo: `/Users/lennybeadle/:reference` (Google Sheets + AppSheet + Apps Script). All paths below are relative to that root. Citations are `file:line`. Surveyed 18 Sep 2026.

> **Read-only disclosure.** I ran `node --test tests/*.test.cjs` to get a ground-truth pass count (1012 pass / 0 fail, Node v22.13.0). One test (`tests/appsheet-operations.test.cjs:109-113`, "generated: source/generator rebuilds have no drift") shells out to four build scripts, which **rewrote four generated bundles in place**: `standalone-bridge/AppSheetBridge.js`, `apps-script/materials/MaterialsWorkflow.js`, `apps-script/r1-appsheet/R1AppSheetAdapter.js`, `apps-script/installer/InstallerWorkflow.js`. The same test asserts the rebuilt content is byte-identical to what was there before, and it passed, so only the mtimes changed (now Sep 18 19:30:27). My pre-check grepped for `execSync|spawnSync|writeFileSync` and missed `execFileSync`. No source files were touched; all four were already ` M` versus HEAD before the run. Nothing else in the repo was modified.

## 0. Cross-cutting conventions (apply to every module below)

Every module repeats the same skeleton; it is worth porting once as shared infrastructure rather than per module.

| Mechanism | Literal behaviour | Citation |
|---|---|---|
| Command envelope | every mutating command needs `command_id` + `actor`; refuses `<PFX>_REVIEW: command_id and actor required` | `materials/workflow.js:123`, `stock/workflow.js:125`, `scaffold/workflow.js:124`, `installer/workflow.js:65` |
| Idempotency journal | `CommitJournal` row `CJ-<PFX>-<command_id>`, state `Prepared` → `Committed`; replay of identical `{entity_type, entity_id, changes_json}` returns `{replay:true}`; different content → `<PFX>_REVIEW: conflicting command identity`; a `Prepared` row found later → `<PFX>_RECOVERY_REQUIRED` | `materials/workflow.js:122-134`, `stock/workflow.js:124-136` |
| Optimistic concurrency | `expected_version` mandatory; mismatch → `<PFX>_STALE: version`; every patch does `version + 1`, sets `updated_at/updated_by` | `materials/workflow.js:112-118`, `scaffold/workflow.js:139-145` |
| Audit | one `AuditEvents` row per mutation: `before_json`, `after_json`, `initiating_actor`, `executing_service`, `correlation_id = command_id`, `reason` | `materials/workflow.js:135-137` |
| Release gate | `ReleaseModes` row for the function must be exactly one, right `target_release`, `mode === 'Automated'` and `authorised_job_scope === 'Pilot'` | `materials/workflow.js:87-91`, `stock/workflow.js:86-90`, `scaffold/workflow.js:85-93`, `installer/workflow.js:50` |
| Job gate | job must be `pilot_job` true and `release_scope === 'R2'` (materials/stock/scaffold); installer requires only `pilot_job` | `materials/workflow.js:92-98`, `installer/workflow.js:54` |
| Cancellation suppression | any job with `cancellation_at` or `workflow_stage` in `CancellationInProgress`/`Cancelled` → `S15_REVIEW: normal work suppressed` | `materials/workflow.js:96`, `stock/workflow.js:95`, `scaffold/workflow.js:98`, `installer/workflow.js:54` |
| Task creation | dedupe by `instance_key` (non-Cancelled / non-terminal); owner resolved from template `default_owner_role`; `backup_id = owner.backup_person_id`; `priority: 1`, `status: 'Open'` | `materials/workflow.js:142-157` |
| Owner resolution | Office role → the active Office person whose `display_name` contains `tanya`, else first active Office person; non-Office roles fall back to Office | `materials/workflow.js:104-111`, `stock/workflow.js:103-110`, `installer/workflow.js:76-83` |
| Working calendar | Settings `office.staffed_weekdays` default `[1,2,3,4,5]`; `office.hours` default `{start:'09:00', end:'17:00'}`; `Holidays.office_closed`; all instants computed in `Europe/London` (BST/GMT aware) | `materials/workflow.js:58-80`, `scaffold/workflow.js:54-78` |
| DEV lock | hardcoded sheet id `1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc` + `environment === 'DEV'` | `materials/workflow.js:13,84-86` |
| Outbound | nothing is sent. Communications are inserted `status: 'Draft'`, `sent_at: null`, `external_message_id: null`; body note `CAPTURED DRAFT — not sent.` | `materials/workflow.js:211-222`, `scaffold/workflow.js:194-206,214` |

ReleaseModes seed — all 20 functions ship `Disabled` / scope `None` (`schema/config-seed.json`, `ReleaseModes`): FN-01 Office core (R1), FN-02 Calendar entries (R2), FN-03 Orders and merchant messages (R2), FN-04 Scaffold commitments (R2), FN-05 Panel stock balances/movements (R2), FN-06 Installer app/forms access (R3), FN-07 Commissioning receipt/review (R3), FN-08 Handover (R3), FN-09 Invoices and payment reconciliation (R4), FN-10 Phoenix (R4), FN-11 GHL progression (R1), FN-12 Accounting/reporting (R4), FN-13 Archive (R4), FN-14 Backup/restore and health (R1), FN-15 Bank deposit confirmation (R1), FN-16 Daily health review (R1), FN-17 GHL cancellation (R1), FN-18 Manual missing-form reminder (R1), FN-19 Operational completion approval (R1), FN-20 Customer and installer notices (R1).

---

## 1. Modules

### 1.1 Materials — release R2, gates FN-03 (+ FN-05 for receipts)

Purpose: job material requirements → one purchase order per merchant per work type → send/confirm/revise/cancel with revision-tracked merchant acknowledgement → goods-in receipt into store or quarantine → Friday expected-delivery lists. Source `materials/workflow.js`, `materials/revisions.js`; doc `docs/MATERIALS-implementation.md`.

Literal enums (`materials/workflow.js:15-26`): sources `ToOrder | AlreadyOrdered | Stock`; work types `Roof | Electrical | Other`; order statuses `Draft | Review | Requested | Confirmed | PartReceived | Received | Cancelled`; locations `LOC-store`, `LOC-quarantine`, `LOC-external` (supplier/balancing). Task templates MAT01 "Place material order" (Office), MAT02 "Verify already-ordered materials" (Office), MAT03 "Reserve and pick stock" (Store), MAT04 "Receive and check delivery" (Store), MAT05 "Friday merchant expected-delivery lists" (Office), MAT06 "Merchant confirmation of latest revision" (Office).

**Date rules (the core business arithmetic):**
- Delivery date = merchant `delivery_weekday` (1–6, default **4 = Thursday**) in the week **before** the Monday-week of the package's planned start: `monday(planned_start) − 7 + (dw − 1)` (`materials/workflow.js:181-186`).
- Friday list date for a delivery = `monday(delivery_date) − 3` (`:188`).
- Lead-time risk: `latest_order_date = prevStaffed(need_by − merchant.standard_lead_days)`; `at_risk = latest_order_date < today` (`:195-199`).
- Worked example proven in MAT 01: roof 4 Nov → delivery 29 Oct → list 23 Oct; electrical 16 Nov → delivery 12 Nov → list 6 Nov (`docs/MATERIALS-implementation.md:10`).
- Seed merchants: Greentech lead 14 days / weekday 4; CEF lead 7 days / weekday 4 (`schema/config-seed.json`, Companies).

**Commands**

| Command | Payload | Validation | Effects | Cite |
|---|---|---|---|---|
| `_matAddRequirement` | `job_id, source, required_quantity, product_id? \| (description+unit), work_package_id?, merchant_id?, need_by_date?, already_ordered_reference?, notes?, expected_version(Job)` | source in enum; qty > 0; active product **or** description+unit ("Other"); WP must belong to job; merchant required unless `Stock` (defaults from `product.default_supplier_id`); need-by defaults from WP planned_start via delivery rule, else required; `AlreadyOrdered` needs `already_ordered_reference` | Materials row `MAT-<job>-<command_id>`; bumps Job version; `AlreadyOrdered` → MAT02 due same/next staffed day end; `Stock` → MAT03 due end of previous staffed day before need-by; `ToOrder` returns `lead_time_risk` | `:232-271` |
| `_matBuildOrders` | `job_id` | pending = ToOrder materials with no `order_line_id` and open qty > 0; each must have a merchant | groups by `merchant_id\|work_type`; order id `ORD-<job>-<merchant>-<type>` (suffix `-2`, `-3` if the existing one is past Draft/Review); appends to an existing Draft and pulls `requested_delivery_date` **earlier** if needed; lines `OL-<order>-<n>` with `description_snapshot`, `unit_net_cost_pence` from product; MAT01 due start of `latest_order_date` (or today if at risk, title suffix `— LEAD-TIME RISK`). Replay identity is job+command only, not the derived set | `:295-336` |
| `_matSendOrder` | `order_id, expected_version, urgent?` | status in Draft/Review/Requested; at least one open line | → `Requested`; immutable Communications snapshot `COMM-MAT-<order>-MerchantOrder-R<rev>` (includes customer postcode + lines); completes MAT01; opens MAT06 `MAT06-<order>-R<rev>` due next staffed day start (urgent: same day end). Returns `sent:false` | `:342-361` |
| `_matConfirmOrder` | `order_id, supplier_reference, confirmed_delivery_date?, response_text?, received_at?, evidence_id?, expected_version` | supplier_reference required; status must be `Requested` | → `Confirmed`, `confirmed_revision = revision`, `confirmed_at/by`; Acknowledgements `ACK-MAT-<order>-R<rev>`; completes MAT06+MAT01; Deliveries `DEL-<order>-R<rev>` `receipt_status: 'Expected'`; MAT04 due delivery-day end | `:365-388` |
| `_matReviseOrder` | `order_id, reason, requested_delivery_date? , lines?[{order_line_id, quantity?, cancelled_quantity?}], urgent?, expected_version` | reason required; date or lines required; status in Draft/Review/Requested/Confirmed; quantity ≥ already received; cancelled_quantity within open remainder | `revision + 1`; sent orders return to `Requested`; line changes mirrored onto Materials; amended snapshot `(AMENDED)` with `supersedes_revision`; MAT06 for the new revision, **urgent when `input.urgent` or lead-time at risk**; open deliveries and their Open tasks move to the new date | `:392-431` |
| `_matReviseSentOrder` | same as revise | — | wraps revise, then **supersedes** open MAT06 tasks of earlier revisions: status `Cancelled`, `TaskEvents.action = 'Supersede'`, note "Superseded by revision N — confirm <task> instead" | `materials/revisions.js:10-28` |
| `_matRecordSupplierReply` | `order_id, acknowledged_revision, supplier_reference, …` | revision integer 1..latest; that revision's communication must exist (else "was never sent") | reply to latest → `_matConfirmOrder`, outcome `ConfirmedLatest`; reply to superseded revision → kept as `ACK-MAT-<order>-R<n>-STALE-<command>` with outcome `StaleRefused`, **no order state change, no task completed** | `materials/revisions.js:29-54` |
| `_matCancelOrder` | `order_id, reason, expected_version` | not already Cancelled; `PartReceived`/`Received` refused: "goods received; use return/credit review instead of cancel" | → `Cancelled`, revision+1; lines `cancelled_quantity = quantity`; materials `order_line_id = null` (released to ToOrder); unreceived deliveries `receipt_status: 'Cancelled'`; open order/delivery tasks cancelled; if it had been sent: `MerchantOrderCancellation` draft + MAT06 "cancellation acknowledgement" same-day end | `:435-460` |
| `_matReceiveDelivery` | `delivery_id, received_by, delivery_note_reference, lines[{order_line_id, quantity_good, quantity_damaged, quantity_short, evidence_id?}], delivery_note_file_id?, delivery_note_filename?, discrepancy_note?, evidence_id?` | **FN-03 and FN-05 both required**; delivery not already received; order in Confirmed/PartReceived/Requested; each line ≥ 0 and not all-zero; good+damaged+short ≤ outstanding | ReceiptLines `RL-<delivery>-<line>`; for `stock_tracked` products only: `Receipt` movement supplier→`LOC-store` key `MOV-RCPT-<rl>-GOOD` and `Damage` movement supplier→`LOC-quarantine` key `MOV-RCPT-<rl>-DMG`; damaged → Issue `type: Supply, category: DamagedGoods`; short → Issue `category: ShortDelivery` (responsible = merchant, owner = Office, `blocks_completion:false`); Evidence `EV-<delivery>` category `DeliveryNote`; delivery status `Discrepancy` / `Received` / `Partial`; order → `Received` or `PartReceived`; completes MAT04; if incomplete, follow-up delivery + MAT04 "balance of <order>" next staffed day | `:464-526` |
| `_matWeeklyList` | `list_date?` | — | window = next Monday–Sunday; deliveries not received/cancelled, order in Requested/Confirmed/PartReceived, pilot non-cancelled job; one draft `COMM-MAT-WEEKLY-<merchant>-<weekStart>` type `MerchantDeliveryList` per merchant (idempotent); each item carries `acknowledged = confirmed_revision === revision`; MAT05 due Friday 12:00 London; MAT06 list acknowledgement next staffed day | `:530-561` |
| `_matQuarantineStock` | `product_id, quantity, expected_balance, reason, evidence_id?, expected_version(Product)` | FN-05; product active + stock_tracked; store usable; quarantine non-usable; `expected_balance` must equal current store balance (`MAT_STALE: stock balance`); qty ≤ balance | one `Damage` movement `LOC-store`→`LOC-quarantine`, id `SM-QUARANTINE-<command_id>`; **one-way only** ("never release/dispose/adjust") ; pins product version | `:586-607` |

Order state machine: `Draft|Review →(send) Requested →(confirm) Confirmed →(receive) PartReceived → Received`; `Requested|Confirmed →(revise) Requested` (revision+1); any pre-receipt state `→ Cancelled`. Requirement read-model states: `ToOrder | Drafted | AwaitingConfirmation | Confirmed | PartReceived | Received | VerifyExternalOrder | Stock` (`:287`).

Invariants: an AlreadyOrdered line never produces a second order; roof and electrical are always separate orders; a sent snapshot is never rewritten (new revision = new communication row); `acknowledgement_required = status in (Requested, Confirmed, PartReceived) AND confirmed_revision < revision` (`:575`); a stale reply can never clear the latest confirmation; receipts are replay-safe via movement idempotency keys; "Other" lines with no stock-tracked product create no ledger movement; short and damaged goods always raise a separate action.

### 1.2 Stock, goods-in and quarantine — release R2, gate FN-05

Purpose: append-only panel ledger. Source `stock/workflow.js`; doc `docs/STOCK-implementation.md`. Goods-in lives in materials (`_matReceiveDelivery`), not here (`stock/workflow.js:15`).

Movement types (`:23`): `Opening, Receipt, Issue, Install, Return, Damage, SupplierReturn, Disposal, Adjustment`. Locations (`:22` + seed): `LOC-store` (Store, usable), `LOC-quarantine` (Quarantine, not usable), `LOC-external` (Supplier/balancing), `LOC-installed` (Installed), `LOC-disposal` (Disposed), plus on-demand `LOC-site-<job>` type `JobSite` (`:182-188`). Module-default task codes (not seeded): `STK-RECONCILE`, `STK-CLAIM`, `STK-COUNT` (`:24-28`).

Balance maths: balance(location) = Σ qty into − Σ qty out over the product's movements (`:192-199`); **available = store balance − Σ Active reservations** (`:205-206`). Quantities must be ≥ 0 with at most 3 decimals (`:35-39`). Every quantity command "pins" the Product row (version+1) so two concurrent commands cannot both pass (`:222-223`).

| Command | Key rules | Cite |
|---|---|---|
| `_stkOpeningCount` | once per product+location (key `OPEN-<product>-<location>`); reason required; movement supplier→location type `Opening` | `:227-246` |
| `_stkReserve` | material must be `source: 'Stock'`; product must match the requirement (substitution refused: "an approved substitution needs a material revision"); one Active reservation per requirement (`RES-STK-<material>`); ≤ outstanding; ≤ available else `STK_INSUFFICIENT`; optional `expected_available` stale check; **no movement** | `:250-283` |
| `_stkPick` | reservation must be Active; 0 < picked ≤ reserved; sets `picked_quantity/picked_at/picked_by` only — **goods stay in store and stay reserved** | `:287-306` |
| `_stkIssue` | quantity defaults to picked; ≤ picked; ≤ store balance; optional `expected_balance`; one `Issue` movement store→site key `ISSUE-<reservation>`; reservation → `Issued`; completes MAT03 | `:310-338` |
| `_stkReportPanelUse` | one report per package+product (`PU-<wp>-<product>`); `issued_quantity` derived from Issue movements; `reconciles = installed+unused+defective+broken === issued`; mismatch → `STK-RECONCILE` task due next staffed day end | `:345-371` |
| `_stkAcceptPanelUse` | refused unless counts reconcile and not yet reviewed; `reviewed_by` required; one idempotent set: `Install` site→installed, `Return` site→store, `Damage` site→quarantine (defective+broken); `STK-CLAIM` task if any quarantined | `:372-404` |
| `_stkSupplierReturn` / `_stkDisposal` | from quarantine only; `reason` + `approval_reference` required; ≤ quarantine balance; supplier return raises `STK-CLAIM` follow-up | `:408-436` |
| `_stkStartStocktake` | one open (non-Approved) stocktake per location; `counted_by` required; lines for **every active stock-tracked product** with `expected_quantity_at_cutoff` | `:443-464` |
| `_stkCountLine` | `count_basis` `AtCutOff` (default) or `AtCount`; if movements exist after cut-off, `AtCutOff` is refused; variance ≠ 0 needs a reason and raises `STK-COUNT`; all lines counted → stocktake `Review` | `:473-504` |
| `_stkApproveStocktake` | only from `Review`; one `Adjustment` movement per non-zero variance key `ADJ-<line>`; status `Approved`; completes `STK-COUNT`; repeat approval refused | `:505-536` |

Stocktake states: `Draft → Review → Approved` only. A `Cancelled` status was tried and reverted as unauthorised by the spec (`docs/AGENT_LOG.md`, Batch 13). Reservation states seen: `Active`, `Issued`, `Released`.

Read models: `_stkBalances` (store/quarantine/installed/site/reserved/available), `_stkJobPicking` (default 42-day window, required/reserved/picked/issued/outstanding), `_stkPanelForecast` (`:540-616`).

**Friday panel forecast** (`:586-616`): next two full Monday-weeks after `as_of`; only products with `category === 'Panel'`; bucketed by the roof package's `planned_start` (fallback `need_by_date`); excludes cancelled jobs and cancelled/not-required packages; reports per product `week_1`, `week_2`, `combined`, plus combined totals and actual stock **separately**. Literal note: "Demand forecast only — no order is created from this view (01 §8)."

Invariants: ledger is append-only (no movement is ever edited); quarantine is excluded from availability; installed panels are not stock on hand; picking never moves stock; an issue always consumes exactly one reservation; adjustment only via an approved stocktake.

### 1.3 Scaffold — release R2, gate FN-04

Source `scaffold/workflow.js`; doc `docs/SCAFFOLD-implementation.md`. Statuses (`:15`): `Requested, Confirmed, Erected, StripAuthorised, StripPlanned, StripConfirmed, Stripped, Cancelled`. Complaint categories (`:16`): `MissedAppointment, Access, Damage, UnsafeConcern, Other`. Templates SCA01–SCA05 (`:17-23`).

| Command | Rules and effects | Cite |
|---|---|---|
| `_scfConfigureScaffolder` | refuses names matching `/dev scaffold\|synthetic\|test/i`; `standard_lead_days` integer 0–60; creates/updates Company `type: 'Scaffolder'` (`source_system: 'SCF-config'`) and optional Contact (missing email/phone stored as `NOT_CONFIGURED`). Not FN-04 gated | `:226-255` |
| `_scfRequest` | job must have `scaffold_required`; erect date required; strip forecast ≥ erect; `quoted_cost_pence` non-negative integer; **one active booking per job**; booking `SB-<job>` (later `SB-<job>-R<n>`), revision 1; SCA01 due start of `prevStaffed(erect − lead_days)`; `ScaffoldInstruction` draft | `:259-293` |
| `_scfConfirmErect` | from Requested/Confirmed; `confirmed_revision = revision`; Acknowledgement `ACK-SCF-<booking>-R<rev>`; completes SCA01; SCA02 due erect-day end | `:297-314` |
| `_scfRecordErected` | from Requested/Confirmed; actual date not in future; → `Erected`; completes SCA01+SCA02; returns `late` | `:318-334` |
| `_scfAuthoriseStrip` | blockers: `CUSTOMER_NOT_HAPPY` (no `job.customer_happy_at`), `NOT_ERECTED`, `STRIP_BLOCKING_ISSUES:<ids>` (open Issues with `blocks_strip`); blocked returns status `Blocked` without changing the booking; else → `StripAuthorised`, SCA03 next staffed day 09:00 | `:338-360` |
| `_scfPlanStrip` | only after authorisation; strip ≥ actual erect; revision+1; → `StripPlanned`; `ScaffoldStripInstruction` draft | `:364-379` |
| `_scfConfirmStrip` | from StripPlanned/StripConfirmed; acknowledgement; completes SCA03; SCA04 due strip-day end | `:383-400` |
| `_scfRecordStripped` | needs authorisation and an actual erect; not future; optional `actual_cost_pence`, `invoice_reference`; → `Stripped`; returns still-open complaints — **never closes them** | `:404-425` |
| `_scfChangeDates` | reason required; erect cannot move once erected; strip only after authorisation; revision+1; `Confirmed → Requested`, `StripConfirmed → StripPlanned`; new SCA01/SCA03 instance and new instruction draft per revision | `:429-457` |
| `_scfCancel` | refused when erected and not stripped: "arrange safe strip and confirm removal instead of cancelling"; cancels open tasks; `ScaffoldCancellation` draft | `:461-477` |
| `_scfComplaint` | Issue `type: 'Complaint'`, responsible company = scaffolder; severity defaults `High` for UnsafeConcern; `blocks_strip` defaults true only for UnsafeConcern | `:481-507` |
| `_scfChase` | planned erect/strip date passed without an actual → `SCA02`/`SCA04` `-CHASE` instance, once per booking revision | `:511-531` |
| `_scfWeeklyList` | next week's erects + **authorised** strips per company; one `ScaffoldWeeklyList` draft per company/week; SCA05 due Friday 12:00 London. Week start = Monday on/before; a Sunday rolls forward | `:536-568` |

Read models `_scfBookingView` (with `next_action` text and `acknowledgement_required = confirmed_revision < revision`, `:572-592`) and `_scfPlannerRows` (kinds `Erect | Strip | StripForecast`, `:594-608`).

Invariants: planned / confirmed / actual are distinct fields; any date move is a new revision needing re-acknowledgement; erected scaffold can never be cancelled; strip requires customer happiness and no strip-blocking issue; synthetic scaffolders cannot serve real jobs (`:101-107`).

### 1.4 Installer mobile workflow, completion outcomes, remedials, commissioning — release R3, gates FN-06 (installer), FN-07 (review)

Source `installer/workflow.js`, `r1-appsheet/operations-contract.js`, `s12/commissioning.js`; doc `docs/INSTALLER-implementation.md`.

Enums (`installer/workflow.js:16-24`): outcomes `Complete | ReturnRequired`; problem categories `Access, Damage, Technical, Safety, MaterialsShort, Other`; evidence categories `Progress, Completion, Commissioning, Problem, Variation, Return`; module task defaults BKG02 (Office), REM01 (Office), ISS01 (`VariationApprover`), ISS02 (Office). **REM01, ISS01 and ISS02 are not in the seed** (seed has 28 templates: BKG01–05, FIN01, FIN03, GHL01, INS01–02, MAT01–06, PRE01–05, SCA01–05, SYS01–02); the installer module tolerates a missing template and uses its defaults (`:87`).

WorkPackage statuses per the header comment (`:2-3`): `Unscheduled, Scheduled, InProgress, ReportedComplete, ConfirmedComplete, ReturnRequired, Cancelled`. Submission statuses: `Draft, Submitted, UnderReview, Returned, Accepted`.

**Authorization** (`:57-63`): actor must be an active People id; allowed if they hold an active allocation on the package; Office/Manager/Admin may act only with a `reason`; otherwise `IW_REFUSED: actor is not allocated to this work package`. The cloud entry point derives the actor from the signed-in session email and ignores any client-supplied actor (`installer/cloud-adapter.js:19,27-34`).

| Command | Rules and effects | Cite |
|---|---|---|
| `_iwMyWork` (read) | active allocations only; excludes cancelled packages/jobs; returns site address + phone, commissioning state, evidence count, open issues, own tasks; literal `excluded: ['finance','invoices','private issue notes']` | `:121-144` |
| `_iwStart` | from Scheduled/InProgress/ReturnRequired → `InProgress`; first `actual_start` = London today | `:148-158` |
| `_iwProgress` | note or evidence required; audit-only plus Progress evidence | `:159-168` |
| `_iwReportCompletion` | `outcome`, `actual_end` (not future) required; `return_reason` required for ReturnRequired. **Complete** → `ReportedComplete` + commissioning Draft `CS-<wp>` when `commissioning_required` (`template_version` defaults `NOT_CONFIGURED`). **ReturnRequired** → package `ReturnRequired`; return package `<wp>-RET<n>` with the **same trade**, `parent_package_id`, `status: 'Unscheduled'`; dateless Lead allocation for the original installer; Issue `type: Remedial, category: ReturnRequired`, `blocks_completion: true`, `linked_return_package_id`; tasks REM01 + BKG02 (next staffed day 09:00) | `:172-214` |
| `_iwReportProblem` | Issue `type: Remedial`; `blocks_completion` defaults true for Safety/Technical; severity `High` for Safety; ISS02 task | `:218-231` |
| `_iwReportVariation` | Issue `type: Variation`, `approval_status: 'Pending'`, `blocks_completion: false`, owner = `VariationApprover`; due same/next staffed day 17:00; `estimated_value_pence` non-negative integer; ISS01 task | `:232-244` |
| `_iwSaveCommissioningDraft` | answers or evidence required; refused if an Accepted submission exists or one is Submitted/UnderReview; a `Returned` form is **never edited** — a new draft `CS-<wp>-v<n>` with `supersedes_submission_id`; answers upserted `<sub>-A-<question_key>` | `:249-282` |
| `_iwSubmitCommissioning` | only Draft; needs ≥ 1 answer or evidence; → `Submitted`, `submitted_at`; returns `immutable: true` | `:283-295` |
| `COMMISSIONING_REVIEW` | Office/Manager/Admin + FN-07; submission must be Submitted/UnderReview; status `Accepted \| Returned`; `review_notes` required; **Accepted refused unless the submission's `template_version` is an active template for that trade with `approved_by` and `approved_at`** (`R1C_APPROVED_TEMPLATE_REQUIRED`) | `r1-appsheet/operations-contract.js:90-98` |

Evidence rule (`installer/workflow.js:100-117`): id `EV-IW-<wp>-<hash(drive_file_id)>`; deduped per file per package; a file already linked to another job → `IW_REFUSED: evidence file already linked to another job`. The boundary scans the whole Evidence table (`operations-contract.js:99-104`).

Reporting completion never confirms it: `ConfirmedComplete` comes from the office INS01 call in S10 (`installer/workflow.js:10,194`).

Request-row boundary (`r1-appsheet/operations-contract.js`): 10 commands `IW_START, IW_PROGRESS, IW_REPORT_COMPLETION, IW_REPORT_PROBLEM, IW_REPORT_VARIATION, IW_COMMISSIONING_DRAFT, IW_COMMISSIONING_SUBMIT, COMMISSIONING_REVIEW, GOODS_IN_RECEIVE, STOCK_QUARANTINE` (`:5-16`); 3 reads `INSTALLER_WORKFLOW, GOODS_IN_DETAIL, STOCK_BALANCE` (`:17`). Roles: goods-in `Store|Office|Manager|Admin` + FN-03 + FN-05; quarantine `Store|Manager|Admin` + FN-05; installer commands `Installer|Office|Manager|Admin` + FN-06 (`:40-66`). Unknown payload keys are refused (`R1C_INVALID_FIELDS`); `command_id` must match `^[A-Za-z0-9_-]{1,128}$`; the fingerprint includes the actor; validation runs against a buffered store so a late failure writes nothing; an incomplete flush marks the journal `RecoveryRequired` and blocks all further R1C commands (`:151-183`). Draft answers must match an approved question (`R1C_APPROVED_QUESTION_REQUIRED`, `:120-128`). Installer responses are whitelisted to strip office/finance fields (`:178`).

R1 office-recorded commissioning template (`s12/commissioning.js:147-187`): version `R1-OFFICE-MANUAL-1.0`, id `CT-R1-OFFICE-<trade>`, `approved_by`/`approved_at` deliberately null so it can never satisfy the R3 approved-template check.

### 1.5 Calendar — release R2, gate FN-02

Source `calendar/service.js`; doc `docs/CALENDAR-implementation.md`. Drains Outbox rows with `action_type` `CalendarCreate | CalendarUpdate | CalendarCancel` (`:22`) produced by S11 planning and S15 cancellation.

Constants (`:23-28`): max attempts **5**; backoff minutes **[1, 2, 4, 8, 16]**; stalled after **15** minutes; tag `[SSO:<calendar_link_id>]`; batch 20 (cap 200).

Event shape (`:168-179`): one **all-day** event per allocation; title `<job display_name> — <trade>` (from S11, `s11/planner.js:40`); end date is exclusive (allocation end + 1 day); description lines: tag, `Job:`, `Work package:`, `Revision:`; `guests: []`.

Per-row algorithm (`:243-300`): mark Outbox `Processing` and `attempt_count + 1` **before** the external call; on a retry with no stored id, search by tag and adopt a single match (two matches → `DUPLICATE_EVENTS` review); update with a vanished event → `EVENT_MISSING` review (never a silent recreate); result without an id → `UNCERTAIN_OUTCOME` review; cancel with no external id → Succeeded `NO_EXTERNAL_EVENT`; cancel of an already-removed event → Succeeded `ALREADY_REMOVED`; exceptions → `RetryDue` with backoff, then `MAX_RETRIES_EXCEEDED`.

Outbox states used: `Pending, Processing, RetryDue, Succeeded, NeedsReview, Cancelled`. CalendarLinks states: `Pending, UpdatePending, Active, Error, Cancelled`.

Human resolution `_calResolveReview` (`:482-514`): `AdoptEvent` (needs `external_event_id`), `MarkCancelled`, `Retry`, `RetargetDev`; `reason` required; idempotent per `command_id`.

Drift detection `_calDetectDrift` (`:431-478`): for Active links with an external id and no queued work, compares start/end/title; on any difference writes `CalendarLinks.error = 'EXTERNAL_EDIT: …'`, opens one `CAL-DRIFT` task per link revision (group `System`, title "Review calendar event changed outside the system"), audits `CalendarExternalEdit` once. It **never rewrites the event and never moves the job**.

Modes: `calendarMode` `CAPTURE` (default, sends nothing) or `LIVE` (`:93-100`). Only the hardcoded DEV calendar id is addressable (`:21,101-107`). One shared calendar; `People.calendar_id` is not consulted (`:7-8`).

### 1.6 Resource planning and the planners — R1 (planner reads, S11) with R2 calendar adapter

Source `resource/planning.js`, `s11/planner.js`, `r1-appsheet/adapter.js`; doc `docs/RESOURCE-implementation.md`.

Enums (`resource/planning.js:14-19`): skills `Roof | Electrical`; team trades `Roof | Electrical | Mixed`; member roles and skill levels `Lead | Member | Apprentice`; availability `Leave | Sick | Training | Unavailable | Available`; config roles `Admin | Manager | Office`. Four additive tables: PersonSkills, PersonAvailability, Teams, TeamMembers. **Absence of rows means no constraint.**

Commands (config actor required, `:54-61`): `_rpSetSkill` (installers only, id `SK-<person>-<skill>`, `:98-113`); `_rpSetAvailability` (returns overlapping active allocations as `allocation_conflicts` / `replan_required`; type `Available` never conflicts, `:124-141`); `_rpCancelAvailability` (reason required, sets `active:false`); `_rpUpsertTeam`; `_rpSetTeamMember` (**one active Lead per team**, `:178-181`).

Readiness reasons (`:207-234`): `INSTALLER_INACTIVE_OR_WRONG_ROLE`, `CAPACITY_NOT_CONFIGURED` (`capacity_per_day` must be integer ≥ 1), `INSTALLER_UNAVAILABLE` (`available_from/to`), `SKILL_MISMATCH` (only when the person has skills configured), `ON_LEAVE`, `OFFICE_HOLIDAY`, `CAPACITY_CONFLICT` (active allocations on a staffed day ≥ capacity). Warnings: `CERTIFICATION_EXPIRES_BEFORE_END`, `APPRENTICE_NEEDS_SUPERVISION`. Ranking: ready first → Lead/Member/Apprentice → least load → name (`:246-252`). S11 enforces the same rules authoritatively at commit and returns `status: 'NeedsReview'` with the reason (`s11/planner.js:35-39,152-154`).

`_rpMoveJobPreview` (`:284-323`): activities `Roof | Electrical | Scaffold`; per-person readiness at new dates, preserved packages, affected calendar links, material flags `NEED_BY_AFTER_NEW_START` / `DELIVERY_WELL_BEFORE_NEW_START` (> 14 days early), scaffold impacts and re-acknowledgement; `ok_to_move = conflicts === 0`. `_rpTeamPlanner` also lists `unassigned_installers` and `unallocated_work` (`:327-354`).

**`PLANNER_3_WEEKS` / `PLANNER_6_WEEKS`** (`r1-appsheet/adapter.js:144-148,235`): Office-role-only reads (`R1A_ROLE_DENIED` otherwise); `weeks = 3` or `6`; start = `as_of` or London today; delegates to `_s11BuildPlanner(store, start, weeks)`. The builder (`s11/planner.js:167-186`) window is `start .. start + weeks*7 − 1` inclusive; it is a **left join from WorkPackages** (planned dates overlapping, status ≠ Cancelled) to active Allocations, so booked but unallocated work appears as one row with `allocated:false`; a null allocation date falls back to planned dates; rows carry `job_id_human` and `job_display`. It also returns a `scaffold` array (Erect/Strip/StripForecast with `acknowledged`, `confirmed`, `actual_recorded`). The planner is not person-scoped.

S11 mutations (for context): `planWorkPackage`, `moveWorkPackage` (reason required), `changeInstaller` (`mode` `Replace | Add`, reason required; Add role default `Second`); each bumps `WorkPackages.revision` and queues a calendar Outbox row; Replace deactivates the old allocation and queues `CalendarCancel` for its link (`s11/planner.js:152-166`).

### 1.7 Backup — R1 foundation, FN-14

Source `backup/service.js`; doc `docs/BACKUP-implementation.md`. `_bkExport` writes one JSON file `SSO-DATA-BACKUP-<id>.json` of every schema table to `S01_CONFIG.backupFolderId` plus a `ReportSnapshots` manifest `report_type: DataBackup` (`:14-18,69-80`); `_bkVerify` reads back and recomputes checksum/counts; `_bkCompare`; `_bkRetentionReview` (lists, never deletes); `_bkRestoreRehearsal` writes a Verified backup into a **new** spreadsheet, requires `restoreMode === 'REHEARSAL'` and the literal token `RESTORE_TO_NEW_SPREADSHEET`; `_bkRestoreInPlace` is refused by construction. Without a folder: `NOT_CONFIGURED`, nothing written.

### 1.8 Xero adapter — R4, FN-09, **disabled by default**

Source `xero/adapter.js`; doc `docs/RESILIENCE-implementation.md`. Stage codes (`:14`): `Deposit: DEP, Interim: INT, Balance: BAL, Final: BAL, Variation: VAR, Finance: FIN, RefundReview: REF`. Max attempts 3 (`:15`).

- Envelope (`:38-52`): `reference = <human job_id>-<code>` e.g. `SS-0001-DEP`; `create_as: 'DRAFT'`; amounts in integer pence; blockers `ALREADY_LINKED:<id>`, `CONTACT_NOT_CONFIGURED`, `ZERO_AMOUNT`.
- `_xoDispatch` (`:62-90`): returns `DISABLED` with no writes unless `xeroMode === 'LIVE'`; then requires FN-09 Automated/Pilot and an **injected `transport` function** — "this module never invents a Xero endpoint". With a transport: Processing first, store `request_id`, accepted → Succeeded awaiting callback, timeout/uncertain → NeedsReview (never blind retry), transient → RetryDue `2^attempt` minutes.
- `_xoInvoiceCallback` (`:94-112`): idempotent; maps `AUTHORISED→Authorised, PAID→Paid, VOIDED→Voided, else Draft`; a conflicting id for a linked stage → review; a `Confirmed` (bank-checked) stage keeps its status.
- `_xoPaymentCallback` (`:113-128`): Payments `PAY-XERO-<payment id>` status `Reported`; stage → `PartPaid`/`Paid` by sum vs gross; returns `manual_bank_check_touched: false`.
- `_xoReviewCancelInvoice` (`:132-145`): creates a `XO-REVIEW-CANCEL` task; never deletes; action text depends on invoice status.

---

## 2. Complete and tested vs partial vs stubbed

| Area | Local code + tests | Ever run in the cloud | Stubbed / off by default |
|---|---|---|---|
| Materials (incl. revision-aware replies) | complete, 24 tests | **No** (`docs/MATERIALS-implementation.md:3`) | merchant email never sent; FN-03/05 Disabled |
| Stock ledger | complete, 24 tests | first DEV smoke ran and was interrupted (run `20260917143225`); redesigned smoke **not redeployed** (`docs/STOCK-implementation.md:3,98-105`) | FN-05 Disabled; **no UI or request-row commands** for reserve/pick/issue/panel use/stocktake/returns |
| Goods-in + quarantine via request rows | complete (appsheet-operations 21 tests) | No | — |
| Scaffold | complete, 23 tests | No | sends Draft only; scaffolder external view/ack form not built; legacy sheet import not built |
| Installer workflow | backend complete, 9 tests + ops tests | No | installer screens, offline drafts, photo upload UI not built; **no approved commissioning templates/questions exist** (`NOT_CONFIGURED`) |
| Commissioning review | boundary complete | No | Accept is impossible until an approved template exists |
| Calendar | complete, 29 tests | **No real Calendar call ever made** (`docs/CALENDAR-implementation.md:3,93`) | `CAPTURE` default; DEV calendar hardcoded; no guests; scaffold calendar links not queued |
| Resource planning | backend complete, 12 tests | No | AppSheet UI for skills/leave/teams, Move Job and Change Installer journeys open (`docs/AGENT_BACKLOG.md:11-18`) |
| Planner 3/6 weeks | complete (s11 28 tests, bridge-planner 4) | S11 DEV cloud not run | — |
| Backup | complete, 10 tests | No | structurally DEV-only; in-place restore absent by design |
| Xero | adapter logic complete, 5 tests | No | **no transport, no endpoint, no HTTP client**; `xeroMode` must stay unset |
| Legacy first-pass modules `s07`, `s08/picking.js`, `s09` | still present, tested | S07 and S09 DEV happy path passed | superseded by materials/stock/scaffold; `executePick` retirement undecided (`docs/AGENT_BACKLOG.md:63`) |

Full suite today: **1012 tests, 1012 pass, 0 fail**.

---

## 3. R1 / R2 / R3 / R4 boundary (`docs/release-plan.md:15-20`)

Default order R1 → R2 → R3 → R4. R3 and R4 may swap only with Ben's written approval. Each release = build → `R?-S18` acceptance → `R?-S19` migration/training → Ben go-live approval → `R?-S20` controlled pilot → Ben expansion acceptance. All releases are currently **BLOCKED**.

| Release | Includes | Depends on | Retained manual routes |
|---|---|---|---|
| **R1 Office** | S01–S06; office/manual parts of S09–S13 and S15–S17; three-/six-week planners, multi-day moves, replacement/additional installers (from S11); calls/issues/reminders/completion (S10); external evidence and finance **task tracking** (S12/S13); cancellation/reinstatement; office screens; backups + demonstrated restore; health | G01, foundations | existing Jotform Calendar creator with Tanya's update/reassign/delete tasks; existing merchant/order email; existing scaffold sheet; physical/store stock; current forms/files and reviewed evidence; existing invoice/Xero route; Phoenix owners; human GHL; existing handover. Installer/scaffolder app access denied |
| **R2 Materials/scaffolding** | S07–S09 (ordering incl. Other / already-ordered / stock sources, split delivery dates, latest-revision confirmations); full covered-location stock movements, picking/returns/damage/stocktake; scaffold confirmation/actual strip/complaints; **Calendar adapter** cutover | R1 controls | keep R1 Calendar tasks until adapter cutover passes; evidence capture and handover as-is until R3; office/store enters actual panel counts from roofing notes; finance existing until R4; GHL human. If whole-location stock cannot reconcile, keep manual stock and leave the balance feature Disabled |
| **R3 Installer commissioning** | S12 + extensions to S10, S15–S17: assigned jobs, drafts/uploads/offline/sync, required answers, variations, submission/review/correction, historical installer responsibility | R1/R2; **a separate approved commissioning amendment** (questions, photos, checks, reviewers, return work, handover) | current accepted evidence stays valid, no blanket resubmission; in-progress jobs keep their route; existing handover until replacement accepted; PDF presentation separately accepted; finance existing; GHL human |
| **R4 Finance/reporting** | automated S13, S14, rest of S16–S17: Zapier/Xero requests/callbacks/drafts/reconciliation; account/tax/recognition/cost rules; opening balances; reports; six-month archive/restore | R1/R2 (+R3 normally) | adopt existing invoice IDs; manual fallback; **Ben's bank check stays manual and independent in every release**; GHL human; no purging until archive accepted |

Functions that stay `Manual` in every release per `integration-inventory/release-ownership-modes.csv`: FN-11 GHL progression, FN-15 bank deposit confirmation, FN-16 daily health review, FN-17 GHL cancellation, FN-18 missing-form reminder, FN-19 operational completion approval, FN-20 customer/installer notices (R1 tracked manual sends; later automation needs separate approval). FN-10 Phoenix is planned Manual at R4.

Coexistence rules (`docs/release-plan.md:43-47`): no two creators for the same scope; sent / received / accepted / confirmed are distinct; an old acknowledgement cannot satisfy a newer revision; a partial ledger cannot claim total stock.

---

## 4. External integrations as business requirements

| Integration | What the business needs | Google-/platform-specific mechanics (do not port) |
|---|---|---|
| **Calendar** | one all-day entry per installer allocation; created once, updated on move (same event), removed on installer replacement or cancellation; the job system owns the dates; an event edited or deleted by hand becomes an owned office review and is never imported as a job move or silently overwritten; uncertain outcomes are visible and human-resolvable (adopt / mark cancelled / retry); evidence of cutover (every live link has an external id) | `CalendarApp`, tag search in description, hardcoded DEV calendar id, allowlist in Script Properties, project time-zone pinning, `RetargetDev` |
| **File/evidence storage** | photos and delivery notes attached to a job, categorised, attributed (who/when), linked to a submission or issue; a file can belong to one job only; each commissioning version keeps its own evidence links; installers never see finance or private issue data; `customer_shareable` flag | Drive file ids, AppSheet relative upload paths, the `R1C_UPLOAD_PENDING` race and its retry sweep, `evidenceFolderId` |
| **Email (merchants, scaffolders)** | an immutable, revision-numbered record of exactly what was instructed (order, amendment, cancellation, Friday list, scaffold instruction/strip/cancellation/weekly list), the recipients at that moment, and a separate record of the supplier's acknowledgement **of that revision**. Actual sending is not implemented anywhere — today Tanya sends manually and records the outcome | `Communications` rows as Draft, `OutboundGuard` allowlist |
| **Xero (via Zapier)** | one draft invoice per stage referenced `<Job ID>-<stage code>`; store returned ids; payments arrive as `Reported` and never count as Ben's bank confirmation; never delete an authorised/paid invoice — raise a review task; uncertain outcomes go to a human, not a retry | injected transport, `xeroMode`, Outbox intents |
| **Jotform** | source of Sold and Booking intake (out of this domain); the booking form's material quantities map to products through `config/booking-product-map.example.json`. Every `product_id` there is `NEED_APPROVAL` — nothing is approved. `authoritative_total: true` rows plus `skip_component_when_authoritative_total_present: true` mean the two Renusol hook **totals** are used and their portrait/landscape components are skipped (`s05/booking-apply.js:208-253`). Real Jotform question mappings are `NOT_CONFIGURED` (`docs/implementation-status.md:13`). Jotform also currently creates Calendar entries — that producer must be retired per scope at R2 cutover | — |
| **GHL** | always a human task in every release; no API call exists | — |

---

## 5. Test suite map

Run: `npm test` = `node --test tests/*.test.cjs` (Node ≥ 22, zero dependencies, no network). Per-module scripts `npm run test:<module>` first run the matching `build:<module>` generator. Tests use an in-memory store with the same `list/get/insert/update` interface as the Sheets adapter. Registers (not executable): `tests/test-register.csv`, `original-case-register.csv` (T001–T112), `original-assertion-plan.csv`, `release-test-plan.csv` (RT01–RT08, all NOT RUN), `defects.csv` (**header only — no defects logged**).

| File | Tests | Behaviour proven |
|---|---|---|
| `materials.test.cjs` | 24 | delivery-date rule and worked example; requirement defaults; AlreadyOrdered→MAT02 / Stock→MAT03; orders per merchant+work type; immutable send snapshot; confirm/ack/delivery; urgent revision; receipt good→store, damaged→quarantine exactly once; Other lines make no movement; cancel rules; Friday list idempotent; refusals write nothing; stale supplier reply retained but refused; smoke isolation |
| `stock.test.cjs` | 24 | T048–T058: opening once; quarantine excluded; reserve/pick leave stock untouched; issue once; panel counts reconcile then one Install/Return/Damage set; approved supplier return only; concurrent demands cannot both pass; stocktake variance/approval once; one open stocktake; receipt during count counted once; two-week forecast; SKU substitution refused |
| `scaffold.test.cjs` | 23 | scaffolder config; SCA01 lead-time due date; refusals; confirm/erect/late; strip gated by customer happy + blocking complaints; complaint survives strip; date move = new revision; erected cannot cancel; chase once per revision; weekly list idempotent; BST/GMT instants |
| `installer.test.cjs` | 9 | assigned-work-only read with no finance; office needs a reason; evidence dedupe and cross-job denial; Complete never confirms; ReturnRequired → remedial + same-trade return package + original installer kept; problem/variation owners; immutable submit and superseding draft; session-derived actor |
| `appsheet-operations.test.cjs` | 21 | request-row boundary: actor forgery, extra fields, replay, conflicting content, stale version, no partial writes, cross-job files, review denied to installers, approved-question rule, multi-line goods-in, quarantine role/version/balance, incomplete flush → RecoveryRequired. **Rewrites four bundles in place.** |
| `upload-retry.test.cjs` | 14 | bounded retry for the AppSheet upload race (platform plumbing) |
| `calendar.test.cjs` | 29 | CAPTURE sends nothing; create persists id; no duplicates; reconcile by tag; backoff 1/2/4/8/16 → review; update same event; vanished event → review; replace installer deletes old + creates new; safe cancels; non-DEV target refused; stalled recovery; duplicate tags → review; review resolutions; external edit → CAL-DRIFT, never a job move |
| `resource.test.cjs` | 12 | skills/leave/teams rules; single Lead; assessment and ranking; S11 leave/skill aware, missing tables fail open; change-installer options; Move Job preview; team planner |
| `s11.test.cjs` | 28 | plan/move/change installer; capacity, holiday, availability refusals; **planner 01–12**: unallocated work visible, 3- vs 6-week windows, inclusive boundaries, no duplicates, cancelled excluded, null-date fallback, read never mutates |
| `bridge-planner.test.cjs` | 4 | PLANNER_3_WEEKS/6_WEEKS identical through both bundles; installers and unknown users refused |
| `backup.test.cjs` | 10 | export/verify/compare/rehearsal; in-place restore refused |
| `resilience.test.cjs` | 11 | unified review queue, RS-REVIEW/RS-ALERT tasks, outbox resolution; XO 01–05 Xero envelopes, disabled dispatch, idempotent callbacks, never touches bank checks, review task instead of delete |
| `s12.test.cjs` | 15 | submission/answers/review/equipment/handover; R1 office template can never satisfy the R3 approved-template check |
| `s07/s08/s09.test.cjs` | 20/11/10 | first-pass ordering, pick-and-issue, scaffold booking (superseded) |
| `s18.test.cjs` | 27 | acceptance framework incl. R2 invariants STK-01–05, MAT-01, SCF-01, CAL-01/02 and cumulative inheritance |
| `s19.test.cjs`, `s20.test.cjs` | 19/21 | migration/training registers; fail-closed release authorization |
| `s16.test.cjs`, `s16-heartbeat.test.cjs` | 41/16 | health, backup manifest, archive eligibility; heartbeat Fresh/Stale/Failing/Quiet/Never |
| `s15.test.cjs` | 18 | cancellation/reinstatement reconciliation across orders, reservations, scaffold, calendar |
| `s17.test.cjs` | 29 | office home, job overview, queues, action availability |
| `s13.test.cjs`, `s14.test.cjs` | 13/14 | 25/35/40 stages, interim Friday, financial completion, reconciliation |
| `s10.test.cjs` | 21 | INS01/INS02 scheduling, calls, issues, completion gates |
| `s05.test.cjs`, `s06.test.cjs`, `r1-office-journey.test.cjs` | 36/30/14 | Sold/Booking intake, booking gates, task generation, office journey |
| `r1-appsheet.test.cjs` | 120 | R1 adapter reads/commands, identity, role gates |
| `command-result.test.cjs` | 6 | staff-readable outcome messages; an Apps Script success is not business success |
| `processor.test.cjs`, `s04*.test.cjs` (6 files) | 33 / 88 | durable Complete Task processor, signed actor, replay/conflict, G04 negatives |
| `schema.test.cjs`, `provisioner.test.cjs`, `drift.test.cjs`, `apps-script-adapter.test.cjs`, `manifest.test.cjs`, `outbound.test.cjs` | 16/32/14/5/3/12 | schema integrity, Sheets provisioning, embedded-data drift, bundle manifest, outbound allowlist (plumbing) |

**Most valuable to port as acceptance specs** (they encode business rules independent of the platform):
1. `materials.test.cjs` MAT 01–13 and MAT 23 — date rule, order splitting, revision/acknowledgement, receipt, stale reply.
2. `stock.test.cjs` STK 01–14 — the whole T048–T058 chain, especially STK 07 (concurrency) and STK 09 (cut-off).
3. `scaffold.test.cjs` SCF 02–11, 15 — lifecycle, strip gates, erected-cannot-cancel, BST/GMT.
4. `installer.test.cjs` IW 01–08 and the forgery/replay/no-partial-write cases in `appsheet-operations.test.cjs`.
5. `calendar.test.cjs` CAL 03–15, 18, 22, 23 — against a fake calendar adapter.
6. `s11.test.cjs` planner 01–12 and `resource.test.cjs` RP 02–08.
7. `resilience.test.cjs` XO 03–05.
8. `s18.test.cjs` R2 invariants as database-level health checks.

Do not port: every `bundle —`, `zero-arg cloud simulation`, smoke-isolation, fixture-retirement, pinned-recovery, manifest, drift, provisioner, apps-script-adapter and upload-retry test.

---

## 6. Business semantics to preserve vs platform plumbing not to port

**Preserve**
- Revisioned instructions with per-revision acknowledgement; stale acknowledgements retained but powerless.
- Immutable communication snapshots including recipients at the time.
- Sent / received / accepted / confirmed as distinct facts; planned / confirmed / actual as distinct dates.
- Append-only stock ledger with derived balances; available = store − active reservations; quarantine excluded; pick ≠ issue; reconcile-before-accept; approved adjustment only.
- The delivery-date, Friday-list, lead-time-risk and staffed-day/London-time due-date rules, and every task code's due rule.
- Tasks as the unit of owned follow-up: dedupe by instance key, owner + backup, supersede rather than delete.
- Idempotent commands with client-generated ids (needed for offline mobile resubmission), conflicting-content refusal, optimistic versions.
- Audit trail with before/after, actor and reason.
- Actor derived from the authenticated session, never from the payload; role and allocation checks; installer data minimisation.
- Cancellation suppresses normal work; erected scaffold must be stripped; received orders cannot be cancelled.
- Outbox pattern for external effects: mark in-flight first, reconcile before retry, bounded retries, human review for uncertainty, never blind retry of money or calendar actions.
- Per-function release modes and pilot-job scoping (the business will roll out function by function).
- Report-then-confirm completion; return visits keep the trade and the original installer; variations go to the approver.
- Commissioning versions immutable; acceptance only against an approved template; no invented questions.

**Do not port (and why)**
- **Backup-to-Drive JSON, verify, rehearsal spreadsheet** — exists because a Google Sheet has no transactions, PITR or dumps. Postgres/Supabase backups and PITR replace it. Keep only the *requirement*: a demonstrated, rehearsed restore before R1 and a health indicator for last successful backup.
- `CommitJournal` Prepared/Committed and `RECOVERY_REQUIRED` — a substitute for database transactions. Replace with a real transaction plus a unique idempotency-key table.
- Buffered store + flush, `LockService`, `SpreadsheetApp.flush`, header checks, formula-injection cell escaping, row-capacity checks.
- Product "version pinning" as a concurrency trick — use row locks or a constraint; keep the *outcome* (STK 07).
- Hardcoded DEV sheet/calendar ids, `S01_CONFIG` Script Properties, `CAPTURE`/`LIVE` strings, `RetargetDev`.
- AppSheet request-row tables (`DEV*Requests`), `Ready/Done/Error` bot protocol, one-answer-per-row drafts, `line_count` parent/child barrier, upload-availability race and retry trigger, result-column writer.
- Bundle generators, `apps-script/` outputs, manifest SHA-256s, namespacing prefixes, embedded schema/seed drift checks, additive tab provisioning.
- All smoke fixtures, fixture retirement, pinned one-off recovery (`runStkRecoverSmokeRun20260917143225`), `run*EnableFor…SyntheticTest` / `restore*SafeState`.
- Deterministic string ids (`ORD-<job>-<merchant>-<type>` etc.) — use real keys plus unique constraints expressing the same rule (one draft order per job+merchant+work type; one active booking per job; one opening per product+location; one panel report per package+product).
- Owner lookup by `display_name` containing "tanya" — replace with explicit role/owner configuration.

---

## 7. Known incomplete or buggy in the reference

- **Nothing in this domain has passed in the cloud.** Every module is "LOCAL IMPLEMENTATION PASS / DEV CLOUD NOT YET RUN" (`docs/implementation-status.md:29-36`); the walkthrough says every step is PENDING (`docs/DEV-integration-walkthrough.md:3`). All releases BLOCKED; R1 "NOT RELEASE READY" (`:39`). Note the status file header says "Updated 6 September" but contains entries to 17 Sep, and `release-plan.md:3` still quotes S04 as not cloud deployed, contradicting the status table.
- Interrupted DEV stock smoke left residue: an open Draft stocktake `ST-SS-20260917131614-ST` and fixtures from two runs remain "pending a decision" (`docs/AGENT_LOG.md`, Batch 13).
- Calendar bundle defect found and fixed locally only: `CAL_HEADERS` lacked `Tasks`/`TaskTemplates`, so drift detection would have failed after patching the link (`docs/CALENDAR-implementation.md:102`). All-day dates depend on the project time zone being Europe/London (`:103`).
- `_calDispatch` runs stalled-row recovery across **all** calendar rows before applying `only_outbox_ids` (`calendar/service.js:334-335`; noted `docs/CALENDAR-implementation.md:100`).
- Stale generated bundles `apps-script/s16/S16Health.js` and `apps-script/s19/S19Migration.js`; no test detects it (`docs/AGENT_LOG.md`, Batch 12).
- S11 Move Job still maps a `Return` activity to a `ReturnVisit` trade string, outside the confirmed Roof/Electrical constraint; the installer module uses same-trade return packages instead (`docs/AGENT_LOG.md`, Batch 2b). These two disagree.
- Materials wording gap: amended orders say "(AMENDED)" / "URGENT amendment", not the spec's "URGENT UPDATE – delivery Thursday [date]" (`docs/MATERIALS-implementation.md:91`).
- Materials quirk: a fully cancelled requirement with no order line still reads `ToOrder` with quantity 0 (`docs/MATERIALS-implementation.md:68`).
- `_matReceiveDelivery` does not call the version check even though the boundary supplies the order's `expected_version`; concurrency relies on the R1C boundary (`operations-contract.js:163`) — direct callers are unprotected. Same for `_iwProgress`, `_iwReportProblem`, `_iwReportVariation`, `_iwSaveCommissioningDraft` (the boundary compensates by bumping the package version, `:175`).
- `s12 reviewSubmission` has no state guard of its own (`s12/commissioning.js:73-85`); the guard exists only in the boundary (`operations-contract.js:92`).
- REM01/ISS01/ISS02 and STK-*/RS-*/CAL-DRIFT/XO-REVIEW-CANCEL task codes are not seeded templates; titles are hardcoded module defaults.
- `_scfAuthoriseStrip` commits the journal on a `Blocked` outcome (`scaffold/workflow.js:353`), so retrying the same `command_id` after the blocker clears replays instead of authorising — a new command id is needed.
- Legacy `s07`/`s08`/`s09` coexist with the new modules; `s07` marks materials `AlreadyOrdered` after ordering, a different model from the new `order_line_id` linkage.
- Doc/code drift: upload wait documented as "0/2/6/12 s", code is `[2000,4000,6000]` ms (`r1-appsheet/operations-requests.js:33`); doc test counts lag (e.g. `docs/CALENDAR-implementation.md:3` says 21 tests and `docs/implementation-status.md:29` says 23, while `tests/calendar.test.cjs` has 29; `docs/INSTALLER-implementation.md` and the status table agree on 9).
- `tests/defects.csv` is header-only: no defect has ever been formally logged.

---

## 8. Open questions and ambiguities

1. **Product catalogue**: all 33 booking-map materials and both equipment entries are `NEED_APPROVAL`; only `PROD-P460` and `PROD-P515` exist. Who approves SKUs, units and default suppliers? Should non-panel items be stock-tracked at all (the forecast is panel-only by `category === 'Panel'`; `panel_m_class` has no product)?
2. **Stocktake scope**: the spec does not narrow a stocktake's product list; the reference lists every active stock-tracked product at one location. Is a partial/cycle count needed? Is there any way to abandon a stocktake (none exists; `Cancelled` was rejected)?
3. **Multiple stores / locations**: code assumes a single `LOC-store` and `LOC-quarantine`. Deliveries always go to `LOC-store` (`delivery_address: null`); direct-to-site delivery is not modelled.
4. **Return-visit modelling**: same-trade child package (installer module) vs `ReturnVisit` trade (S11 Move Job) — which is canonical?
5. **Commissioning content**: no templates, questions, photo categories, thresholds or reviewers are approved; R3 cannot be accepted until the separate amendment exists. `required_when`, `review_rule`, `allowed_values` columns exist but nothing evaluates them.
6. **Who counts panels**: R2 says office/store enters counts from roofing notes; R3 implies the roofer does. `_stkReportPanelUse` takes a free-text `reported_by` and has no role check.
7. **Approvals are free text**: `approval_reference`, `approved_by`, `reviewed_by`, `counted_by`, `received_by` are unvalidated strings in the stock module — no role gate on who may approve a stocktake, disposal or supplier return.
8. **Sending**: no send path exists for any merchant/scaffolder communication. Is R2 expected to send email, or remain "draft + Tanya sends + records outcome"? `approved_at/approved_by` on Communications are never set.
9. **Calendar**: single shared calendar and no guests were DEV decisions; production intent (per-installer calendars? invite installers? scaffold events?) is undecided. Cancellation deletes the event rather than marking it.
10. **Pilot scoping**: `release_scope` is a single value per job (`R2` for materials/stock/scaffold, `R3` in the installer smoke). How does a job participate in several releases at once? Installer commands check only `pilot_job`.
11. **Partial issue**: `_stkIssue` marks the whole reservation `Issued` even when quantity < reserved; the remainder cannot be issued later without a new reservation (which `RES-STK-<material>` re-activates, resetting picked to 0).
12. **`quantity_short` vs balance**: short raises an issue but does not reduce the outstanding quantity, so a short line still spawns a follow-up delivery. Intended?
13. **Order `Review` status** exists in the enum and is accepted as a source state for send/revise/append (`materials/workflow.js:17,312,347,401`), but no command in the materials module ever sets it.
14. **Scaffold costs**: `quoted_cost_pence` / `actual_cost_pence` / `invoice_reference` are captured but feed nothing (R4 cost rules undefined).
15. **Xero**: contact ids, account/tax codes, and the Zapier contract (request/callback payloads) are all unspecified; `Balance` and `Final` share code `BAL`.
16. **Team capacity**: only per-person capacity is enforced; teams are advisory groupings and cannot be allocated as a unit.

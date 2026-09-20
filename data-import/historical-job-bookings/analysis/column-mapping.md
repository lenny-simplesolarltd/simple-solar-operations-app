# Column mapping — historical Job Booking export

Generated from the column registry and the dry run. Do not edit by hand:
run `npm run import:historical-bookings:docs` instead.

Source: 303 rows, 94 columns.

Examples are redacted. Customer name, address, postcode, email, phone and
MPAN columns show a masked value or a character shape only.

| Disposition | Columns |
| --- | --- |
| IMPORT — becomes a typed value | 74 |
| PRESERVE ONLY — kept in `intake.raw_payload_json` | 13 |
| IGNORE — carries no information | 7 |
| **Total** | **94** |

Every column has an entry, and every column that is not imported carries a
reason, so nothing disappears silently. Even ignored columns are kept in the
intake payload, so the original submission is always recoverable.

## Reconciliation rules

### Form generations — the later question wins

| Concept | Preferred | Fallback | Rule |
| --- | --- | --- | --- |
| Customer postcode | col 61 | col 3 | Column 61 (177 rows) and column 3 (125 rows) are disjoint on 302 of 303 rows. Prefer 61; fall back to 3. |
| Customer first name | col 62 | col 4 | Column 62 (177 rows) and column 4 (125 rows). Prefer 62; fall back to 4. |
| Customer surname | col 63 | col 5 | Column 63 (177 rows) and column 5 (123 rows). Prefer 63; fall back to 5. |
| Optimiser quantity | col 24 | col 30 | Same header label. Column 24 (254 rows) is the live question; column 30 (24 rows) is the retired one. Prefer 24. |

### Look-alikes that are NOT generations

The "newer wins" rule must not be applied to these; they ask different
questions or are conditional branches of the form.

| Concept | Columns | Rule |
| --- | --- | --- |
| Inverter | 20, 32 | Column 32 is the SunPower/Powervault branch, not a newer version of column 20. Take 20 when present, else 32, and record which branch supplied the value. |
| Battery | 21, 36 | As above for column 36. |
| Electrician | 31, 88 | Column 88 is a second electrician on the same job, not a replacement for column 31. Both are allocated. |
| Merchant | 60, 85, 86 | Column 60 is an address, 85 an address, 86 a contact first name. Reconciled by address; 86 only labels the contact. |
| Roof hook totals | 64, 71, 73 | Column 73 is the sum of 64 and 71. Import the parts, never the total, or quantities double. |
| Roof hook totals (R420150) | 65, 67, 74 | Column 74 is the sum of 65 and 67. |

### Dates

`Date Roofer`, `Date Sparky` and `Date Scaffolding` are not one format. The
export changes from month-first to day-first at submission date **2025-08-21**,
with no overlap: every cell whose first component exceeds 12 sits on or after
that date, and every cell whose second component exceeds 12 sits before it.
The era is therefore taken from the row's own submission date rather than
guessed per value. A cell that is only valid under the opposite convention is
read that way and flagged. A cell that is valid both ways on a row with no
usable submission date is refused.

`Date for invoice` (column 58) did not change over and is month-first
throughout. `Submission Date` has three generations, all unambiguous.

## Columns

### 0. `Reference`

**Meaning.** Legacy job reference the office typed by hand: the customer postcode with the space removed, followed by a counter. Treated as customer identity.

**Data quality.** 126 populated, 177 blank, 116 distinct. Inferred type: text.
Examples (redacted): `AA99AA9`, `AA99AA99`, `AA99AA99`.

**Destination.** `intake` — `raw_payload_json`, `source_revision`

**Transformation.** Trimmed and kept verbatim. Never mapped to jobs.job_ref: the schema enforces SS-XXXX-0000 and this is not that shape.

**Conflict rule.** Never overwrites an existing jobs.job_ref. Used only as a deduplication signal.

**Disposition.** PRESERVE ONLY — B — legacy metadata / provenance · confidence High

**Notes.** Populated on 126/303 rows and not unique across them, so it cannot be the idempotency key.

### 1. `Address - Street Address`

**Meaning.** Customer street address, first form generation.

**Data quality.** 301 populated, 2 blank, 281 distinct. Inferred type: text.
Examples (redacted): `9 AAAAAA AAAAAAA`, `99 AAA AAAAAAA`, `99 AAAAAAAAA AA`.

**Destination.** `customers` — `address_line1`

**Transformation.** Whitespace-normalised. First line becomes address_line1; any remainder becomes address_line2.

**Conflict rule.** Existing customer row wins. A difference raises a warning for owner review; never overwritten.

**Disposition.** IMPORT · confidence High

### 2. `Address - City`

**Meaning.** Customer town.

**Data quality.** 301 populated, 2 blank, 107 distinct. Inferred type: text.
Examples (redacted): `AAAAAA`, `AAAAAAAA`, `AAAAAAAA`.

**Destination.** `customers` — `town`

**Transformation.** Whitespace-normalised.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

### 3. `Address - Postal / Zip Code`

**Meaning.** Customer postcode, first form generation.

**Data quality.** 125 populated, 178 blank, 109 distinct. Inferred type: text.
Examples (redacted): `EX2 ***`, `PL7 ***`, `PL9 ***`.

**Destination.** `customers` — `postcode`

**Transformation.** Upper-cased and re-spaced to the schema shape. Rejected if it does not match.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

**Notes.** Superseded by column 61 in the later form generation. See GENERATION_PAIRS.

### 4. `Customer name - First Name`

**Meaning.** Customer first name, first form generation.

**Data quality.** 125 populated, 178 blank, 89 distinct. Inferred type: text.
Examples (redacted): `T***`, `V*****`, `T***`.

**Destination.** `customers` — `first_name`

**Transformation.** Whitespace-normalised.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

**Notes.** Superseded by column 62.

### 5. `Customer name - Last Name`

**Meaning.** Customer surname, first form generation.

**Data quality.** 123 populated, 180 blank, 96 distinct. Inferred type: text.
Examples (redacted): `S****`, `S*****`, `T***`.

**Destination.** `customers` — `last_name`

**Transformation.** Whitespace-normalised.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

**Notes.** Superseded by column 63.

### 6. `Customer Email`

**Meaning.** Customer email address.

**Data quality.** 298 populated, 5 blank, 268 distinct. Inferred type: email.
Examples (redacted): `s*********@y*******.uk`, `v********@h******.com`, `b*********@g****.com`.

**Destination.** `customers` — `email`

**Transformation.** Lower-cased and trimmed to satisfy the schema check. Rejected if not an email shape.

**Conflict rule.** Existing customer row wins. Also a deduplication signal.

**Disposition.** IMPORT · confidence High

### 7. `Installers`

**Meaning.** Installer(s) allocated, as a newline-separated multi-select of first names.

**Data quality.** 264 populated, 39 blank, 8 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Lewis\nJames`, `Lewis`, `Chris`.

**Destination.** `historical_job_people` — `source_value`, `person_id`, `match_kind`

**Transformation.** Split on newlines. Each name is preserved verbatim; a person link is added only for an unambiguous match. An unresolved name blocks nothing.

**Conflict rule.** Never creates or replaces an allocation. Recorded as a historical fact only.

**Disposition.** IMPORT · confidence Medium

**Notes.** Contains the ambiguous alias "Lewis" on 104 rows; see people-matches.md.

### 8. `Email James`

**Meaning.** Notification address used for the electrical booking email in the earlier form generation. Holds whichever contractor was emailed, not James specifically.

**Data quality.** 291 populated, 12 blank, 18 distinct. Inferred type: email.
Examples (redacted): `jhelectricasluk@gmail.com`, `jhelectricaluk@gmail.com`, `odfh35@gmail.com`.

**Destination.** none

**Transformation.** Kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — E — unknown, owner decision required · confidence Low

**Notes.** Label and content disagree, and some values are junk placeholders. Not used for people matching.

### 9. `Email Lewis`

**Meaning.** Second notification address on the same email, same caveat as column 8.

**Data quality.** 287 populated, 16 blank, 20 distinct. Inferred type: email.
Examples (redacted): `odfh35@gmail.com`, `odfh35@gmail.co`, `lmpvlimited@gmail.com`.

**Destination.** none

**Transformation.** Kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — E — unknown, owner decision required · confidence Low

### 10. `Date Roofer`

**Meaning.** Date the roofing visit was booked for.

**Data quality.** 272 populated, 31 blank, 210 distinct. Inferred type: date.
Examples (redacted): `02-17-2025`, `02-18-2025`, `02-27-2025`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** MM-DD-YYYY to an ISO date on the Roof work package. A date in the past is recorded as a historical fact, not a plan.

**Conflict rule.** Never moves an existing work package; no live work package is created.

**Disposition.** IMPORT · confidence High

### 11. `Date Sparky`

**Meaning.** Date the electrical visit was booked for.

**Data quality.** 282 populated, 21 blank, 208 distinct. Inferred type: date.
Examples (redacted): `02-18-2025`, `02-19-2025`, `02-28-2025`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 10, on the Electrical work package.

**Conflict rule.** Never moves an existing work package; no live work package is created.

**Disposition.** IMPORT · confidence High

### 12. `Date Scaffolding`

**Meaning.** Date scaffolding was booked to be erected.

**Data quality.** 212 populated, 91 blank, 156 distinct. Inferred type: date.
Examples (redacted): `02-10-2025`, `03-01-2025`, `03-14-2025`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** MM-DD-YYYY to an ISO date. Recorded as a completed historical erect, never as a live booking.

**Conflict rule.** Never touches an existing scaffold booking; no live scaffold booking is created.

**Disposition.** IMPORT · confidence High

### 13. `Roof hooks type`

**Meaning.** Roof hook / mounting type chosen for the roof.

**Data quality.** 123 populated, 180 blank, 29 distinct. Inferred type: text.
Examples (redacted): `A-Slate`, `Concrete tile`, `Flat concrete tile`.

**Destination.** `technical_details` — `roof_type`

**Transformation.** Whitespace-normalised free text. Not mapped to a products SKU: the 29 distinct values mix hook type, tile type and manufacturer.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 14. `Roof hooks Quantity`

**Meaning.** Number of roof hooks required.

**Data quality.** 119 populated, 184 blank, 28 distinct. Inferred type: integer.
Examples (redacted): `20`, `36`, `40`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line on the Roof package, description "Roof hooks (historical)", unit Each.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 15. `Roof end clamps Quantity`

**Meaning.** Number of end clamps required.

**Data quality.** 121 populated, 182 blank, 20 distinct. Inferred type: integer.
Examples (redacted): `18`, `28`, `4`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 14.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 16. `Roof mid clamps Quantity`

**Meaning.** Number of mid clamps required.

**Data quality.** 223 populated, 80 blank, 27 distinct. Inferred type: integer.
Examples (redacted): `8`, `20`, `16`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 14.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 17. `Roof end caps Quantity`

**Meaning.** Number of end caps required.

**Data quality.** 218 populated, 85 blank, 22 distinct. Inferred type: integer.
Examples (redacted): `18`, `28`, `4`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 14.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 18. `Roof rail Quantity`

**Meaning.** Number of rails required.

**Data quality.** 214 populated, 89 blank, 26 distinct. Inferred type: integer.
Examples (redacted): `6`, `12`, `8`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 14.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 19. `Roof splice Quantity`

**Meaning.** Number of splices required.

**Data quality.** 173 populated, 130 blank, 9 distinct. Inferred type: integer.
Examples (redacted): `0`, `4`, `2`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** As column 14.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 20. `Inverter ordered`

**Meaning.** Inverter model ordered (mostly Fox ESS).

**Data quality.** 268 populated, 35 blank, 36 distinct. Inferred type: text.
Examples (redacted): `Fox ESS H1-3.7-G2`, `Fox ESS S2000`, `Fox ESS H1-5.0-G2`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Kept as free text on an Inverter equipment row. Not resolved to products.sku: model strings are not SKUs and several cells describe more than one unit.

**Conflict rule.** Never replaces existing job_equipment; no live job_equipment row is created.

**Disposition.** IMPORT · confidence Medium

### 21. `Battery ordered`

**Meaning.** Battery model and count ordered.

**Data quality.** 250 populated, 53 blank, 23 distinct. Inferred type: text.
Examples (redacted): `FoxESS EP11`, `FoxESS EP5`, `2 x EP11 batteries, 1 x Fox JB for EP batteries`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Kept as free text on a Battery equipment row. Counts embedded in prose ("FoxESS EP5 x 3") are not parsed into quantity.

**Conflict rule.** Never replaces existing job_equipment; no live job_equipment row is created.

**Disposition.** IMPORT · confidence Medium

### 22. `Electrical extras to note`

**Meaning.** Electrical extras multi-select. Populated on 7 rows.

**Data quality.** 7 populated, 296 blank, 2 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Smoke alarm`, `Smoke alarm\nExtrenal run`.

**Anomalies.** header label is shared with 1 other column(s).

**Destination.** `technical_details` — `electrical_notes`

**Transformation.** Newline list folded into electrical_notes, prefixed "Electrical extras:".

**Conflict rule.** Appended to the historical note block only; never edits an existing note.

**Disposition.** IMPORT · confidence Medium

**Notes.** Shares its header label with column 33, which is empty.

### 23. `Roofing extras to note`

**Meaning.** Roofing extras multi-select. Never populated.

**Data quality.** 0 populated, 303 blank, 0 distinct. Inferred type: empty.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — D — obsolete · confidence High

**Notes.** 0/303 populated.

### 24. `Roofing extras Optimisers`

**Meaning.** Number of optimisers, current form generation.

**Data quality.** 254 populated, 49 blank, 32 distinct. Inferred type: integer.
Examples (redacted): `3`, `15`, `5`.

**Anomalies.** header label is shared with 1 other column(s).

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line "Optimisers (historical)", unit Each.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Paired with column 30. See GENERATION_PAIRS.

### 25. `Roofing extras Bird netting (m)`

**Meaning.** Metres of bird netting required.

**Data quality.** 58 populated, 245 blank, 31 distinct. Inferred type: decimal.
Examples (redacted): `30`, `36`, `28`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Decimal to a materials line "Bird netting (historical)", unit Metre.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 26. `Annual generation`

**Meaning.** Estimated annual generation in kWh.

**Data quality.** 260 populated, 43 blank, 238 distinct. Inferred type: decimal.
Examples (redacted): `2685`, `6498`, `1834`.

**Destination.** `technical_details` — `annual_generation_kwh`

**Transformation.** Decimal. Rejected if negative.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 27. `Annual consumption`

**Meaning.** Estimated annual consumption in kWh.

**Data quality.** 121 populated, 182 blank, 92 distinct. Inferred type: decimal.
Examples (redacted): `5143`, `3500`, `2449`.

**Destination.** `technical_details` — `annual_consumption_kwh`

**Transformation.** Decimal.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 28. `Cost of job`

**Meaning.** Agreed gross selling price in pounds.

**Data quality.** 285 populated, 18 blank, 259 distinct. Inferred type: decimal.
Examples (redacted): `10406.43`, `11734`, `4500`.

**Destination.** `jobs` — `original_gross_pence (nullable for HistoricalImport)`, `current_contract_gross_pence`

**Transformation.** Pounds to pence. Zero and unparseable values leave the price null rather than being defaulted; the > 0 check still applies to any value that is recorded.

**Conflict rule.** Never overwrites an existing job price. A difference is reported, not applied.

**Disposition.** IMPORT · confidence Medium

**Notes.** Informational only: no payment, invoice or accounting event is derived from it.

### 29. `Bens prompts`

**Meaning.** Office checklist the director worked through at booking. The choice list changed at least twice, so it mixes checklist items ("Invoice", "Send pre sale"), bare answers ("Yes", "No", "Not sure") and extras ("Canopy", "Smoke alarm", "Ohme").

**Data quality.** 123 populated, 180 blank, 14 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Send pre sale`, `G99`, `Invoice\nSend pre sale\nCreate a folder\nApp\nLink survey`.

**Destination.** none

**Transformation.** Kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — E — unknown, owner decision required · confidence Low

**Notes.** Replaying these as tasks would create live office work for finished jobs. See owner-decisions.md.

### 30. `Roofing extras Optimisers`

**Meaning.** Number of optimisers, earlier form generation.

**Data quality.** 24 populated, 279 blank, 16 distinct. Inferred type: integer.
Examples (redacted): `8`, `11`, `14`.

**Anomalies.** header label is shared with 1 other column(s).

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Used only when column 24 is blank.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Duplicate header of column 24.

### 31. `Sparky`

**Meaning.** Electrician allocated to the job, as a first name.

**Data quality.** 274 populated, 29 blank, 8 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `James`, `Lewis`, `Travis`.

**Destination.** `historical_job_people` — `source_value`, `person_id`, `match_kind`

**Transformation.** Preserved verbatim; linked only on an unambiguous match. No allocation is created.

**Conflict rule.** Never creates or replaces an allocation. Recorded as a historical fact only.

**Disposition.** IMPORT · confidence Medium

**Notes.** Contains the ambiguous aliases "Dave" and "Lewis".

### 32. `SUNPOWER Inverter ordered`

**Meaning.** Inverter model for SunPower/Powervault systems; a conditional branch of the form.

**Data quality.** 19 populated, 284 blank, 2 distinct. Inferred type: text.
Examples (redacted): `SunPower Reserve 5kW`, `Powervault 6.0kW`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Used when column 20 is blank. Genuinely a different question, not a newer version of column 20.

**Conflict rule.** Never replaces existing job_equipment; no live job_equipment row is created.

**Disposition.** IMPORT · confidence Medium

### 33. `Electrical extras to note`

**Meaning.** Duplicate export of the column 22 question. Never populated.

**Data quality.** 0 populated, 303 blank, 0 distinct. Inferred type: empty.

**Anomalies.** header label is shared with 1 other column(s).

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — C — duplicate of another column · confidence High

**Notes.** 0/303 populated; same header label as column 22.

### 34. `Amp of Fuse`

**Meaning.** Main fuse rating in amps.

**Data quality.** 268 populated, 35 blank, 16 distinct. Inferred type: decimal.
Examples (redacted): `32`, `16`, `3.68`.

**Destination.** `technical_details` — `fuse_rating_amps`

**Transformation.** Integer; the schema requires > 0. Non-integer values such as "3.68" are a kW rating in the wrong column and are rejected with a warning.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 35. `Extras for ordering`

**Meaning.** Standing electrical order checklist, as a newline multi-select.

**Data quality.** 273 populated, 30 blank, 37 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Fuse for board as below if not 32Amp\nkWh meter\nSurge protection box with2 way\nMe...`, `Fuse for board as below if not 32Amp\nkWh meter\nSurge protection box with2 way\nMe...`, `kWh meter\nSurge protection box with2 way\nMeter tail pack\n3 x Henley blocks\nDC Ro...`.

**Destination.** `technical_details` — `ordering_notes`

**Transformation.** Kept as text. Not converted to materials lines: the entries name catalogue items without quantities, and the wording drifts ("with2 way" / "with 2 ways").

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 36. `SUNPOWER Battery ordered`

**Meaning.** Battery model for SunPower/Powervault systems.

**Data quality.** 20 populated, 283 blank, 4 distinct. Inferred type: text.
Examples (redacted): `SunPower Reserve 12kWh`, `SunPower Reserve 8kWh`, `Powervault 20.48kWh`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Used when column 21 is blank.

**Conflict rule.** Never replaces existing job_equipment; no live job_equipment row is created.

**Disposition.** IMPORT · confidence Medium

### 37. `Customer Phone Number`

**Meaning.** Customer telephone number.

**Data quality.** 297 populated, 6 blank, 266 distinct. Inferred type: integer.
Examples (redacted): `*******188`, `*******022`, `*******572`.

**Destination.** `customers` — `phone`

**Transformation.** Trimmed, kept verbatim. Digits are normalised only to build a deduplication key, never to rewrite the stored value.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

### 38. `Solar size (kW)`

**Meaning.** System size in kW.

**Data quality.** 279 populated, 24 blank, 86 distinct. Inferred type: decimal.
Examples (redacted): `4.5`, `2.25`, `4.05`.

**Destination.** `technical_details` — `system_kw`

**Transformation.** Decimal.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 39. `Battery size (kWh)`

**Meaning.** Battery capacity in kWh.

**Data quality.** 272 populated, 31 blank, 27 distinct. Inferred type: decimal.
Examples (redacted): `12`, `5.12`, `20.72`.

**Destination.** `technical_details` — `battery_kwh`

**Transformation.** Decimal.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 40. `MPAN`

**Meaning.** Meter Point Administration Number.

**Data quality.** 96 populated, 207 blank, 88 distinct. Inferred type: integer.
Examples (redacted): `999999999999`, `9999999999999`, `9999999999999`.

**Destination.** `technical_details` — `mpan`

**Transformation.** Kept as plain text exactly as entered, per the schema comment.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 41. `Submission Date`

**Meaning.** When the booking form was submitted.

**Data quality.** 301 populated, 2 blank, 285 distinct. Inferred type: text.
Examples (redacted): `24-Feb-2025`, `3-Mar-2025`, `2025-03-07 9:48:24`.

**Destination.** `intake` — `received_at`

**Transformation.** Three formats accepted, all unambiguous. Also supplies jobs.sold_at, which the schema requires.

**Conflict rule.** Never changes an existing job sold_at.

**Disposition.** IMPORT · confidence High

### 42. `Email`

**Meaning.** Form recipient address. Constant: info@simplesolarltd.co.uk on all 300 populated rows.

**Data quality.** 300 populated, 3 blank, 1 distinct. Inferred type: email.
Examples (redacted): `info@simplesolarltd.co.uk`.

**Anomalies.** single constant value across every populated row.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — D — obsolete · confidence High

**Notes.** A form delivery setting, not job data. info@ is not an actor in the current system.

### 43. `Roofing notes`

**Meaning.** Free-text roofing notes.

**Data quality.** 240 populated, 63 blank, 223 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Brief description of job\nPanels on rear walkway roof\nDirectly under will be in...`, `As per photo sent, try and get all on south and east roofs`, `2 rows of 5 panels in portrait\nCut down bathroom vent pipe to fly over panel\nD...`.

**Destination.** `technical_details` — `roof_notes`

**Transformation.** Kept verbatim.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 44. `Electrical notes`

**Meaning.** Free-text electrical notes.

**Data quality.** 206 populated, 97 blank, 189 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Brief description of job\nPanels on rear walkway roof\nDirectly under will be in...`, `Inverter and batteries are going in walkway as per email`, `Inverter and battery outside under car port. Client will move red tool boxes to ...`.

**Destination.** `technical_details` — `electrical_notes`

**Transformation.** Kept verbatim.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 45. `Ordering notes`

**Meaning.** Free-text ordering notes.

**Data quality.** 139 populated, 164 blank, 132 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Please have ordered for collection to Keighley store BD21 5RN\n\nNote FE-HV-EP11...`, `Please order the following\n112 K2 flat mini rail\n80 K2 black end clamp\n32 K2 ...`, `Please order the following roofing\n\n27 K2 flat mini rail\n15 K2 black end clam...`.

**Destination.** `technical_details` — `ordering_notes`

**Transformation.** Kept verbatim, joined after column 35 when both are present.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence High

### 46. `G99`

**Meaning.** G99 application flag. The only value is the literal "G99", so presence means yes.

**Data quality.** 18 populated, 285 blank, 1 distinct. Inferred type: text.
Examples (redacted): `G99`.

**Anomalies.** single constant value across every populated row.

**Destination.** `technical_details` — `g99_status`

**Transformation.** Presence to g99_status = "HistoricalG99Flagged"; blank leaves it null rather than asserting "not required".

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 47. `Salesman`

**Meaning.** Salesperson who sold the job.

**Data quality.** 102 populated, 201 blank, 6 distinct. Inferred type: text.
Examples (redacted): `Dave`, `Mike`, `Dan`.

**Destination.** `jobs` — `salesperson_id (nullable for HistoricalImport)`

**Transformation.** Matched against people. A unique match sets jobs.salesperson_id; anything else leaves it null (permitted for HistoricalImport) and the name is preserved in historical_job_people.

**Conflict rule.** Never changes an existing job salesperson.

**Disposition.** IMPORT · confidence Medium

**Notes.** Populated on only 102/303 rows, and "Dave" and "Dan" are ambiguous. No longer blocking: unknown is recorded as unknown.

### 48. `Lead from`

**Meaning.** Lead source.

**Data quality.** 84 populated, 219 blank, 13 distinct. Inferred type: text.
Examples (redacted): `FB`, `Devon show`, `Student Choice`.

**Destination.** `jobs` — `lead_source`

**Transformation.** Whitespace-normalised free text; the column is unconstrained text. Typos are preserved, not corrected.

**Conflict rule.** Never changes an existing job lead_source.

**Disposition.** IMPORT · confidence High

**Notes.** "Student Choice" and "Student Choise" are the same source spelled two ways.

### 49. `Fox order email`

**Meaning.** Merchant address the Fox order was sent to. Constant on all 63 populated rows.

**Data quality.** 63 populated, 240 blank, 1 distinct. Inferred type: email.
Examples (redacted): `Luke.Joyce@cef.co.uk`.

**Anomalies.** single constant value across every populated row.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — D — obsolete · confidence High

**Notes.** A routing setting. The merchant itself is carried by columns 60/85/86.

### 50. `PowerVault order email`

**Meaning.** As column 49, same constant address.

**Data quality.** 63 populated, 240 blank, 1 distinct. Inferred type: email.
Examples (redacted): `Luke.Joyce@cef.co.uk`.

**Anomalies.** single constant value across every populated row.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — C — duplicate of another column · confidence High

### 51. `PowerVault extras`

**Meaning.** PowerVault extras. Never populated.

**Data quality.** 0 populated, 303 blank, 0 distinct. Inferred type: empty.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — D — obsolete · confidence High

### 52. `Genius flashing `

**Meaning.** Quantity of Genius flashing required. Header has a trailing space in the export.

**Data quality.** 117 populated, 186 blank, 37 distinct. Inferred type: integer.
Examples (redacted): `6`, `5`, `2`.

**Anomalies.** header has trailing whitespace.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line "Genius flashing (historical)", unit Each. A recorded 0 means "none required" and produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

### 53. `Electrical extras Canopy`

**Meaning.** Canopy required, as 1/0. Populated on 3 rows.

**Data quality.** 3 populated, 300 blank, 2 distinct. Inferred type: integer.
Examples (redacted): `1`, `0`.

**Destination.** `technical_details` — `electrical_notes`

**Transformation.** Folded into the historical electrical note block when 1.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 54. `Electrical extras Off-grid backup`

**Meaning.** Off-grid backup required, as 1/0. Populated on 4 rows.

**Data quality.** 4 populated, 299 blank, 2 distinct. Inferred type: integer.
Examples (redacted): `1`, `0`.

**Destination.** `technical_details` — `electrical_notes`

**Transformation.** As column 53.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 55. `Scaffold company`

**Meaning.** Scaffolding company, or a "not required" answer written into the same box.

**Data quality.** 134 populated, 169 blank, 15 distinct. Inferred type: text.
Examples (redacted): `RFBM`, `Skyline`, `Plym`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Matched against companies of type Scaffolder. "NA", "no scaff", "NOT REQUIRED" and similar set scaffold_required = false instead of naming a company. "TBC" is unresolved.

**Conflict rule.** Never touches an existing scaffold booking. Companies are never created automatically.

**Disposition.** IMPORT · confidence Medium

**Notes.** "Plym" and "Plym Group" are almost certainly one company across 76 rows; see owner-decisions.md.

### 56. `Finance`

**Meaning.** Whether the sale used a finance route.

**Data quality.** 203 populated, 100 blank, 2 distinct. Inferred type: boolean.
Examples (redacted): `No`, `Yes`.

**Destination.** `jobs` — `finance_route (nullable for HistoricalImport)`

**Transformation.** No becomes "Standard" - a real route decision. Yes leaves finance_route null: the form never recorded which route, and both evaluate_ready_to_book and process_booking_gates branch on finance_route = "Standard", so any route value would assert a decision that was never made.

**Conflict rule.** Never changes an existing job finance_route.

**Disposition.** IMPORT · confidence Medium

**Notes.** No finance_plans row is created: the form answer is not a finance agreement. The original Yes/No survives in the intake payload.

### 57. `Emails`

**Meaning.** Stray address column, populated on a single row.

**Data quality.** 1 populated, 302 blank, 1 distinct. Inferred type: email.
Examples (redacted): `travisrobinsonwork@gmail.com`.

**Anomalies.** single constant value across every populated row.

**Destination.** none

**Transformation.** Kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — E — unknown, owner decision required · confidence Low

### 58. `Date for invoice`

**Meaning.** Date the office intended to raise the invoice.

**Data quality.** 217 populated, 86 blank, 156 distinct. Inferred type: date.
Examples (redacted): `08-28-2025`, `09-12-2025`, `09-16-2025`.

**Destination.** none

**Transformation.** Parsed and validated, then kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — A — new structured field may be needed · confidence Medium

**Notes.** Deliberately not written to invoice_stages.due_date: a historical intention is not a live invoice obligation.

### 59. `Panel`

**Meaning.** Panel wattage used: 510, 455 or "Mixed".

**Data quality.** 166 populated, 137 blank, 3 distinct. Inferred type: text.
Examples (redacted): `510`, `455`, `Mixed`.

**Destination.** `technical_details` — `roof_notes`

**Transformation.** Recorded in the historical roof note block. Not resolved to products: matching a wattage to a SKU needs a manufacturer the form never captured.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Medium

### 60. `Merchant`

**Meaning.** Merchant the order went to, recorded as an email address.

**Data quality.** 96 populated, 207 blank, 2 distinct. Inferred type: email.
Examples (redacted): `TOM.BYRNE@ukgreentech.co.uk`, `Luke.Joyce@cef.co.uk`.

**Destination.** `companies` — `id (lookup only)`

**Transformation.** Email mapped to a known merchant for reporting. No company is created and no order is created.

**Conflict rule.** Never creates or edits a company.

**Disposition.** PRESERVE ONLY — B — legacy metadata / provenance · confidence Medium

**Notes.** Overlaps columns 85 and 86; the three are reconciled into one merchant value.

### 61. `Post code`

**Meaning.** Customer postcode, later form generation.

**Data quality.** 177 populated, 126 blank, 161 distinct. Inferred type: text.
Examples (redacted): `PL3 ***`, `PL3 ***`, `EX39 ***`.

**Destination.** `customers` — `postcode`

**Transformation.** As column 3. Preferred over column 3 when both are present.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

### 62. `1st name`

**Meaning.** Customer first name, later form generation.

**Data quality.** 177 populated, 126 blank, 110 distinct. Inferred type: text.
Examples (redacted): `A***`, `V****`, `D****`.

**Destination.** `customers` — `first_name`

**Transformation.** Preferred over column 4 when both are present.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

### 63. `2nd name`

**Meaning.** Customer surname, later form generation.

**Data quality.** 177 populated, 126 blank, 154 distinct. Inferred type: text.
Examples (redacted): `G******`, `A*******`, `T*****`.

**Destination.** `customers` — `last_name`

**Transformation.** Preferred over column 5 when both are present.

**Conflict rule.** Existing customer row wins.

**Disposition.** IMPORT · confidence High

### 64. `Slate - Renusol Roof Hook (R420181) - Landscape & screws`

**Meaning.** Quantity of Renusol R420181 landscape roof hooks with screws.

**Data quality.** 26 populated, 277 blank, 14 distinct. Inferred type: integer.
Examples (redacted): `8`, `20`, `12`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol R420181 landscape roof hooks with screws (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 65. `Concrete - Renusol Roof hook (R420150) - Portrait & screws`

**Meaning.** Quantity of Renusol R420150 portrait roof hooks with screws.

**Data quality.** 39 populated, 264 blank, 22 distinct. Inferred type: integer.
Examples (redacted): `40`, `76`, `50`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol R420150 portrait roof hooks with screws (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 66. `L bracket for landscape hooks - REN-420353`

**Meaning.** Quantity of Renusol REN-420353 L brackets.

**Data quality.** 52 populated, 251 blank, 21 distinct. Inferred type: integer.
Examples (redacted): `8`, `20`, `76`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol REN-420353 L brackets (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 67. `Concrete -·Renusol Roof Hook (R420150) - Landscape & screws`

**Meaning.** Quantity of Renusol R420150 landscape roof hooks with screws.

**Data quality.** 27 populated, 276 blank, 18 distinct. Inferred type: integer.
Examples (redacted): `76`, `20`, `1`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol R420150 landscape roof hooks with screws (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 68. `K2 Curved multi rail - landscape`

**Meaning.** Quantity of K2 curved multi rail, landscape.

**Data quality.** 2 populated, 301 blank, 2 distinct. Inferred type: integer.
Examples (redacted): `1`, `92`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 curved multi rail, landscape (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 69. `K2 Flat mini rail - portrait`

**Meaning.** Quantity of K2 flat mini rail, portrait.

**Data quality.** 4 populated, 299 blank, 4 distinct. Inferred type: integer.
Examples (redacted): `1`, `40`, `60`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 flat mini rail, portrait (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 70. `K2 Curved mini rail - portrait`

**Meaning.** Quantity of K2 curved mini rail, portrait.

**Data quality.** 1 populated, 302 blank, 1 distinct. Inferred type: integer.
Examples (redacted): `1`.

**Anomalies.** single constant value across every populated row.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 curved mini rail, portrait (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 71. `Slate - Renusol Roof Hook (R420181) - Portrait & screws`

**Meaning.** Quantity of Renusol R420181 portrait roof hooks with screws.

**Data quality.** 37 populated, 266 blank, 24 distinct. Inferred type: integer.
Examples (redacted): `72`, `32`, `36`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol R420181 portrait roof hooks with screws (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 72. `Renusol End clamps REN-420081-B`

**Meaning.** Quantity of Renusol REN-420081-B end clamps.

**Data quality.** 105 populated, 198 blank, 14 distinct. Inferred type: integer.
Examples (redacted): `16`, `56`, `20`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "Renusol REN-420081-B end clamps (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 73. `Total Renusol Roof Hook (R420181) -&  screws`

**Meaning.** Total R420181 hooks, i.e. columns 64 + 71 added up by the form.

**Data quality.** 51 populated, 252 blank, 27 distinct. Inferred type: integer.
Examples (redacted): `72`, `40`, `56`.

**Destination.** none

**Transformation.** Not imported as its own line; recomputed from the landscape and portrait columns so the total is not double-counted.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — C — duplicate of another column · confidence High

### 74. `Total Renusol Roof Hook (R420150) -&  screws`

**Meaning.** Total R420150 hooks, i.e. columns 65 + 67 added up by the form.

**Data quality.** 53 populated, 250 blank, 27 distinct. Inferred type: integer.
Examples (redacted): `40`, `76`, `50`.

**Destination.** none

**Transformation.** As column 73.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — C — duplicate of another column · confidence High

### 75. `K2 1000074 15CM Roof Hook for Flat Tiles - Portrait & Landscape`

**Meaning.** Quantity of K2 1000074 15cm flat tile roof hooks.

**Data quality.** 16 populated, 287 blank, 14 distinct. Inferred type: integer.
Examples (redacted): `40`, `64`, `16`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 1000074 15cm flat tile roof hooks (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 76. `K2 Mid Clamps 2004540 - Portrait & Landscape`

**Meaning.** Quantity of K2 2004540 mid clamps.

**Data quality.** 23 populated, 280 blank, 16 distinct. Inferred type: integer.
Examples (redacted): `16`, `28`, `23`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 2004540 mid clamps (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 77. `K2 End Clamps 2004545 - Portrait & Landscape`

**Meaning.** Quantity of K2 2004545 end clamps.

**Data quality.** 23 populated, 280 blank, 12 distinct. Inferred type: integer.
Examples (redacted): `16`, `24`, `48`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 2004545 end clamps (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 78. `K2 End Caps - Portrait & Landscape`

**Meaning.** Quantity of K2 end caps.

**Data quality.** 20 populated, 283 blank, 10 distinct. Inferred type: integer.
Examples (redacted): `16`, `24`, `48`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 end caps (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 79. `K2 Splice - Portrait & Landscape`

**Meaning.** Quantity of K2 splices.

**Data quality.** 15 populated, 288 blank, 5 distinct. Inferred type: integer.
Examples (redacted): `8`, `6`, `2`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 splices (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 80. `K2 Rail - Portrait & Landscape`

**Meaning.** Quantity of K2 rail.

**Data quality.** 19 populated, 284 blank, 15 distinct. Inferred type: integer.
Examples (redacted): `10`, `16`, `23`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integer to a materials line described "K2 rail (historical)", unit Each. A recorded 0 produces no line.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** Part number preserved in the description; no products row is created.

### 81. `Tesla Extras`

**Meaning.** Tesla-specific extras. Populated on a single row.

**Data quality.** 1 populated, 302 blank, 1 distinct. Inferred type: text.
Examples (redacted): `2 x Cable harness for expansion pack TES-PW3-0.5MHARN`.

**Anomalies.** single constant value across every populated row.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Free text kept as a described materials line with quantity 1, because the text states its own count.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Low

### 82. `Tesla Extras To Order`

**Meaning.** Tesla extras still to order. Populated on 3 rows.

**Data quality.** 3 populated, 300 blank, 3 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Solar CT clamp to monitor existing solar TES-S-CT-100`, `Cable harness for expansion pack TES-PW3-0.5MHARN\nExpansion pack wall mounting k...`, `Cable harness for expansion pack TES-PW3-0.5MHARN`.

**Destination.** `technical_details` — `ordering_notes`

**Transformation.** Folded into the historical ordering note block.

**Conflict rule.** Existing technical_details row wins.

**Disposition.** IMPORT · confidence Low

### 83. `Scaffold PDF & additional`

**Meaning.** Scaffold scope attachment, as a link or as free-text access notes.

**Data quality.** 73 populated, 230 blank, 66 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `https://www.jotform.com/uploads/Quick_Ben/250293237424050/6570792293028350524/Ta...`, `https://eu.jotform.com/uploads/Quick_Ben/250293237424050/6573371890171488478/Bir...`, `https://www.jotform.com/uploads/Quick_Ben/250293237424050/6575980775612614774/Sc...`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** URLs go to the file inventory and are NOT downloaded. Non-URL text becomes access_notes.

**Conflict rule.** Never touches an existing scaffold booking; no live scaffold booking is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** scaffold_bookings.scope_file_id is left null until the owner decides whether to copy files into Storage.

### 84. `Email Scaffolder`

**Meaning.** Address the scaffold booking was emailed to. A stronger scaffold-company signal than column 55, because the domain names the firm.

**Data quality.** 96 populated, 207 blank, 10 distinct. Inferred type: email.
Examples (redacted): `dan@plymbricklaying.co.ukk`, `dan@plymbricklaying.co.uk`, `dan@theplymgroup.co.uk`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Domain used to corroborate the column 55 company. Typo variants are treated as the same domain only when they differ by a trailing character.

**Conflict rule.** Never touches an existing scaffold booking; no live scaffold booking is created.

**Disposition.** IMPORT · confidence Medium

**Notes.** tanya@simplesolarltd.co.uk on 20 rows means the office booked it, not that a scaffolder was chosen.

### 85. `Merchant Email`

**Meaning.** Merchant contact address, later form generation.

**Data quality.** 47 populated, 256 blank, 2 distinct. Inferred type: email.
Examples (redacted): `tom.byrne@ukgreentech.co.uk`, `luke.joyce@cef.co.uk`.

**Destination.** none

**Transformation.** Reconciled with columns 60 and 86 into a single merchant value.

**Conflict rule.** Never creates or edits a company.

**Disposition.** PRESERVE ONLY — B — legacy metadata / provenance · confidence Medium

### 86. `Merchant Name`

**Meaning.** Merchant contact first name ("Tom", "Luke") — a person at the merchant, not the merchant itself.

**Data quality.** 78 populated, 225 blank, 2 distinct. Inferred type: text.
Examples (redacted): `Tom`, `Luke`.

**Destination.** none

**Transformation.** Reconciled with columns 60 and 85.

**Conflict rule.** Never creates a person or a company.

**Disposition.** PRESERVE ONLY — B — legacy metadata / provenance · confidence Medium

**Notes.** These are supplier contacts, not Simple Solar staff, and must never be matched against people.

### 87. `2nd Email sparky`

**Meaning.** Address the second electrician was emailed at.

**Data quality.** 13 populated, 290 blank, 3 distinct. Inferred type: email.
Examples (redacted): `james@simplesolarltd.co.ukK`, `rob@simplesolarltd.co.uk`, `tanya@simplesolarltd.co.uk`.

**Destination.** none

**Transformation.** Kept in the intake payload; corroborates column 88.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — B — legacy metadata / provenance · confidence Medium

### 88. `2nd Sparky`

**Meaning.** Second electrician allocated.

**Data quality.** 13 populated, 290 blank, 2 distinct. Inferred type: text.
Examples (redacted): `Robbie`, `James`.

**Destination.** `historical_job_people` — `source_value`, `person_id`, `match_kind`

**Transformation.** Preserved verbatim; linked only on an unambiguous match. No allocation is created.

**Conflict rule.** Never creates or replaces an allocation. Recorded as a historical fact only.

**Disposition.** IMPORT · confidence Medium

### 89. `Scaffolding notes`

**Meaning.** Free-text scaffolding notes.

**Data quality.** 16 populated, 287 blank, 16 distinct. Inferred type: multi-select (newline separated).
Examples (redacted): `Customer needs to scaff turn around to be fast as using the neighbours (number 1...`, `Quite tight between both properties. See tech survey`, `Customer may not be there but will leave gate unlocked for entry to property`.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Joined after column 83 text when both are present.

**Conflict rule.** Never touches an existing scaffold booking; no live scaffold booking is created.

**Disposition.** IMPORT · confidence High

### 90. `Amount of 455 Panels`

**Meaning.** Originally a count of 455W panels. The column was later reused for a date: 36 of 55 populated cells hold values like "8/12/2026".

**Data quality.** 55 populated, 248 blank, 14 distinct. Inferred type: MIXED: dates and integers.
Examples (redacted): `8/12/2026`, `3`, `8/17/2026`.

**Anomalies.** 42 of 55 values look like dates in a column that is not a date column.

**Destination.** `intake` — `raw_payload_json`

**Transformation.** Integers become a "455W panels (historical)" line. Date-shaped values are NOT imported and raise a warning; their meaning is an owner decision.

**Conflict rule.** Never merged into an existing materials list; no live materials row is created.

**Disposition.** IMPORT · confidence Low

**Notes.** Changed meaning over time. See owner-decisions.md.

### 91. `Tanya Email`

**Meaning.** Office notification address. Constant on all 27 populated rows.

**Data quality.** 27 populated, 276 blank, 1 distinct. Inferred type: email.
Examples (redacted): `tanya@simplesolarltd.co.uk`.

**Anomalies.** single constant value across every populated row.

**Destination.** none

**Transformation.** None.

**Conflict rule.** n/a

**Disposition.** IGNORE — D — obsolete · confidence High

**Notes.** A form routing setting, not job data.

### 92. `Submission ID`

**Meaning.** Form submission identifier. The only column populated on all 303 rows.

**Data quality.** 303 populated, 0 blank, 287 distinct. Inferred type: integer.
Examples (redacted): `6140666849614071702`, `6143156102358629836`, `6161928005321857885`.

**Destination.** `intake` — `submission_id`, `intake_id`

**Transformation.** Preserved exactly. Combined with an identity fingerprint only where one identifier is reused by a different customer. See identity.ts.

**Conflict rule.** A row whose (form_id, submission_id) already exists in intake is a replay and is skipped.

**Disposition.** IMPORT · confidence High

**Notes.** Only 287 of 303 values are distinct. All 10 duplicate groups proved to be the same job exported repeatedly, so those rows collapse to one candidate; see owner-decisions.md finding A.

### 93. `Copied to Plym Tracker`

**Meaning.** Originally a "copied to the scaffolder tracker" flag (247 rows hold "1"). Later reused for a date (13 rows).

**Data quality.** 260 populated, 43 blank, 10 distinct. Inferred type: MIXED: dates and integers.
Examples (redacted): `1`, `7/17/2026`, `7/20/2026`.

**Anomalies.** 13 of 260 values look like dates in a column that is not a date column.

**Destination.** none

**Transformation.** Kept in the intake payload only.

**Conflict rule.** n/a

**Disposition.** PRESERVE ONLY — E — unknown, owner decision required · confidence Low

**Notes.** Changed meaning over time. An external tracker flag has no destination in this system.


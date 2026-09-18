# Inventory: `ben-system-designer-prototype-v0.12.html`

Source: `/Users/lennybeadle/simple-solar-operations-app/docs/ui-reference/ben-system-designer-prototype-v0.12.html`
Size: 2,508 lines / 304,506 bytes. Three giant base64 lines were skipped (L299 logo webp ~104 KB; L940 `RECT_DIAGRAM_SRC` ~40 KB; L941 `CALC_DIAGRAM_SRC` ~17 KB). Everything else was read in full. All line numbers (Lnnn) refer to the original file.

File layout: L1 = an outer wrapper `<!doctype html><html><head>…<style>:root{color-scheme:light;…}body{…background:#faf9f5;color:#141413}…</style></head><body>` (looks like an export/host shell, includes `env(safe-area-inset-*)` padding); L2 `<title>`; L3 version comment; L4-293 `<style>`; L295-472 markup (`<div class="app">`); L474-2506 one IIFE `<script>`; L2508 `</body></html>`. No external JS. One external dependency: Google Fonts `@import` (L5).

## 0. Headline corrections to the brief

- **It is a 7-step flow, not 5.** `STEP_LABELS = ['Parameters','Elevations','Obstructions','Panels','Layout','Price','Performance']` (L488). Parameters comes FIRST, then Elevations. The stepper CSS is still `grid-template-columns:repeat(5,1fr)` (L63), so 7 steps wrap onto two rows (5 + 2) — a leftover from the 5-step era.
- `<title>` is literally `Simple Solar System Designer (Copy)` (L2). There is **no `<h1>`** or text title in the body; the header is only the logo `<img class="brand-logo" alt="Simple Solar">` (L299) plus the "New job" button.
- Many code comments/strings use stale page numbering ("page 1: elevations" L1441, "page 2" for params L1636, "Choose a panel type on page 3 first." L2116, "Add a roof slope on page 1 first." L2045, "Finish this slope's measurements on page 1 first." L1772). These are user-visible in three cases and are wrong relative to the current step order.
- `.site-foot` CSS exists (L288) but no footer element is rendered.

## 1. Version log / change history

**There is no version log in the file.** The only version marker is L3:

```
<!-- VERSION: v0.12 | 2026-09-16m | see version log for change history -->
```

and L609 "see version log for the worked example and cross-checks". The log itself is external and not embedded. Dated change notes that do appear in code comments:

- L481-483: "Simplified 10 Sep 2026 to just the two products the Complex tab's manual max-panel-count fields name (SunPower P7 / SunPower M Class) — the other P7 wattage variants are removed for now." (L700 remaps old `p7-455` / `p7-550` to `p7-510`.)
- L585: "Canopy/outside-mount pricing removed 10 Sep 2026 — not in use for now (per Scott)."
- L556-557 / L2021-2022: inverter category order, "Battery - single phase … leads (per Scott, 16 Sep 2026)".
- L608-615: Performance assumptions "Reverse-engineered from the live Pre-Sale form's "Performance Estimate" panel (14 Sep 2026)"; 5% inflation "reproduces the example's 30-year multiplier (61.81x vs the observed 61.84x)"; degradation "confirmed by Scott, per-product"; performance ratio is "an industry-standard placeholder, NOT yet confirmed against a real job — flag to Scott".
- L691: "Performance-estimate assumptions added 14 Sep 2026".
- L705-710: half-depth mode removed (old `depthMode==='half'` values doubled on load).
- L711-715: old free-drawn "Custom shape"/`polygon` mode migrated to `complex`.
- L716-719: ""Use these values" became a confirmation toggle (rather than a navigation shortcut) on 14 Sep 2026".
- L2406-2407: ""Using finance?" moved to the Price tab (16 Sep 2026)".
- L513: inverter `capacityKwp` "only set where Scott's team's sizing guide covers it (FoxESS single-phase)".
- L490: panel prices are "matching Simple Solar's live pricing form".

## 2. Steps / pages in order

Global chrome (L296-305): header = logo + button `New job` (`#newJobBtn`); `<nav class="stepper" aria-label="Progress">` rendered by `renderStepper()` (L1407) as `<div class="step …" data-page="N"><span class="n">N</span>Label</div>`.

### Step 1 — "Parameters" (`#page1`, L307-348)

Purpose: job-wide fit clearances, roof material per elevation, scaffold, AC run, performance assumptions.

Card **"Roof parameters"** (L310-316) — all `type=number inputmode=decimal step=1`, no min/max, not `required`:

| Label (exact) | state key | default |
|---|---|---|
| `Gap between panels (mm)` | `params.gapMm` | 10 |
| `Ridge / top clearance (mm)` | `params.ridgeMm` | 300 |
| `Eave / gutter clearance (mm)` | `params.eaveMm` | 200 |
| `Verge / side clearance (mm)` | `params.vergeMm` | 100 |

Inline warning `#ridgeWarn` (`.param-warn`): text `Below the usual 200mm minimum`, shown when `state.params.ridgeMm < 200` (L1644, L2293). Blank/NaN input is stored as `0` (L2291).

Card **"Job parameters"** (L319-334):
- Field label `Roof materials` → `#materialsList`: one row per elevation (label = elevation name) with a `<select data-slope-material>` of the 14 `ROOF_MATERIALS` names (no prices shown). Default `'Concrete tile'`. Empty-state: `Add a roof slope on page 1 first.`
- Field label `Scaffold`: `Metres (minimum 8)` number `min=0 step=1`, default 8 (`pricing.scaffoldM`); `Levels (minimum 2)` number `min=0 step=1`, default 2 (`pricing.scaffoldLevels`). The "minimum 8 / 2" is label text only — NOT enforced (HTML min is 0).
- Field label `AC run to inverter`: `Consumer unit → inverter (m)` number `min=0 step=0.5`, **`required`**, default blank (`pricing.extras.acRunM`).

Card **"Performance assumptions"** (L336-345). Hint: "Feeds the Performance estimate (generation, savings, ROI) — defaults are sensible starting points, override per job if the customer's own tariff, SEG rate or self-consumption differs."

| Label | key | attrs | default |
|---|---|---|---|
| `Electricity tariff (p/kWh)` | `performance.tariffPence` | min 0 step 0.01 | 27.49 |
| `SEG export rate (p/kWh)` | `performance.segRatePence` | min 0 step 0.01 | 12 |
| `Self-consumption (%)` | `performance.selfConsumptionPct` | min 0 max 100 step 1 | 70 |
| `Customer's annual consumption (kWh)` | `performance.annualConsumptionKwh` | min 0 step 1, **required** | blank |

Buttons: `Next: elevations →` (`#toPage2Btn`, `data-goto="2"`). **Gating**: disabled while any `[required]` field on page 1 is empty (`pageHasEmptyRequiredFields(1)`, L1376-1405) → i.e. AC run and annual consumption must be filled. No Back button.

### Step 2 — "Elevations" (`#page2`, L350-363)

Header card `Roof slopes`, hint: `Choose Rectangle, Complex, or Slope Calculator for each elevation, then confirm it with "Use these values" before moving on.`

One `article.slope-card` per elevation (L1552-1574): head = editable name `<input class="slope-label" aria-label="Slope name">` (plain text input, default `Primary Elevation`; later ones `Second Elevation` … `Tenth Elevation`, then `Nth Elevation`, L622-623) + `Remove` button (no confirm; removing the last one is allowed). Body = 3-way toggle (`.toggle-pair.three`): `Rectangle` | `Complex` | `Slope Calculator` (`shapeMode` = `rect` default / `complex` / `calc`).

All numeric fields are "param chips" built by `fieldRow()` (L1452): `type=number inputmode=decimal`, all **`required`**, each with `−` / `+` step buttons (aria-label `Decrease <label>` / `Increase <label>`). No `max` on any. `min` applies to the +/- buttons only (not an HTML attribute).

Shared fields (all 3 modes keep the same values; shown in rect + complex), L1472-1478:

| Label | key | step | btn min | default |
|---|---|---|---|---|
| `Pitch (°)` | `pitchDeg` | 1 | 0 | blank |
| `Shading factor (%)` | `shadingPct` | 1 | 0 | blank |
| `Degrees from South (− east / + west)` | `bearingDeg` | 1 | −180 | blank |
| `Radiance (kWh/m²/yr)` | `radiance` | 10 | 0 | blank |

**Rectangle tab** (L1507-1517): reference diagram image (alt "Diagram showing X along the eave and Y up the roof slope to the ridge"), hint `X and Y match the diagram above.`, then `X (m)` (`xM`, step 0.1, min 0, red-edged chip) and `Y (m)` (`yM`, step 0.1, min 0, green-edged chip) + shared fields. Footer states: `Enter X and Y above to continue.` (`.status-line.incomplete`, when X or Y not > 0) → button `Use these values` → green badge `Values confirmed` with tick.

**Complex tab** (L1519-1528): hint "For a roof face too irregular to model directly — type in the panel counts you've already worked out (e.g. from Open Solar). Complex elevations skip obstruction marking — these counts go straight to the Panels step." Fields `Max panels — SunPower P7` (`maxPanelsP7`) and `Max panels — SunPower M Class` (`maxPanelsMClass`), step 1, min 0; both carry `data-required-group="complexPanels-<slopeId>"` so only ONE needs a value. Plus shared fields. Footer: `Enter a max panel count above to continue.` → `Use these values` → `Values confirmed`.

**Slope Calculator tab** (L1541-1550): diagram (alt "…adjacent length X, pitch angle theta, and the hypotenuse…"), hint "A quick helper — work out the sloped rafter length from the pitch and the horizontal run, then send it straight to the Rectangle tab's Y dimension." Fields `Pitch (°) — θ` (`pitchDeg`, shared with the other tabs) and `Adjacent (m) — X` (`calcAdjacentM`, step 0.1). Output block: label `Calculated Roof Slope`, value `<hyp to 2dp> m`, button `Use Calculated Value` → sets `yM = round(hyp, 2dp)`, switches to Rectangle, clears confirmation (L2223-2237). If inputs invalid: `Enter the pitch and the adjacent length to calculate the roof slope.`

Other buttons: `+ Add roof slope` (dashed; new slope copies `pitchDeg`, `orientation`, `roofMaterial` from the last slope plus legacy `widthM/depthValue/riseM`, L2147-2159); `← Back` (→1); `#elevationsNextBtn`, text dynamically `Next: obstructions →` if any slope has rect geometry, else `Next: panels →` (L1633) and it then jumps straight to page 4 (L2142).

**Gating** (L1614-1634): Next disabled unless (a) ≥1 slope and EVERY slope is `rect` or `complex` with `confirmed===true` (a slope left on the Slope Calculator tab blocks), and (b) no empty required field on the page. `.nav-note` texts: `Confirm every roof elevation with "Use these values" to continue.` / `Fill in every highlighted field above to continue.` Because pitch, shading, bearing and radiance are all `required`, all four are mandatory for every elevation.

### Step 3 — "Obstructions" (`#page3`, L365-376)

Header card `Mark obstructions`: "Chimneys, vents, hips — anything that blocks a panel. Mark them now, before choosing a panel type, so the fit and price already account for them. You can still add, adjust or remove them later from the layout page." (Note: the Layout page is in fact read-only for obstructions — see §7.)

Per rect elevation: card with head = elevation name + button `+ Add obstruction` (toggles to `Cancel marking`, red fill). SVG: roof outline, dashed clearance outline, overall width/length dimensions in metres (2dp), existing obstruction rects each with a circular ✕ delete handle at the top-right corner. Hint (idle): `Ridge at top, gutter at bottom. Dashed line shows the usable area once clearances are applied. Mark any chimney, vent or hip here so the panel fit and price already account for it.` Hint (marking, red bold): `Drag on the drawing to draw the obstruction box, matching your own measurements from the bottom-left corner of this roof face — release to set it.` Live readout while marking: `From bottom-left corner: <x>mm across · <y>mm up` and during drag `  ·  Box: <w>mm × <h>mm`. List rows: `Obstruction N — W × Hmm` + `Remove`.

Per complex elevation: greyed card `<label> — Obstructions Not Required`, text `This elevation uses Complex layout, so there's no roof outline to mark an obstruction on.` Empty state: `Add and confirm at least one roof elevation first.`

Buttons: `← Back` (→2), `Next: panels →` (→4). **No gating** (page has no required fields); the whole step is skipped when no rect slope exists.

### Step 4 — "Panels" (`#page4`, L378-386)

Header `Choose panel type`: "Totals across every slope, already net of any marked obstructions, using the parameters from earlier steps. Highest output is marked "best" — tap any card to see the layout."

One full-width button card per panel (L1867-1889): name line `SunPower M Class 475W - Advanced Performance` / `SunPower P7 510W`; `(40 Years Warranty)` / `(30 Years Warranty)`; dims `1.134 m × 1.762 m` / `1.134 m × 1.996 m`; figures `Panels fit` (count) and `Total output` (`x.x kWp`); per-slope breakdown `Label: n · Label: n` when >1 slope; green `BEST OUTPUT` flag on the highest-kWp card (first wins ties, so M Class when both are 0); optional green hint: `Trim <side clearance | ridge or gutter clearance> by <N>mm on <slope> → +<k> panel(s) (<x.x> kWp)`. **No prices are shown on this page.**

Tap a card → `selectedPanelId` set, `maxPage≥5`, go to page 5. Only other button: `← Back` (→3, or →2 if Obstructions was skipped, L1893). No "Next" button.

### Step 5 — "Layout" (`#page5`, L388-400)

Sticky 4-tile stat strip: `Panels fit`, `Excluded`, `Net panels` (accent), `System size` (`x.x kWp`, accent). Bar: `Panel: <name variant>` + link `Change panel` (→4).

Rect elevation card: 3-way toggle `Auto` | `Portrait` | `Landscape` (`slope.orientation`, default `auto`); range sliders `Shift array ←→` and `Shift array ↕ (ridge/eave)` (`min=-1 max=1 step=0.02`, each with `Center` reset; shown only when leftover ≥ 2 mm on that axis, else `No spare room to shift on this slope — panels already fill the available space edge to edge.`); readouts `Layout` (cols × rows), `Fit`, `Excluded`, `Net`; SVG grid with per-side gap labels (mm) and bold overall dims (m); hint `Ridge at top, gutter at bottom. Small labels are the real gap on each side once centring is applied; bold labels are the overall slope dimensions. Tap a panel to knock it out for a chimney, vent or hip — or just to see the price come off. Panels hatched red overlap a marked obstruction — add or remove obstructions from the Obstructions step.`; read-only obstruction list. If nothing fits: `Nothing fits with the current dimensions / clearances — check your numbers.`

Complex elevation card: 2-way toggle `Portrait` | `Landscape`; readout `Panels in this layout  n / max`; freeform cell SVG; hint `Tap a dashed + to add a panel next to any edge, or tap an existing panel to remove it.` If max is 0 for the chosen panel: `Enter a max panel count for <panel> on this elevation's Complex tab to build a layout here.`

Buttons: `← Back to panels` (→4), `Next: price →` (→6). No gating. If no panel selected, page redirects to 4.

### Step 6 — "Price" (`#page6`, L402-455)

Sticky 3-tile strip: `System size` (`x.xx kWp`), `Net panels`, `Total price` (accent, `£x,xxx.xx`).
Info banner `#accessNote` when >1 slope has panels: `Panels are selected on more than one roof face — check your scaffold/access figures cover every face in use.`

Card **"Inverter & battery"**: hint "Add one line per inverter unit — mixed models are fine for split-inverter jobs. Simple Solar System Designer never picks one for you, only warns if the total is over the rated limit." Each line: `<select required>` (placeholder `Select inverter…`, then optgroups; option text `<name> — £<price 2dp>[ (max <n>kWp)]`) + qty number (`min=0 step=1`, default 1) + `✕` remove. Button `+ Add inverter`. `Battery` select (`stackedBattery`, options show ` — £price` when non-zero; default `None`). Banners (priority order, L1139-1154):
  - warn: `No inverter added — add at least one to price this system.` (0 lines)
  - warn: `Select an inverter to price this system.` (1 line, blank) / `Select an inverter for every line — X of Y still say "Select inverter…".`
  - warn: `Selected inverter[s total] <cap>kWp — this system is <kWp>kWp, over the rated limit.` (all lines have `capacityKwp` and system kWp > Σ capacity×qty)
  - info: `Capacity check skipped — one or more selected models (Tesla / Sigenergy / Fox Evo / three-phase) don't have a confirmed rating yet.`

Card **"Extras"** (hint "Prices shown next to each option, same as the inverter list above."): selects `EV charger`, `4G dongle`, `Off-grid backup`, `Bird proofing`, `iBoost / diversion`, `Immersion timer`, `PV Ultra cable`, `Optimisers?` (`No` / `Yes — £55.00 each`); numbers `Number of optimisers` (min 0 step 1, default 0) and `Auxiliaries, manual (£)` (min 0 step 1, default 0).

Card **"Adjustments"**: `Adjustment A (£)`, `Adjustment B (£)`, `Adjustment C (£)` (number, step 1, may be negative, default 0); select `Using finance?` = `No` (default) / `Yes` / `Maybe`.

Card **"Total"**: hint "Labour, delivery/waste, discount and VAT are worked out automatically and appear here in the final breakdown — head office adds any non-standard labour or delivery cost manually via Auxiliaries on the Extras card above." Rows in order (L2078-2099): `Panels + mounting`, `Inverter + battery`, `Extras`, `Finance admin fee`, `Panels, hooks & rail (fixed)`, **`Equipment subtotal`**, `Scaffold`, `Labour (N day[s])`, `Administration & warranties (fixed)`, **`Installation subtotal`**, `Adjustments`, **`Subtotal`**, `Discount` (−£), `Delivery and waste`, `VAT`, **`Total system price`** (grand), then deposit table `Due today (25%)`, `One week before install (35%)`, `Balance on completion (40%)`. Empty state: `Choose a panel type on page 3 first.`

Buttons: `← Back to layout` (→5), `Next: performance →` (`#toPage7Btn`). **Gating**: disabled while any page-6 `[required]` is empty → every inverter line must have a model chosen. (With zero lines there is nothing required, so Next is enabled.)

### Step 7 — "Performance" (`#page7`, L457-470)

Strip: `Annual generation` (kWh), `Year 1 income` (£), `Year 1 ROI` (%, accent). Card `Performance estimate`, hint "Uses each elevation's Radiance figure (Elevations tab) plus the tariff, SEG rate and self-consumption assumptions (Parameters tab). Informational only — doesn't affect the price." Rows: `Annual Generation from the Solar (kWh)`, `Generation from the sun to be Used in the property (kWh)`, `Electricity Savings (£)`, `Generation for Exporting (kWh)`, `SEG Income (£)`, **`Total Income in year 1 (£)`**, `Total Income over 30 Years (£)`, grand `Year 1 ROI on Solar & Battery (%)`. Footnote: `Assumes 5%/year electricity price inflation and <0.40|0.25>%/year panel degradation (<panel>), performance ratio 0.85 for system losses.`

Banners (L1260-1268, first match wins): hint `Choose a panel type on the Panels tab first.`; warn `One or more elevations with panels have no Radiance value entered on the Elevations tab — their generation isn't counted below, so this estimate is on the low side.`; warn `Generation used in the property (X kWh) is more than the customer's stated annual consumption (Y kWh) — double-check the self-consumption % on the Parameters tab.`

Only button: `← Back to price`. **This is the end of the flow.**

## 3. Data model

Single `state` object, persisted whole as JSON to **`localStorage['rafterRidge.v3']`** (`STORE_KEY`, L478) on every change (`save()` L736, try/catch-wrapped). Loaded at start with migrations/backfills (L675-732). Only non-persisted UI state: `obstructionModeSlopeId`, and the New-job confirm flag/timer.

```
state = {
  page: 1..7, maxPage: 1..7,
  slopes: [{
    id:'s1', label:'Primary Elevation', orientation:'auto'|'portrait'|'landscape',
    roofMaterial:'Concrete tile', shiftBias:0 (-1..1), shiftBiasV:0 (-1..1),
    shapeMode:'rect'|'complex'|'calc', confirmed:false,
    xM:'', yM:'', pitchDeg:'', shadingPct:'', bearingDeg:'', radiance:'',
    maxPanelsP7:'', maxPanelsMClass:'', calcAdjacentM:''
    // legacy leftovers possibly present: widthM, depthValue, riseM
  }],
  params: { gapMm:10, ridgeMm:300, eaveMm:200, vergeMm:100 },
  performance: { tariffPence:27.49, segRatePence:12, selfConsumptionPct:70, annualConsumptionKwh:'' },
  selectedPanelId: null | 'p7-510' | 'mclass-475',
  exclusions:    { 'slopeId|panelId': [panelIndex,…] },        // manual tap-outs
  obstructions:  { slopeId: [{id,x,y,w,h}] },                  // mm, origin top-left (ridge/left verge)
  complexLayouts:{ 'slopeId|panelId': {orientation, cells:[{r,c}], customized:bool} },
  slopeSeq: 2,
  pricing: {
    inverterLines:[{id:'l1', modelId:'', qty:1}], lineSeq:2,
    stackedBattery:'None',
    extras:{ ev:'No', dongle:'Yes', offgrid:'No', birdproofing:'No', iboost:'No', immersion:'No',
             pvultra:'No', optimisers:'No', optimiserCount:0, acRunM:'', auxiliaries:0 },
    finance:'No', scaffoldM:8, scaffoldLevels:2,
    labourRate:585, adjA:0, adjB:0, adjC:0,
    deliveryWaste:600, discount:0, vat:0
  }
}
```

Slope text fields are stored as raw strings from inputs (numbers after +/- buttons). **`labourRate`, `deliveryWaste`, `discount` and `vat` have NO UI control anywhere** — they are fixed at 585 / 600 / 0 / 0. `bearingDeg` is captured but used in no calculation. `pitchDeg` is used only by the Slope Calculator. `areaM2` is computed in `slopeGeometry` but never displayed or used.

### Catalogues (exact)

`UPLIFT = 1.18` (L479) — the only margin-like multiplier; applied to panels+mounting, inverter+battery block, scaffold, labour.

**PANELS** (L484-487)

| id | name | variant | width m | height m | W | tag | warranty | £/panel by face 1-5 (L491-494) | degradation %/yr |
|---|---|---|---|---|---|---|---|---|---|
| `mclass-475` | SunPower M Class | 475 W | 1.134 | 1.762 | 475 | Advanced Performance | 40 | 160.50, 160.50, **175.50**, 160.50, 160.50 | 0.25 |
| `p7-510` | SunPower P7 | 510 W | 1.134 | 1.996 | 510 | — | 30 | 110.50, 110.50, **120.50**, 110.50, 110.50 | 0.4 |

Face index = `min(slopeArrayIndex, 4)` (L628).

**ROOF_MATERIALS** mounting £/panel (L496-511): Natural slate (rough) 67.70 · Man-made slate (smooth) 52.32 · Asbestos slate (normally pink) 120 · Concrete tile 57.70 · Small concrete tile (biscuit - small) 67.70 · Cement fibre corrugated (usually on barns) 47.70 · Asbestos corrugated 120 · Metal corrugated (rounded) 47.70 · Metal trapezoid roof (flat corrugated) 47.70 · Ground mount 140 · Rubber roof (normally flat) 130 · Fibre glass roof (normally flat) 130 · Felt roof (normally flat) 130 · GSE in-roof trays 205.

**INVERTER_MODELS** (L514-554; £, `capacityKwp` in brackets where set). Dropdown group order per `INVERTER_CATEGORY_ORDER` (L558-567):
1. *Battery - single phase*: FoxESS H1-3.0-G2 700 (3) · H1-3.7-G2 700 (4) · H1-5.0-G2 730 (6) · H1-6.0-G2 750 (7) · KH7 980 (8) · KH8 1025 (9) · KH9 1045 (10) · KH10 1100 (14.99)
2. *Sigenergy (all-in-one)*: Sigenstor 3.6kW 850 · 6.0kW 1021 · 8.0kW 1451 · 10.0kW 1571 · 12.0kW 1621.5
3. *Tesla*: Powerwall 3 5200 · Powerwall 3 with expansion pack 9200
4. *FoxESS Evo (all-in-one)* (each "w/ 10.24kWh Battery"): 5kW 3100 · 8kW 3180 · 10kW 3200
5. *Sunpower ESS*: 5kW 1294 · 6kW 1311 · 10kW 1513
6. *No battery - single phase*: FoxESS S2000 250 · S2500 310 · F3000 310 (3) · F3600 366 (4) · F5000 407 (6) · F6000 457 (7)
7. *No battery - three phase*: FoxESS T-6 670 · T-8 715 · T-10 785 · T-12 840 · T-15 900 · T-20 1000 · T-25 1075
8. *Battery - three phase*: FoxESS H3-8.0 1770 · H3-10.0 1840 · H3-12.0 1900 · H3-PRO-20.0 2400 · H3-PRO-25.0 2800

**STACKED_BATTERY** (L569-576): None 0 · FoxESS EP6 1120 / x2 2400 / x3 3520 / x4 4640 · FoxESS EP12 1880 / x2 3900 / x3 5780 / x4 7660 · Sigenergy Sigenstor 10 kWh 2180 / x2 4360 / x3 6540 / x4 8720 / x5 10900 · Tesla Powerwall 3 (13.5kWh) 0 · Tesla Powerwall 3 & expansion pack (27kWh) 0 · … & 2 expansion packs (40.5kWh) 4000 · … & 3 expansion packs (54kWh) 8000 · Sunpower ESS 5kW 838 / x2 1676 / x3 2514 / x4 3352.

**Extras** (L578-586): EV — No 0, Fox (single phase) 899.99, Ohme (single phase) 899.99, Zappi (three phase) 1499.99, Hypervolt 1099.99, Tesla Gen 3 899.99. Dongle — **No 80**, Yes 85 (default Yes; "No" still costs £80). Off-grid — No 0, FoxESS Gateway - Whole Home 1280, Tesla Gateway2 - Whole Home 1750, SigEnergy - Homepro 1435. Bird — No 0, Bird Mesh 350. iBoost — No 0, iBoost 499.99, eddi & harvi 799.99. Immersion — No 0, Yes 85. PV Ultra — No 0, 25m 250.19, 50m 500.38, 75m 750.56, 100m 960.75. `OPTIMISER_PRICE = 55`.

**Fees / splits** (L603-605): `FINANCE_FEE = {No:0, Yes:250, Maybe:125}`; `FIXED_FEE_1 = 350` ("Panels, hooks & rail (fixed)"); `FIXED_FEE_2 = 480` ("Administration & warranties (fixed)"); `DEPOSIT_SPLITS` = Due today 0.25 / One week before install 0.35 / Balance on completion 0.40.

**Performance constants** (L616-618): `ELECTRICITY_INFLATION_PCT = 5`, `PANEL_DEGRADATION_PCT = {'p7-510':0.4,'mclass-475':0.25}` (fallback 0.5), `PERFORMANCE_RATIO = 0.85`.

**VAT: there is no VAT rate.** `vat` is a flat £ amount defaulting to 0 with no input, so VAT always displays £0.00 (consistent with 0% domestic solar, but not stated). No cost-vs-sell margin model beyond `UPLIFT 1.18` and the `×1.05` on inverters.

## 4. Calculations

**Geometry** (`slopeGeometry`, L766-779): rect only; `widthMm = X×1000`, `slopeMm = Y×1000` (Y is already the sloped rafter length — no trig), `areaM2 = X×Y` (unused). Complex/calc → `complete:false`.

**Slope calculator** (L930-935): `hyp = adjacent / cos(pitch·π/180)`; valid only for adjacent > 0 and 0 < pitch < 90. Displayed 2dp; written to `yM` rounded to 2dp.

**Panel fit** (`fitFor`, L943-982):
```
usableW = max(0, widthMm − 2·vergeMm)
usableS = max(0, slopeMm − ridgeMm − eaveMm)
cols = floor((usableW + gap) / (alongW + gap));  rows = floor((usableS + gap) / (alongS + gap))
count = cols·rows
usedW = cols·(alongW+gap) − gap;  leftoverW = usableW − usedW   (same for S)
offsetW = (leftoverW/2)·(1 + shiftBias)      // −1 hugs left, 0 centred, +1 hugs right
offsetS = (leftoverS/2)·(1 + shiftBiasV)     // −1 hugs ridge, +1 hugs eave
```
Portrait = (panel width along eave, height up slope); landscape swapped. **Auto**: if obstructions exist, pick the orientation with more net-of-obstruction panels; otherwise landscape only if strictly more than portrait (ties → portrait). Single orientation per slope; no mixed layouts.

**Obstructions** (`autoExcludedSet`, L984-1000): any panel rect (origin `verge+offsetW`, `ridge+offsetS`) that strictly overlaps (`rectsOverlap`, L757) an obstruction rect is auto-excluded. No buffer/clearance around obstructions. A drawn box is kept only if `w>40 && h>40` mm (L1713); coordinates are clamped to the roof rectangle and rounded to mm.

**Net count** (L1049-1058): `net = fit.count − |auto ∪ manual(idx<count)|`. Complex: `min(layout.cells.length, max)` or the raw entered max if the layout has never been opened (L827-834).

**Headroom hint** (L1002-1026): `THRESH = 150` mm. Side: `ceil(deficitW/2)` (per verge) gives +rows panels; slope: `ceil(deficitS)` gives +cols panels. Smallest trim wins, then larger gain.

**kWp** = `count × wattage / 1000` (1dp on Panels/Layout, 2dp on Price).

**Pricing** (`computePricing`, L1078-1166):
```
panelsMounting = Σ_slopes (panelPrice[face] + mountingPrice[material]) × net  × 1.18
inverter       = (Σ price×qty × 1.05 + stackedBattery + 1300) × 1.18     // 1300 added even with no inverter chosen
extras         = EV + dongle + offgrid + bird + iboost + immersion + pvultra
                 + (optimisers=='Yes' ? count×55 : 0)
                 + (acRunM > 5 ? acRunM × 8.5 : 0)                       // whole run charged once over 5 m
                 + auxiliaries
scaffold       = scaffoldM==0 ? 0 : ((scaffoldM + 2) × 24) × levels × 1.18     // default 566.40
labourDays     = ceil(totalNetPanels/12 + 1);  labour = 1.18 × days × 585
equipment      = panelsMounting + inverter + extras + financeFee + 350
installation   = scaffold + labour + 480
subtotal       = equipment + installation + (adjA + adjB + adjC)
total          = subtotal − discount(0) + deliveryWaste(600) + vat(0)
stage payments = total × 0.25 / 0.35 / 0.40
```
Capacity check: Σ `capacityKwp×qty` vs system kWp, tolerance `1e-9`; skipped if any chosen model lacks a rating. Money formatted via `toLocaleString` 2dp.

**Performance** (`computePerformance`, L1174-1235):
```
per slope: kWp × radiance × 0.85 × (1 − shading/100)   (slope skipped + warning if radiance missing/≤0)
used = gen × selfConsumption%;  export = gen − used
savings = used × tariff/100;  SEG = export × segRate/100;  year1 = savings + SEG
r = (1 − degradation/100) × 1.05;  30yr = year1 × (r^30 − 1)/(r − 1)
ROI% = year1 / total system price × 100
```
Note "Radiance" is used directly as kWh per kWp per year (despite the kWh/m² label); pitch and bearing do not feed generation.

## 5. End of flow — what exists and what does NOT

The flow ends on the read-only Performance page with a single `← Back to price` button. **There is no terminal action of any kind.**

Verified absent (case-insensitive grep over all non-base64 lines returned zero hits for: `postcode`, `email`, `phone`, `signature`, `submit`, `fetch(`, `XMLHttp`, `print(`, `download`, `clipboard`, `mailto`, `<form`, `sessionStorage`, `address`, `sold`, `quote`, `pdf`, `alert(`, `confirm(`):

- NO customer name, address, postcode, phone, email; NO job reference/ID, surveyor name, date, notes, photos.
- NO submit / save-to-server / export / PDF / print / share / email / copy / "job sold" / accept / signature.
- NO network calls at all (only the Google Fonts import). Persistence is one localStorage key holding ONE job; "New job" overwrites it. No job list/history.
- NO quote document, proposal, T&Cs, or MCS/DNO fields. No MPAN, phase selection, meter/consumer-unit details (phase is implied only by the inverter model picked).
- Finance: ONLY the `Using finance?` select (No/Yes/Maybe) adding a £0/£250/£125 "Finance admin fee". No lender, APR, term, monthly payment or deposit-on-finance logic.
- VAT/discount/delivery/labour rate: displayed but not editable (0 / 0 / 600 / 585).
- The only customer-specific data: `Customer's annual consumption (kWh)` and the tariff/SEG/self-consumption assumptions.

Commercial outputs that DO exist: itemised price breakdown, total system price, 25/35/40 staged payments, year-1 income, 30-year income, year-1 ROI.

## 6. Visual design system

**Tokens** (L7-33). Dark applies via `@media (prefers-color-scheme: dark)` on `:root:not([data-theme="light"])` and via `:root[data-theme="dark"]`; nothing in the JS sets `data-theme` (no theme toggle).

| token | light | dark | role |
|---|---|---|---|
| `--paper` | #ECEFE9 | #141F1C | page bg, input bg |
| `--paper-raised` | #F8FAF6 | #1B2925 | cards, tiles |
| `--ink` | #1E2A28 | #E7EDE7 | text |
| `--ink-soft` | #56655F | #9DB0A8 | labels, hints |
| `--line` | #C7D0C6 | #33443D | borders |
| `--accent` | #C9852A | #E3A34A | amber: primary buttons, current step, key figures |
| `--accent-ink` | #241202 | #1B1204 | text on accent |
| `--panel` | #1C2B3D | #0D1824 | PV panel fill |
| `--panel-line` | #3E5872 | #2C4054 | PV panel stroke |
| `--good` | #2F6E5C | #4FA98C | done steps, best flag, hints |
| `--warn` | #B23B30 | #E07A6B | errors, obstructions, invalid |
| `--pitch` | #2B6CB0 | #5B9BD9 | pitch chip edge (class currently unused) |
| `--shadow` | `0 1px 0 rgba(30,42,40,.05)` | `0 1px 0 rgba(0,0,0,.2)` | |

Hard-coded exception: confirmed badge `#22C55E` bg / `#16A34A` border / `#fff` text (L117); `.obs-btn.active` text `#fff`. Tints are made with `color-mix(in srgb, <token> N%, …)` throughout. Body paints a 28px graph-paper grid (L38-41), though the first layer is an opaque `--paper` gradient that covers it.

**Fonts** (L5): Big Shoulders Display 600/700/800 (h1-h3, slope names, panel names, result heads, grand total, calc value 36px/800); IBM Plex Sans 400-700 (body/UI); IBM Plex Mono 400-600 (`.num`, number inputs, stats, SVG dim labels; tabular-nums); Poppins 700/800 is imported but never used.

**Scale**: `.app` max-width 640px, padding `16px 16px 48px`. Radii: cards 12, stat strip/diagrams 10, buttons 9, badges/chips 8, inputs/toggles/banners 7, small buttons 6. Card padding 16 (slope/result cards: 0 with 12-14px head + 14px body). Type: card `h2` 15px uppercase ink-soft; labels 12.5px; inputs 15px; hints 12.5px/1.5; stepper 10.5px; stat label 10px uppercase, value `clamp(14px,4.4vw,18px)`; nav buttons 14.5px/700, padding 13px.

**Components**: stepper (grid of bordered pills, number over label; `.current` amber fill, `.done` green text/border, `.reachable` pointer); cards; `.toggle-pair` segmented control (2 or `.three`, active = amber); `.param-chip` (4px coloured left edge — red X, green Y — label+input 78px right-aligned mono, two 30×30 −/+ buttons); `.status-line.incomplete/.ok`; `.confirmed-badge`; `.calc-result` hero block; `.add-btn` dashed full-width; `.nav-row` (flex, secondary ghost Back + primary amber Next, `[disabled]` opacity .45) + `.nav-note` red centred; `.panel-card` with `::before` "BEST OUTPUT" flag and `.selected` amber border; `.stat-strip` sticky top:0 z-5, 4-col (or `.three`) with 1px line gaps; `.result-card` tinted head; SVG classes (`roof-outline`, dashed `clearance-outline`, `panel-rect` / `.excluded` dashed-hollow / `.auto-excluded` red-tint not-allowed, `obstruction-rect`, `crosshair-line`, `dim-*` with `dim-major` amber); `.shift-row` range + Center; `.inv-line`; `.warn-banner` / `.info-banner`; `.totals-row` dashed rows, `.grand` 20px display amber with 2px top rule; `.deposit-table`.

**Required-field styling** (L171-183): `input:required:invalid, select:required:invalid` get red border + 8% red wash site-wide; suppressed inside `.slope-card.confirmed`.

**Responsive**: mobile-first, a single breakpoint `@media (min-width:560px)` turning `.param-grid` from 2 to 4 columns (L290-292). Logo `clamp(52px,14vw,68px)`. Ergonomics: `inputmode="decimal"`, big +/- buttons, full-width 13px-padded buttons, sticky stat strips, `touch-action:none` on the SVG only while marking, `window.scrollTo(0,0)` on page change, `vector-effect:non-scaling-stroke` on all SVG strokes, viewport `viewport-fit=cover` + safe-area padding in the wrapper. Unused CSS leftovers: `.slope-form`, `.depth-field`, `.readout-list`, `.pitch-warn`, `.param-chip.depth/.height/.width/.pitch`, `input.calc-value`, `.site-foot`.

## 7. Interaction model

- **Reachability**: `state.maxPage` is the high-water mark. Any `[data-goto]` button raises `maxPage` to its target and navigates; forward moves are refused if the current page has an empty `[required]` field (L2129-2136). Stepper pills are clickable when `page ≤ maxPage`; forward jumps apply the same required-field check on the current page only (L2121-2127). `maxPage` is never lowered except by New job. `page`/`maxPage` persist, so a reload resumes on the same step.
- **Loophole**: a forward stepper jump from Elevations checks only required fields, NOT `allSlopesComplete()`, so once later pages are unlocked an edited/unconfirmed elevation does not block jumping ahead.
- **Confirm pattern**: values save live on every keystroke; `Use these values` only flips `slope.confirmed = true` and swaps in the green `Values confirmed` badge in place (no navigation). Any typed edit to any field of a rect/complex elevation (except the name), switching shape tab, or `Use Calculated Value` clears it, re-shows the button and re-disables Next (L2181-2202, L2217, L2233).
- **Bug**: the +/- stepper buttons change the value and rebuild the card but do NOT clear `confirmed` (L2266-2284), so a confirmed elevation can be altered while still showing the green tick. They round to 1dp and start from `min` when blank.
- **Typing stability**: footers/calc result are patched in place rather than rebuilding the card (decimal-typing caret bug, L1486-1492, L2171-2179); full rebuilds restore focus + selection (L1584-1611).
- **New job**: first tap → label `Tap again to clear`, red `.confirming` style, auto-reverts after 4000 ms; second tap → `state = defaultState()`, save, re-render (L2473-2490). No native dialog.
- **Obstruction marking**: tap `+ Add obstruction` to arm one slope (module-level `obstructionModeSlopeId`, cleared on leaving page 3); hover shows crosshair + live coordinates from the bottom-left; pointerdown→drag→pointerup draws a box via `getScreenCTM().inverse()`; boxes ≤40 mm in either dimension are discarded; mode disarms after each box; delete via the ✕ handle or the list `Remove`. Despite the Step-3 hint text, the Layout page cannot add/remove obstructions (read-only list; `attachObstructionPointerHandlers` is wired only to `obstructionsContainer`, L2318).
- **Tap-to-exclude**: on Layout, tapping a `.panel-rect` toggles its index in `exclusions['slopeId|panelId']`; auto-excluded (obstruction-overlapping) panels ignore taps. Exclusions are index-based, so they shift meaning if orientation, clearances or dimensions change; they are kept per panel model.
- **Complex freeform layout**: starts as 2 stacked cells (portrait) or 2 side-by-side (landscape), or 1 / 0 if max is 1 / 0; tap a dashed `+` neighbour cell to add (up to max), tap a panel to remove (min 1 remains); switching orientation resets to the default pair only until `customized`; layout is trimmed if max is later reduced.
- **Shift sliders** re-render only the SVG + readouts (`updateSlopeResultBody`); orientation/exclusion changes re-render the whole results list.
- **Price page** recomputes on every `input` event; pricing fields on Parameters (scaffold, AC run, materials) write into `state.pricing` / slopes too.
- **Housekeeping gaps**: removing a slope leaves orphaned `exclusions` / `obstructions` / `complexLayouts` entries; slope labels are injected into HTML unescaped (`esc()` exists but is only used for option labels); clearing a Parameters number stores `0` (so a cleared required field re-renders as `0` and then passes the required check).

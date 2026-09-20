// The renderer.
//
// Architecture, in one sentence: the master PDF's pages ARE the document, and
// generation replaces only the regions that carry dynamic values.
//
// Of the quotation's 24 pages, 14 carry nothing dynamic; of the ROI's 15, nine
// do. Those pages are never touched, so they are not "close to" the master -
// they are byte-for-byte the master, including its artwork, its licensed fonts
// and the whole Contract of Sale. Rebuilding them in HTML could only introduce
// drift into legal copy, which is why it is not done.
//
// For a dynamic region the sequence is: cover the placeholder with the
// background colour sampled from the master at that exact spot, then draw the
// canonical value on the master's own baseline, in the master's size, at the
// master's alignment.

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import type { Binding } from '../bindings';
import {
  MCS_SECTION,
  PROJECTION_SCALARS,
  bindingsFor,
  projectionBindings
} from '../bindings';
import {
  GENERATION_ERRORS,
  GenerationError,
  type DocumentInput,
  type DocumentType,
  type ProjectionRow,
  type UnresolvedVariable
} from '../types';
import { fontEmbedder, substituteFor } from './fonts';
import { loadTemplate, type Region } from './regions';

/** Pad the mask very slightly so antialiased edges of the old glyphs go too. */
const MASK_PAD = 0.6;

/** Keep drawn text from butting right up against neighbouring content. */
const NEIGHBOUR_GAP = 2;

export interface RenderResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Pages dropped from the master, and why. */
  omittedPages: { page: number; reason: string }[];
  /** Regions drawn, for the generation-details view. */
  regionsDrawn: number;
}

// ---------------------------------------------------------------------------
// Text fitting
// ---------------------------------------------------------------------------

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Fitted {
  lines: string[];
  size: number;
}

/**
 * Fit a value into the space the master left for it.
 *
 * The available width is the binding's `limitX1` where one is given, because
 * the extracted box is the PLACEHOLDER's width, not the cell's - `{{panel}}`
 * occupies 35pt of a 200pt table cell, and judging overflow by 35pt would
 * reject every real panel name.
 *
 * Shrinking stops at `minSize`. Below that the text is not legible and the
 * brief is explicit that it must not be shrunk further, so the document fails
 * instead - a visible, fixable error rather than unreadable small print.
 */
function fit(
  text: string,
  binding: Binding,
  region: Region,
  font: PDFFont,
  maxWidth: number
): Fitted {
  const maxLines = binding.maxLines ?? 1;
  const floor = binding.minSize ?? region.size;

  if (binding.overflow === 'truncate') {
    let out = text;
    while (
      out.length > 1 &&
      font.widthOfTextAtSize(`${out}…`, region.size) > maxWidth
    ) {
      out = out.slice(0, -1);
    }
    return { lines: [out === text ? text : `${out}…`], size: region.size };
  }

  if (binding.overflow === 'wrap') {
    const lines = wrapText(text, font, region.size, maxWidth);
    if (lines.length <= maxLines) return { lines, size: region.size };
  }

  // shrink (and wrap's fallback): step down in quarter points.
  for (let size = region.size; size >= floor - 1e-9; size -= 0.25) {
    const lines =
      binding.overflow === 'wrap'
        ? wrapText(text, font, size, maxWidth)
        : [text];
    const widest = Math.max(
      ...lines.map((l) => font.widthOfTextAtSize(l, size))
    );
    if (widest <= maxWidth && lines.length <= maxLines) return { lines, size };
  }

  throw new GenerationError(
    GENERATION_ERRORS.REGION_OVERFLOW,
    `"${text}" does not fit the space the master allows for ${binding.variable} ` +
      `(${maxWidth.toFixed(1)}pt at no less than ${floor}pt). Shorten the value ` +
      'or adjust the template map - it will not be shrunk to illegibility.'
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function colour(rgbBytes: number[]) {
  const [r, g, b] = rgbBytes;
  return rgb(r / 255, g / 255, b / 255);
}

function textColour(c: number[]) {
  // pdfplumber reports non-stroking colour in 0-1 device components.
  if (c.length >= 3) return rgb(c[0], c[1], c[2]);
  const g = c.length ? c[0] : 0;
  return rgb(g, g, g);
}

function drawRegion(
  page: PDFPage,
  pageHeight: number,
  region: Region,
  binding: Binding,
  text: string,
  font: PDFFont
): void {
  // The mask covers the placeholder, plus any literal the binding absorbs:
  // the trailing "%" where the canonical figure is a payback in years, and the
  // leading "£" where the value is money right-aligned to a column edge.
  const takesSuffix =
    (binding.absorbSuffix || binding.reflowSuffix) && region.suffixX1 != null;
  const maskX1 = takesSuffix ? region.suffixX1! : region.x1;
  const maskX0 =
    binding.absorbPrefix && region.prefixX0 != null
      ? region.prefixX0
      : region.x0;

  // How much room the value really has.
  //
  // The default is measured from the master: the nearest glyph either side on
  // the same line. The placeholder's own box is NOT the bound - `{{date}}` is
  // 36pt wide and "20 September 2026" is 76pt, so using it would reject almost
  // every real value. A binding may override where the visual cell is tighter
  // than the nearest ink suggests.
  const leftBound =
    binding.limitX0 ??
    (binding.absorbPrefix ? region.freeX0Abs : region.freeX0);
  const rightBound =
    binding.limitX1 ?? (takesSuffix ? region.freeX1Abs : region.freeX1);

  const maxWidth =
    (region.align === 'right' ? maskX1 - leftBound : rightBound - maskX0) -
    NEIGHBOUR_GAP;

  // A reflowed literal travels with the value, so it is measured with it.
  const drawn = binding.reflowSuffix ? `${text}${region.suffix}` : text;
  const { lines, size } = fit(drawn, binding, region, font, maxWidth);

  const lineHeight = size * 1.15;

  // The placeholder itself is not covered - it is not there. Only a literal
  // the binding takes over needs hiding: the "£" a money value now carries,
  // the "%" that a payback in years makes wrong, the comma that moves along
  // with a reflowed name. Those are single glyphs on flat ground, which is why
  // painting over them is safe where painting over a whole region would not be.
  const covers: [number, number][] = [];
  // A literal region (the hard-printed £600.00, £0 and panel warranty) is not
  // a placeholder, so the redaction step left it in place on purpose - it is
  // ordinary page text until something decides it is dynamic. Here it is, so
  // it has to be covered before the canonical value goes over the top.
  if (region.literal) covers.push([region.x0, region.x1]);
  if (binding.absorbPrefix && region.prefixX0 != null) {
    covers.push([region.prefixX0, region.x0]);
  }
  if (takesSuffix) covers.push([region.x1, region.suffixX1!]);

  // The glyph box recorded for a region is the box of ITS glyphs; an adjacent
  // "%" or "£" can ascend or descend past it, so a cover sized to the region
  // leaves a sliver behind. Covers are given the font's full line box instead.
  const overshoot = region.size * 0.3;
  for (const [from, to] of covers) {
    page.drawRectangle({
      x: from - MASK_PAD,
      y:
        pageHeight -
        region.bottom -
        MASK_PAD -
        overshoot -
        (lines.length - 1) * lineHeight,
      width: to - from + MASK_PAD * 2,
      height:
        region.bottom -
        region.top +
        MASK_PAD * 2 +
        overshoot * 2 +
        (lines.length - 1) * lineHeight,
      color: colour(region.background)
    });
  }

  lines.forEach((line, i) => {
    const width = font.widthOfTextAtSize(line, size);
    const x = region.align === 'right' ? maskX1 - width : maskX0;
    page.drawText(line, {
      x,
      y: region.baseline - i * lineHeight,
      size,
      font,
      color: textColour(region.colour)
    });
  });
}

// ---------------------------------------------------------------------------
// Value lookup
// ---------------------------------------------------------------------------

function projectionValue(
  rows: ProjectionRow[],
  token: string
): string | undefined {
  const binding = projectionBindings().find((b) => b.token === token);
  if (!binding) return undefined;
  const row = rows.find((r) => r.n === binding.n);
  if (!row) return undefined;
  const raw = row[binding.field];
  return binding.field === 'pencePerKwh'
    ? raw.toFixed(2)
    : raw.toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
}

interface Lookup {
  binding: Binding;
  text: string;
}

function lookup(
  region: Region,
  input: DocumentInput,
  bindings: readonly Binding[],
  unresolved: UnresolvedVariable[],
  pageNumber: number
): Lookup | null {
  const declared = bindings.find((b) => b.token === region.name);

  if (declared) {
    const resolved = input.variables[declared.variable];
    if (resolved != null) return { binding: declared, text: resolved };
    if (!declared.required && declared.fallback != null) {
      return { binding: declared, text: declared.fallback };
    }
    const existing = unresolved.find((u) => u.variable === declared.variable);
    if (existing) existing.pages.push(pageNumber);
    else
      unresolved.push({
        variable: declared.variable,
        reason: `No value for ${declared.variable}.`,
        pages: [pageNumber]
      });
    return null;
  }

  // Numbered ROI cells and the scalars derived from the projection.
  const scalar = PROJECTION_SCALARS[region.name];
  if (scalar) {
    const resolved = input.variables[scalar];
    if (resolved != null) {
      return {
        binding: {
          token: region.name,
          variable: scalar,
          required: true,
          overflow: 'shrink',
          minSize: 8
        },
        text: resolved
      };
    }
  }

  const cell = projectionValue(input.projection, region.name);
  if (cell != null) {
    return {
      binding: {
        token: region.name,
        variable: `roi.projection.${region.name}`,
        required: true,
        overflow: 'shrink',
        minSize: 8
      },
      text: cell
    };
  }

  unresolved.push({
    variable: `<unbound token {{${region.name}}}>`,
    reason:
      `The master contains {{${region.name}}} on page ${pageNumber} but no ` +
      'binding declares what fills it. An unbound token would be printed ' +
      'literally to a customer, so generation stops.',
    pages: [pageNumber]
  });
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderDocument(
  input: DocumentInput
): Promise<RenderResult> {
  const documentType: DocumentType = input.documentType;
  const { map, templateBytes } = await loadTemplate(documentType);

  if (map.masterSha256 !== input.masterSha256) {
    throw new GenerationError(
      GENERATION_ERRORS.MASTER_CHANGED,
      'This revision was snapshotted against a different master PDF. ' +
        'Re-rendering it would not reproduce what the customer was sent.'
    );
  }

  const bindings = bindingsFor(documentType);
  const pdf = await PDFDocument.load(templateBytes);
  const embed = fontEmbedder(pdf);

  const omittedPages: { page: number; reason: string }[] = [];
  const skip = new Set<number>();
  if (documentType === 'QuotationContract' && !MCS_SECTION.enabled) {
    for (const page of MCS_SECTION.pages) {
      skip.add(page);
      omittedPages.push({ page, reason: MCS_SECTION.reason });
    }
  }

  const unresolved: UnresolvedVariable[] = [];
  let regionsDrawn = 0;

  for (const spec of map.pages) {
    if (spec.static || skip.has(spec.page)) continue;
    const page = pdf.getPage(spec.page - 1);
    const { height } = page.getSize();

    for (const region of spec.regions) {
      // A token the master draws and then covers is not part of the document.
      // Everything this renderer draws is appended, so filling one would put
      // it ON TOP of the value that replaced it - which is exactly what made
      // every row of the ROI's savings table show two overlapping numbers.
      if (region.hidden) continue;
      const found = lookup(region, input, bindings, unresolved, spec.page);
      if (!found) continue;
      const font = await embed(substituteFor(region.font));
      drawRegion(page, height, region, found.binding, found.text, font);
      regionsDrawn++;
    }
  }

  if (unresolved.length) {
    throw new GenerationError(
      GENERATION_ERRORS.UNRESOLVED_VARIABLE,
      unresolved.length === 1
        ? unresolved[0].reason
        : `${unresolved.length} values could not be resolved.`,
      unresolved
    );
  }

  // Remove withheld pages last, so page indices stayed stable while drawing.
  for (const page of Array.from(skip).sort((a, b) => b - a))
    pdf.removePage(page - 1);

  // The artifact is a flat PDF: no form fields, no scripts, and no leftover
  // metadata from the master ("Presale Automation ... DO NOT TOUCH").
  pdf.setTitle('');
  pdf.setAuthor('Simple Solar (SW) Ltd');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setProducer('Simple Solar Operations');
  pdf.setCreator('Simple Solar Operations');

  // Both timestamps come from the SNAPSHOT, never from the clock. Left to
  // pdf-lib they default to the moment of saving, which would make the same
  // snapshot render to different bytes every time - and "deterministic from a
  // stored snapshot" is the property the whole revision model rests on. With
  // them pinned, re-rendering revision 1 in a year reproduces revision 1.
  const generatedAt = new Date(input.provenance.generatedAt);
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  const bytes = await pdf.save({ useObjectStreams: false });

  return {
    bytes,
    pageCount: pdf.getPageCount(),
    omittedPages,
    regionsDrawn
  };
}

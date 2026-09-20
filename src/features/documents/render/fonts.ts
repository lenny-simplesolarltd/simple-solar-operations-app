// Fonts for redrawn text.
//
// The masters embed SUBSET fonts, and a subset cannot draw text it was not
// subsetted for. Measured: the Poppins, Helvetica Neue and Arial subsets carry
// no `cmap` table at all, and the Times subset's cmap is missing `&`, `8`,
// `J`, `X` and `Z` - so a customer named Jones, or any price containing an 8,
// would render as nothing. Re-embedding the masters' own fonts is therefore
// not available, and full font files have to be supplied.
//
// What is supplied, and why:
//
//   Times New Roman -> Tinos (Apache-2.0). Metrically compatible by design,
//     and verified here: all 95 printable ASCII glyphs have identical advance
//     widths, and each master token's measured width reproduces to within
//     0.1pt. Line breaks, column alignment and right-aligned edges are
//     therefore exact; letterforms are near-identical but not glyph-identical.
//
//   Poppins -> Poppins (SIL OFL). The master's own typeface, so ROI text is
//     glyph-identical.
//
//   Helvetica Neue -> Poppins. There is no metric-compatible libre clone of
//     Helvetica Neue. Rather than leave eight numeric values on ROI page 4 in a
//     visibly different typeface from everything around them, they are set in
//     Poppins - which the rest of that page already uses. A deliberate,
//     recorded substitution, not an accident. Replacing it with a licensed
//     Helvetica Neue is a one-line change here.

import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PDFDocument, PDFFont } from 'pdf-lib';

export const FONT_FILES = {
  'Tinos-Regular': 'Tinos-Regular.ttf',
  'Tinos-Bold': 'Tinos-Bold.ttf',
  'Poppins-Regular': 'Poppins-Regular.ttf',
  'Poppins-Bold': 'Poppins-Bold.ttf'
} as const;

export type FontKey = keyof typeof FONT_FILES;

/**
 * Master font name (as embedded, minus the subset tag) -> the file we draw
 * with. Anything not listed is a font the masters do not use for dynamic text;
 * hitting one is a bug in the bindings, not something to guess at.
 */
const SUBSTITUTIONS: Record<string, FontKey> = {
  TimesNewRomanPSMT: 'Tinos-Regular',
  'TimesNewRomanPS-BoldMT': 'Tinos-Bold',
  'TimesNewRomanPS-ItalicMT': 'Tinos-Regular',
  'Poppins-Regular': 'Poppins-Regular',
  'Poppins-Bold': 'Poppins-Bold',
  'Poppins-Italic': 'Poppins-Regular',
  'Poppins-BoldItalic': 'Poppins-Bold',
  HelveticaNeue: 'Poppins-Regular',
  'HelveticaNeue-Bold': 'Poppins-Bold',
  ArialMT: 'Poppins-Regular',
  'Arial-BoldMT': 'Poppins-Bold',
  'Arimo-Regular': 'Poppins-Regular',
  Calibri: 'Poppins-Regular',
  'Calibri-Bold': 'Poppins-Bold'
};

/** Substitutions that are not metric-compatible, reported with every render. */
export const APPROXIMATE_SUBSTITUTIONS: readonly string[] = [
  'HelveticaNeue',
  'HelveticaNeue-Bold',
  'ArialMT',
  'Arial-BoldMT',
  'Calibri',
  'Calibri-Bold'
];

export function substituteFor(masterFont: string): FontKey {
  const key = masterFont.includes('+') ? masterFont.split('+')[1] : masterFont;
  const found = SUBSTITUTIONS[key];
  if (!found) {
    throw new Error(
      `No font substitution registered for "${masterFont}". Add one in ` +
        'src/features/documents/render/fonts.ts rather than letting the ' +
        'renderer pick something.'
    );
  }
  return found;
}

function fontRoot(): string {
  return path.join(
    process.env.DOCUMENT_TEMPLATE_ROOT || process.cwd(),
    'document-templates/fonts'
  );
}

export type EmbedFont = (key: FontKey) => Promise<PDFFont>;

/**
 * Embeds fonts on demand, once each.
 *
 * Subsetting is deliberately OFF. pdf-lib's subsetter drops glyphs from these
 * files - a name rendered "Jane Okonkwo" comes out "J" - so the whole font is
 * carried instead. It costs roughly 500KB per typeface, which is why fonts are
 * embedded lazily: a quotation pulls in Tinos and never touches Poppins, and an
 * ROI does the reverse.
 */
export function fontEmbedder(pdf: PDFDocument): EmbedFont {
  pdf.registerFontkit(fontkit);
  const cache = new Map<FontKey, Promise<PDFFont>>();
  return (key) => {
    const existing = cache.get(key);
    if (existing) return existing;
    const loading = readFile(path.join(fontRoot(), FONT_FILES[key])).then(
      (bytes) => pdf.embedFont(bytes, { subset: false })
    );
    cache.set(key, loading);
    return loading;
  };
}

// Loading and validating the extracted geometry maps.
//
// The maps are checked in next to the master they describe and carry the
// master's SHA-256. If the two disagree the master was re-exported without
// re-running the extractor, and every coordinate in the map is suspect - so we
// refuse rather than draw text at stale positions.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  GenerationError,
  GENERATION_ERRORS,
  type DocumentType
} from '../types';

export interface Region {
  token: string;
  name: string;
  /** Present on regions located by literal text rather than a {{token}}. */
  literal?: string;
  x0: number;
  x1: number;
  /** Top-left-origin glyph box, used for the mask. */
  top: number;
  bottom: number;
  /** Bottom-left-origin text baseline - what pdf-lib draws from. */
  baseline: number;
  font: string;
  size: number;
  colour: number[];
  /** Literal drawn immediately before the token (the money column's "£"). */
  prefix: string;
  prefixX0: number | null;
  suffix: string;
  suffixX1: number | null;
  /**
   * Nearest content either side on the same line - the real constraint on how
   * far a value may grow, derived from the master rather than guessed at.
   * The `Abs` pair measures the same thing as if the adjacent literals the
   * binding absorbs were not there.
   */
  freeX0: number;
  freeX1: number;
  freeX0Abs: number;
  freeX1Abs: number;
  /**
   * The master draws this token and then covers it, so it is not part of the
   * visible document. Recorded rather than dropped, because the extractor
   * genuinely finds it and a future master could stop hiding it.
   */
  hidden?: boolean;
  align: 'left' | 'right';
  background: number[];
  background_uniform: boolean;
}

export interface RegionPage {
  page: number;
  width: number;
  height: number;
  static: boolean;
  regions: Region[];
}

export interface RegionMap {
  master: string;
  masterSha256: string;
  extractorVersion: number;
  pageCount: number;
  regionCount: number;
  pages: RegionPage[];
}

export const TEMPLATE_DIRS: Record<DocumentType, string> = {
  QuotationContract: 'document-templates/presale/quotation',
  ROI: 'document-templates/presale/roi'
};

/**
 * Template identity, bumped by hand when a binding or the master changes in a
 * way that alters output. Stored on every revision so a document can always be
 * traced to the template that made it.
 */
export const TEMPLATE_VERSIONS: Record<DocumentType, string> = {
  QuotationContract: '1.0.0',
  ROI: '1.0.0'
};

export const TEMPLATE_IDS: Record<DocumentType, string> = {
  QuotationContract: 'presale/quotation',
  ROI: 'presale/roi'
};

function templateRoot(): string {
  // Templates are repository data, not bundled assets: they are read from disk
  // at runtime so a master can be replaced without a rebuild.
  return process.env.DOCUMENT_TEMPLATE_ROOT || process.cwd();
}

export interface LoadedTemplate {
  map: RegionMap;
  /**
   * The master with its `{{placeholders}}` removed from the content stream
   * (`scripts/documents/build-template.py`). Drawing onto this is what makes
   * "zero unresolved placeholders" true of the text layer and not merely of
   * the picture: a covered token is still found by copy-paste, search and a
   * screen reader.
   */
  templateBytes: Uint8Array;
}

export async function loadTemplate(
  documentType: DocumentType
): Promise<LoadedTemplate> {
  const dir = path.join(templateRoot(), TEMPLATE_DIRS[documentType]);
  const [mapRaw, masterBytes, templateBytes] = await Promise.all([
    readFile(path.join(dir, 'regions.v1.json'), 'utf8'),
    readFile(path.join(dir, 'master.pdf')),
    readFile(path.join(dir, 'master.redacted.pdf'))
  ]);

  const map = JSON.parse(mapRaw) as RegionMap;
  // The ORIGINAL master is the integrity anchor: the region map's coordinates
  // and the redacted build are both derived from it, so it is the thing whose
  // change has to invalidate them.
  const actual = createHash('sha256').update(masterBytes).digest('hex');

  if (actual !== map.masterSha256) {
    throw new GenerationError(
      GENERATION_ERRORS.MASTER_CHANGED,
      `The ${documentType} master PDF has changed since its region map was ` +
        'extracted. Re-run scripts/documents/extract-regions.py and review the ' +
        'template map before generating any customer document.'
    );
  }

  return { map, templateBytes: new Uint8Array(templateBytes) };
}

/** Every region on a page, indexed by token name (a name may repeat). */
export function regionsByName(page: RegionPage): Map<string, Region[]> {
  const out = new Map<string, Region[]>();
  for (const region of page.regions) {
    const list = out.get(region.name);
    if (list) list.push(region);
    else out.set(region.name, [region]);
  }
  return out;
}

// The test that stops a placeholder reaching a customer.
//
// Every {{token}} in a master must be bound to something. An unbound one is
// not a compile error and not a runtime error until the moment a document is
// generated - by which point it is a quotation with "{{surveyor}}" printed on
// it. So the region maps are read here and checked against the bindings.

import { describe, expect, it } from 'vitest';

import quotationMap from '../../../../document-templates/presale/quotation/regions.v1.json';
import roiMap from '../../../../document-templates/presale/roi/regions.v1.json';
import {
  PROJECTION_ROWS,
  PROJECTION_SCALARS,
  QUOTATION_BINDINGS,
  ROI_BINDINGS,
  projectionBindings
} from '../bindings';
import type { Binding } from '../bindings';

interface RegionLike {
  name: string;
  token: string;
  align: string;
  size: number;
  freeX0: number;
  freeX1: number;
  hidden?: boolean;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}
interface MapLike {
  pageCount: number;
  regionCount: number;
  pages: { page: number; static: boolean; regions: RegionLike[] }[];
}

const tokensOf = (map: MapLike) =>
  map.pages.flatMap((p) => p.regions.map((r) => r.name));

function unbound(map: MapLike, bindings: readonly Binding[]): string[] {
  const known = new Set(bindings.map((b) => b.token));
  const projection = new Set(projectionBindings().map((b) => b.token));
  const scalars = new Set(Object.keys(PROJECTION_SCALARS));
  return Array.from(
    new Set(
      tokensOf(map).filter(
        (t) => !known.has(t) && !projection.has(t) && !scalars.has(t)
      )
    )
  );
}

describe('template maps', () => {
  it('match the masters that were audited', () => {
    // A changed page count means the master was re-exported; every coordinate
    // in the map is then suspect and the maps must be rebuilt.
    expect((quotationMap as MapLike).pageCount).toBe(24);
    expect((roiMap as MapLike).pageCount).toBe(15);
  });

  it('leave the static pages static', () => {
    const q = (quotationMap as MapLike).pages.filter((p) => p.static).length;
    const r = (roiMap as MapLike).pages.filter((p) => p.static).length;
    // 14 of the quotation's 24 pages carry nothing dynamic - including the
    // whole Contract of Sale - and nine of the ROI's 15.
    expect(q).toBe(14);
    expect(r).toBe(9);
  });
});

describe('bindings', () => {
  it('cover every token in the quotation master', () => {
    expect(unbound(quotationMap as MapLike, QUOTATION_BINDINGS)).toEqual([]);
  });

  it('cover every token in the ROI master', () => {
    expect(unbound(roiMap as MapLike, ROI_BINDINGS)).toEqual([]);
  });

  it('bind no token the master does not contain', () => {
    // A binding for a token that is not there is dead weight that will be
    // believed by the next person to read the file.
    const quotationTokens = new Set(tokensOf(quotationMap as MapLike));
    const roiTokens = new Set(tokensOf(roiMap as MapLike));
    expect(
      QUOTATION_BINDINGS.filter((b) => !quotationTokens.has(b.token)).map(
        (b) => b.token
      )
    ).toEqual([]);
    expect(
      ROI_BINDINGS.filter((b) => !roiTokens.has(b.token)).map((b) => b.token)
    ).toEqual([]);
  });

  it('give every optional binding a fallback and every required one none', () => {
    for (const b of [...QUOTATION_BINDINGS, ...ROI_BINDINGS]) {
      if (b.required) expect(b.fallback).toBeUndefined();
      else expect(b.fallback).toBeTypeOf('string');
    }
  });

  it('never allow shrinking below a legible size', () => {
    for (const b of [...QUOTATION_BINDINGS, ...ROI_BINDINGS]) {
      if (b.overflow === 'shrink')
        expect(b.minSize ?? 0).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('the numbered ROI projection tokens', () => {
  const numbered = Array.from(
    new Set(tokensOf(roiMap as MapLike).filter((t) => /^\d+$/.test(t)))
  );

  it('are all decoded by the row formula', () => {
    const covered = new Set([
      ...projectionBindings().map((b) => b.token),
      ...Object.keys(PROJECTION_SCALARS)
    ]);
    expect(numbered.filter((t) => !covered.has(t))).toEqual([]);
  });

  it('decode to exactly one row and field each', () => {
    // If a token resolved to two rows the table would be silently wrong, and
    // nothing downstream would notice.
    const seen = new Map<string, number>();
    for (const b of projectionBindings()) {
      seen.set(b.token, (seen.get(b.token) ?? 0) + 1);
    }
    expect(Array.from(seen.entries()).filter(([, n]) => n > 1)).toEqual([]);
  });

  it('cover the master’s 59 numbered tokens', () => {
    expect(numbered).toHaveLength(59);
  });

  it('index rows as ordinals, not years', () => {
    // The master's last three rows are years 20, 25 and 30 at ordinals 16, 17
    // and 18 - the detail that makes the whole decoding work.
    expect(PROJECTION_ROWS.slice(-3)).toEqual([
      { n: 16, year: 20 },
      { n: 17, year: 25 },
      { n: 18, year: 30 }
    ]);
  });
});

describe('regions the master draws but does not show', () => {
  // The ROI's page 8 carries a complete, occluded copy of page 7's table: the
  // same thirty no-solar tokens, drawn first and then covered. They are in the
  // content stream, so the extractor finds them - and because everything the
  // renderer draws is appended, filling one puts it ON TOP of the value that
  // replaced it. That is exactly what made every row show two numbers.
  const roiPages = (roiMap as MapLike).pages;
  const page8 = roiPages.find((p) => p.page === 8)!;

  it('marks the occluded duplicate on ROI page 8', () => {
    const hidden = page8.regions.filter((r) => r.hidden);
    expect(hidden).toHaveLength(30);
  });

  it('leaves exactly the with-solar figures to be drawn', () => {
    const drawn = page8.regions
      .filter((r) => !r.hidden)
      .map((r) => Number(r.name));
    expect(drawn).toHaveLength(30);
    // 101-154 only: nine table rows of three, plus the three oval callouts.
    expect(drawn.every((n) => n >= 101 && n <= 154)).toBe(true);
  });

  it('never leaves two drawn regions overlapping on a page', () => {
    // The general guard. Two regions that occupy the same place cannot both be
    // legible, so an overlap means either a hidden duplicate nobody noticed or
    // a template map that has drifted from its master.
    const overlaps: string[] = [];
    for (const map of [quotationMap as MapLike, roiMap as MapLike]) {
      for (const page of map.pages) {
        const drawn = page.regions.filter((r) => !r.hidden);
        for (let i = 0; i < drawn.length; i++) {
          for (let j = i + 1; j < drawn.length; j++) {
            const a = drawn[i];
            const b = drawn[j];
            const apart =
              a.x1 <= b.x0 ||
              b.x1 <= a.x0 ||
              a.bottom <= b.top ||
              b.bottom <= a.top;
            if (!apart)
              overlaps.push(
                `p${page.page}: {{${a.name}}} overlaps {{${b.name}}}`
              );
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });
});

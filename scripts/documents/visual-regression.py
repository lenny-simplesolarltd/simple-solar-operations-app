#!/usr/bin/env python3
"""
Visual regression: master page vs generated page, measured rather than eyeballed.

    python3 scripts/documents/visual-regression.py \
        --master document-templates/presale/quotation/master.pdf \
        --generated tmp/document-samples/typical-QuotationContract.pdf \
        --regions document-templates/presale/quotation/regions.v1.json \
        --out tmp/visual-regression/quotation

Both PDFs are rasterised at the same resolution and compared pixel for pixel.

Two numbers are reported per page, and they answer different questions:

  STATIC drift - every dynamic region is masked out of BOTH images before
      comparison, so what remains is the part of the page that was supposed to
      be untouched: artwork, tables, borders, and the whole Contract of Sale.
      This should be zero. A non-zero value means the generator disturbed
      something it had no business touching.

  DYNAMIC coverage - the same regions, compared on their own. This is EXPECTED
      to differ: that is where the customer's name replaced a placeholder. It
      is reported so a region that changed nothing (a value that silently
      failed to draw) is as visible as one that changed too much.

Pages the generator deliberately withheld are reported as omitted and skipped,
not counted as drift.

Writes a `report.json`, and a side-by-side + difference PNG for any page whose
static drift is above the threshold.

Requires: Pillow, pdftoppm (dev machine only).
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

# Ignore single-level differences: two renderers antialias fractionally
# differently and that is not drift worth reporting.
TOLERANCE = 12
# Fraction of static pixels allowed to differ before a page is flagged.
THRESHOLD = 0.0002


def rasterise(pdf: Path, dpi: int, into: Path, tag: str) -> list:
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), "-png", str(pdf), str(into / tag)],
        check=True,
    )
    return sorted(into.glob(f"{tag}-*.png"))


def mask_regions(img: Image.Image, regions: list, scale: float, pad: int = 3):
    """Paint every dynamic region flat, so only static content is compared."""
    draw = ImageDraw.Draw(img)
    for r in regions:
        # Mask the extent a value is PERMITTED to occupy, not the placeholder's
        # own box. A real value is almost always wider than the `{{token}}` it
        # replaces, so masking the token box would count the overhang as drift
        # in the static layer - which is exactly what it is not.
        x0 = min(r["x0"], r.get("prefixX0") or r["x0"], r.get("freeX0Abs", r["x0"]))
        x1 = max(r["x1"], r.get("suffixX1") or r["x1"], r.get("freeX1Abs", r["x1"]))
        # Generous vertically: a replacement value may be taller or wrap.
        draw.rectangle(
            [
                x0 * scale - pad,
                r["top"] * scale - pad - r["size"] * scale,
                x1 * scale + pad,
                r["bottom"] * scale + pad + r["size"] * scale * 2,
            ],
            fill=(255, 0, 255),
        )


def differing(a: Image.Image, b: Image.Image) -> tuple:
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB")).convert("L")
    binary = diff.point(lambda v: 255 if v > TOLERANCE else 0)
    count = sum(binary.histogram()[1:])
    return count, binary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True)
    ap.add_argument("--generated", required=True)
    ap.add_argument("--regions", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dpi", type=int, default=100)
    ap.add_argument("--omitted", default="", help="comma-separated master pages withheld")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    region_map = json.loads(Path(args.regions).read_text())
    omitted = {int(p) for p in args.omitted.split(",") if p.strip()}

    by_page = {p["page"]: p["regions"] for p in region_map["pages"]}

    with tempfile.TemporaryDirectory() as tmp:
        tmpd = Path(tmp)
        masters = rasterise(Path(args.master), args.dpi, tmpd, "m")
        generated = rasterise(Path(args.generated), args.dpi, tmpd, "g")

        # Withheld master pages have no counterpart, so line the two up.
        kept = [i + 1 for i in range(len(masters)) if i + 1 not in omitted]
        if len(kept) != len(generated):
            raise SystemExit(
                f"page count mismatch: master keeps {len(kept)} pages, generated "
                f"has {len(generated)}"
            )

        pages = []
        worst = 0.0
        for gen_index, master_page in enumerate(kept):
            m = Image.open(masters[master_page - 1]).convert("RGB")
            g = Image.open(generated[gen_index]).convert("RGB")
            if m.size != g.size:
                g = g.resize(m.size)

            scale = m.width / region_map["pages"][master_page - 1]["width"]
            regions = by_page.get(master_page, [])

            dyn_count, _ = differing(m, g) if regions else (0, None)

            m_masked, g_masked = m.copy(), g.copy()
            mask_regions(m_masked, regions, scale)
            mask_regions(g_masked, regions, scale)
            static_count, static_diff = differing(m_masked, g_masked)

            total = m.width * m.height
            static_ratio = static_count / total
            worst = max(worst, static_ratio)

            record = {
                "masterPage": master_page,
                "generatedPage": gen_index + 1,
                "regions": len(regions),
                "staticDiffPixels": static_count,
                "staticDiffRatio": round(static_ratio, 8),
                "dynamicDiffPixels": dyn_count,
                "pass": static_ratio <= THRESHOLD,
            }
            if regions and dyn_count == 0:
                record["warning"] = (
                    "page has dynamic regions but is pixel-identical to the "
                    "master - no value was drawn"
                )
            pages.append(record)

            if static_ratio > THRESHOLD:
                side = Image.new("RGB", (m.width * 3, m.height), "white")
                side.paste(m, (0, 0))
                side.paste(g, (m.width, 0))
                side.paste(static_diff.convert("RGB"), (m.width * 2, 0))
                side.save(out / f"page-{master_page:02d}-diff.png")

        report = {
            "master": args.master,
            "generated": args.generated,
            "dpi": args.dpi,
            "tolerance": TOLERANCE,
            "staticThreshold": THRESHOLD,
            "omittedMasterPages": sorted(omitted),
            "worstStaticRatio": round(worst, 8),
            "pass": all(p["pass"] for p in pages),
            "pages": pages,
        }
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    failed = [p for p in pages if not p["pass"]]
    warned = [p for p in pages if "warning" in p]
    print(f"{Path(args.generated).name}: {len(pages)} pages compared, "
          f"{len(failed)} over static threshold, worst {worst:.6%}")
    for p in failed:
        print(f"    page {p['masterPage']}: {p['staticDiffRatio']:.6%} static drift")
    for p in warned:
        print(f"    page {p['masterPage']}: {p['warning']}")
    print(f"    report -> {out / 'report.json'}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

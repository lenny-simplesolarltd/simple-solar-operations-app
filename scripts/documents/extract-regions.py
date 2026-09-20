#!/usr/bin/env python3
"""
Extract every dynamic region from a master PDF into a geometry map.

This is a DEVELOPMENT tool, not runtime code. It runs once per master and its
output (`regions.v1.json`) is checked in; the application only ever reads the
JSON. Re-run it when a master PDF changes -- the recorded master SHA-256 makes
a stale map fail loudly rather than mis-position text.

    python3 scripts/documents/extract-regions.py \
        document-templates/presale/quotation/master.pdf \
        document-templates/presale/quotation/regions.v1.json \
        --dpi 150

Requires: pdfplumber, Pillow (dev machine only).

What it records per region, and why:

  bounds      the tight glyph box of the `{{token}}` run, in PDF points with a
              top-left origin (pdfplumber's convention). The renderer converts
              to pdf-lib's bottom-left origin itself.
  font/size   taken from the first non-brace glyph, so `{{x}}` reports the
              font the VALUE should be drawn in, not the braces'.
  align       inferred: tokens sharing an x1 within ALIGN_EPS are a
              right-aligned column (the Qty column on quotation p3 is the
              motivating case). Everything else is left.
  background  sampled from a rendered raster just outside the glyph box. The
              renderer paints this colour over the token before drawing the
              value, so a token on the ROI cover's yellow disc is covered in
              yellow, not white. `background_uniform` is false when the
              samples disagree, which means a flat mask would be visible and
              the region needs hand review.
  suffix      any literal character immediately following the token on the
              same line (the ROI cover's `ROI: {{roi}}%`). Recorded so a
              binding can absorb it -- rendering "8.4 years" requires covering
              that stray `%`.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

try:
    import pdfplumber
    from PIL import Image
except ImportError as exc:  # pragma: no cover - dev tool
    sys.exit(f"missing dev dependency: {exc}. pip install pdfplumber Pillow")

TOKEN = re.compile(r"\{\{[^{}]{0,40}\}\}")
ALIGN_EPS = 0.75  # pt: tokens whose right edges agree this closely are a column
PAD = 1.5         # pt: how far outside the glyph box to sample background


def page_runs(page):
    """Every {{token}} on the page, as a dict of geometry + style."""
    chars = sorted(page.chars, key=lambda c: (round(c["top"], 1), c["x0"]))
    text = "".join(c["text"] for c in chars)
    runs = []
    for m in TOKEN.finditer(text):
        cs = chars[m.start():m.end()]
        # The braces are drawn in the same font as the value, but taking a
        # non-brace glyph is safer: some exports style braces separately.
        body = [c for c in cs if c["text"] not in "{}"] or cs
        ref = body[0]
        # A literal character butted up against the closing brace, on the same
        # baseline, within half a space.
        # A literal immediately BEFORE the token, on the same baseline. The
        # quotation's money column prints a static "£" then right-aligns the
        # number to the column edge, so a large total would grow leftward over
        # its own currency sign. Binding them together as one right-aligned
        # unit is the only layout that survives a six-figure price.
        prefix = ""
        prefix_x0 = None
        head = chars[m.start() - 1:m.start()] if m.start() else []
        if head:
            h = head[0]
            if abs(h["top"] - ref["top"]) < 1.0 and cs[0]["x0"] - h["x1"] < ref["size"] * 0.3:
                if not h["text"].isspace():
                    prefix = h["text"]
                    prefix_x0 = round(h["x0"], 2)

        suffix = ""
        suffix_x1 = None
        tail = chars[m.end():m.end() + 1]
        if tail:
            t = tail[0]
            if abs(t["top"] - ref["top"]) < 1.0 and t["x0"] - cs[-1]["x1"] < ref["size"] * 0.3:
                if not t["text"].isspace():
                    suffix = t["text"]
                    # Right edge of the suffix glyph, so a binding that absorbs
                    # it knows exactly how far the mask must reach.
                    suffix_x1 = round(t["x1"], 2)
        runs.append({
            "token": m.group(0),
            "name": m.group(0)[2:-2],
            "x0": round(min(c["x0"] for c in cs), 2),
            "x1": round(max(c["x1"] for c in cs), 2),
            "top": round(min(c["top"] for c in cs), 2),
            "bottom": round(max(c["bottom"] for c in cs), 2),
            "font": ref["fontname"].split("+")[-1],
            "size": round(ref["size"], 2),
            # The TEXT BASELINE in PDF coordinates (bottom-left origin), taken
            # from the text matrix's translation. pdf-lib draws from the
            # baseline, so this is what it needs - the glyph box's bottom edge
            # is the descender line and would sit the value a few points low.
            "baseline": round(ref["matrix"][5], 2),
            "colour": [round(v, 4) for v in (ref.get("non_stroking_color") or [0])],
            "prefix": prefix,
            "prefixX0": prefix_x0,
            "suffix": suffix,
            "suffixX1": suffix_x1,
        })
    return runs


def literal_runs(page, wanted):
    """
    Locate hard-printed text that must become dynamic.

    The masters print three values as ordinary text rather than placeholders -
    `£600.00` delivery, `£0` VAT and the panel warranty term - all of which are
    editable fields in the application. They need regions like any token, but
    hand-typing their coordinates would silently rot the first time a master is
    re-exported. So they are declared by the string to look for, and located
    here.

    `wanted` entries: {name, page, match, occurrence?}. `match` is matched
    against the page's glyph stream with whitespace collapsed.
    """
    chars = sorted(page.chars, key=lambda c: (round(c["top"], 1), c["x0"]))
    text = "".join(c["text"] for c in chars)
    out = []
    for spec in wanted:
        needle = spec["match"]
        starts = [m.start() for m in re.finditer(re.escape(needle), text)]
        idx = spec.get("occurrence", 1) - 1
        if idx >= len(starts):
            raise SystemExit(
                f"extra region {spec['name']!r}: found {len(starts)} occurrence(s) "
                f"of {needle!r} on page {spec['page']}, wanted #{idx + 1}. "
                "The master changed - update extra-regions.json."
            )
        # `match` is the anchor, which may include surrounding words to stay
        # unambiguous ("Panels30"); `select` is the part that is actually
        # dynamic ("30"). Bounds cover `select` only.
        select = spec.get("select", needle)
        off = needle.index(select)
        cs = chars[starts[idx] + off:starts[idx] + off + len(select)]
        ref = cs[0]
        out.append({
            "token": f"[[{spec['name']}]]",
            "name": spec["name"],
            "literal": select,
            "x0": round(min(c["x0"] for c in cs), 2),
            "x1": round(max(c["x1"] for c in cs), 2),
            "top": round(min(c["top"] for c in cs), 2),
            "bottom": round(max(c["bottom"] for c in cs), 2),
            "font": ref["fontname"].split("+")[-1],
            "size": round(ref["size"], 2),
            "baseline": round(ref["matrix"][5], 2),
            "colour": [round(v, 4) for v in (ref.get("non_stroking_color") or [0])],
            "prefix": "",
            "prefixX0": None,
            "suffix": "",
            "align": spec.get("align", "left"),
        })
    return out


def free_space(page, runs):
    """
    How much room a region actually has before it hits something.

    The extracted box is the PLACEHOLDER's box, and a placeholder is almost
    always narrower than the value that replaces it - `{{date}}` is 35pt wide,
    "20 September 2026" is 76pt. Using the placeholder as the bound would
    reject nearly every real value.

    So for each region we look along its own baseline for the nearest glyph to
    the left and to the right that is NOT part of the region itself, and record
    those edges. That is the real constraint: the point at which drawn text
    would start overlapping other content. Where there is nothing either side,
    the page's own margin is used.
    """
    chars = [c for c in page.chars if not c["text"].isspace()]
    margin = 36.0  # pt: a standard page margin, used when a line is otherwise empty
    right_margin = round(page.width - margin, 2)
    for r in runs:
        mid = (r["top"] + r["bottom"]) / 2
        # Same visual line: the glyph's vertical span contains this region's
        # midline. Cheaper and more robust than comparing baselines.
        line = [c for c in chars if c["top"] - 0.5 <= mid <= c["bottom"] + 0.5]

        def bounds(x0, x1):
            left = [c["x1"] for c in line if c["x1"] <= x0 + 0.1]
            right = [c["x0"] for c in line if c["x0"] >= x1 - 0.1]
            return (round(max(left), 2) if left else margin,
                    round(min(right), 2) if right else right_margin)

        r["freeX0"], r["freeX1"] = bounds(r["x0"], r["x1"])
        # The same bounds measured as if the adjacent literals were gone, for
        # bindings that absorb them: where "£" is redrawn as part of the value,
        # the "£" is not an obstacle to it - the label cell beyond it is.
        ax0 = r.get("prefixX0") if r.get("prefixX0") is not None else r["x0"]
        ax1 = r.get("suffixX1") if r.get("suffixX1") is not None else r["x1"]
        r["freeX0Abs"], r["freeX1Abs"] = bounds(ax0, ax1)


def infer_alignment(runs):
    """Right-align tokens that share a right edge with another token."""
    by_edge = defaultdict(list)
    for r in runs:
        by_edge[round(r["x1"] / ALIGN_EPS)].append(r)
    for bucket in by_edge.values():
        if len(bucket) > 1 and len({round(r["x0"], 1) for r in bucket}) > 1:
            for r in bucket:
                r["align"] = "right"
    for r in runs:
        r.setdefault("align", "left")


def sample_background(img, page_w, page_h, run):
    """Median colour just outside the glyph box; flags non-uniform samples."""
    sx, sy = img.width / page_w, img.height / page_h
    pts = []
    for fx, fy in ((-PAD, 0.5), (PAD, 0.5), (0.5, -PAD), (0.5, PAD)):
        x = run["x0"] + fx if fx < 0 else (run["x1"] + fx if fx > 0.5 else
                                           run["x0"] + (run["x1"] - run["x0"]) * fx)
        y = run["top"] + fy if fy < 0 else (run["bottom"] + fy if fy > 0.5 else
                                            run["top"] + (run["bottom"] - run["top"]) * fy)
        px, py = int(x * sx), int(y * sy)
        if 0 <= px < img.width and 0 <= py < img.height:
            pts.append(img.getpixel((px, py))[:3])
    if not pts:
        return [255, 255, 255], True
    # Uniform when every sample is within a couple of levels of the first.
    base = pts[0]
    uniform = all(max(abs(a - b) for a, b in zip(p, base)) <= 6 for p in pts)
    mid = sorted(pts)[len(pts) // 2]
    return [mid[0], mid[1], mid[2]], uniform


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("out")
    ap.add_argument("--dpi", type=int, default=150)
    args = ap.parse_args()

    master = Path(args.master)
    digest = hashlib.sha256(master.read_bytes()).hexdigest()

    extras_path = master.parent / "extra-regions.json"
    extras = json.loads(extras_path.read_text()) if extras_path.exists() else []

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["pdftoppm", "-r", str(args.dpi), "-png", str(master), f"{tmp}/p"],
            check=True,
        )
        rasters = sorted(Path(tmp).glob("p-*.png"))

        with pdfplumber.open(master) as pdf:
            pages = []
            total = 0
            for i, page in enumerate(pdf.pages):
                runs = page_runs(page)
                infer_alignment(runs)
                # Literal regions keep the alignment they declare, so they are
                # added after inference rather than before it.
                runs += literal_runs(page, [e for e in extras if e["page"] == i + 1])
                free_space(page, runs)
                runs.sort(key=lambda r: (r["top"], r["x0"]))
                if runs:
                    img = Image.open(rasters[i]).convert("RGB")
                    for r in runs:
                        bg, uniform = sample_background(img, page.width, page.height, r)
                        r["background"] = bg
                        r["background_uniform"] = uniform
                total += len(runs)
                pages.append({
                    "page": i + 1,
                    "width": round(page.width, 2),
                    "height": round(page.height, 2),
                    "static": not runs,
                    "regions": runs,
                })

    out = {
        "master": str(master).replace("\\", "/"),
        "masterSha256": digest,
        "extractorVersion": 1,
        "pageCount": len(pages),
        "regionCount": total,
        "pages": pages,
    }
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n")
    static = sum(1 for p in pages if p["static"])
    print(f"{master.name}: {len(pages)} pages, {static} static, {total} regions -> {args.out}")


if __name__ == "__main__":
    main()

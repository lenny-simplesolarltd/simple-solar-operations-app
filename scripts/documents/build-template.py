#!/usr/bin/env python3
"""
Build the redacted master a generated document is drawn onto.

Covering a `{{token}}` with a white rectangle hides it from the eye but leaves
it in the PDF's text layer, where `pdftotext`, copy-paste, search and screen
readers all still find it. The brief requires ZERO unresolved placeholders in
the finished artifact, and "invisible but present" does not meet that bar.

So the placeholders are REMOVED from the page content stream, once, at build
time. Everything else is untouched - same operators, same images, same embedded
fonts, same legal text - so the redacted master is the master in every respect
except that the placeholders are gone.

    python3 scripts/documents/build-template.py \
        document-templates/presale/quotation/master.pdf \
        document-templates/presale/quotation/master.redacted.pdf

The one subtlety. The quotation (Google Docs) draws one glyph per operator, so
a placeholder could simply be deleted. The ROI (Slides) draws whole sentences
per operator - `(Hi {{name}}, here is you personalised )` is a single `Tj` - and
deleting glyphs from the middle of that would pull the rest of the sentence
leftward.

So instead of deleting, the token's glyphs are replaced by an exact kerning
advance: the operator becomes a `TJ` array whose numeric entry skips precisely
the width the placeholder occupied. Every surviving glyph therefore stays on
the same point of the page it was on before, which is what makes the static
parts of the document byte-identical in appearance.

Requires: PyPDF2 (dev machine only).
"""

import argparse
import re
import sys
from pathlib import Path

try:
    from PyPDF2 import PdfReader, PdfWriter
    from PyPDF2.generic import DecodedStreamObject, NameObject
except ImportError as exc:  # pragma: no cover - dev tool
    sys.exit(f"missing dev dependency: {exc}. pip install PyPDF2")

TOKEN = re.compile(r"\{\{[^{}]{0,40}\}\}")


# ---------------------------------------------------------------------------
# Font tables
# ---------------------------------------------------------------------------

def parse_tounicode(data: bytes) -> dict:
    """glyph id -> character, from a ToUnicode CMap's bfchar/bfrange sections."""
    text = data.decode("latin1")
    out = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            out[int(src, 16)] = chr(int(dst[:4], 16))
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, dst in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block
        ):
            base = int(dst[:4], 16)
            for i, code in enumerate(range(int(lo, 16), int(hi, 16) + 1)):
                out[code] = chr(base + i)
    return out


def parse_widths(descendant) -> tuple:
    """(glyph id -> advance in 1/1000 em, default advance)."""
    default = float(descendant.get("/DW", 1000))
    widths = {}
    w = descendant.get("/W")
    if w is None:
        return widths, default
    w = [x.get_object() for x in w.get_object()]
    i = 0
    while i < len(w):
        first = int(w[i])
        if i + 1 < len(w) and isinstance(w[i + 1], list):
            for j, value in enumerate(w[i + 1]):
                widths[first + j] = float(value.get_object())
            i += 2
        elif i + 2 < len(w):
            last, value = int(w[i + 1]), float(w[i + 2])
            for code in range(first, last + 1):
                widths[code] = value
            i += 3
        else:
            break
    return widths, default


def font_tables(page) -> dict:
    """Resource font name -> {'uni': {...}, 'w': {...}, 'dw': float}."""
    resources = page["/Resources"].get_object()
    fonts = resources.get("/Font")
    if not fonts:
        return {}
    tables = {}
    for name, ref in fonts.get_object().items():
        font = ref.get_object()
        tu = font.get("/ToUnicode")
        uni = parse_tounicode(tu.get_object().get_data()) if tu is not None else {}
        widths, default = {}, 1000.0
        if font.get("/Subtype") == "/Type0":
            descendant = font["/DescendantFonts"][0].get_object()
            widths, default = parse_widths(descendant)
        tables[name.lstrip("/").encode("latin1")] = {
            "uni": uni,
            "w": widths,
            "dw": default,
        }
    return tables


# ---------------------------------------------------------------------------
# Content stream scanning
# ---------------------------------------------------------------------------

def read_literal(data: bytes, i: int) -> tuple:
    """Parse a `( ... )` string starting at i. Returns (raw bytes, end index)."""
    assert data[i:i + 1] == b"("
    out = bytearray()
    depth = 1
    i += 1
    while i < len(data):
        c = data[i]
        if c == 0x5C:  # backslash
            nxt = data[i + 1]
            simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
            elif 0x30 <= nxt <= 0x37:
                j, digits = i + 1, ""
                while j < len(data) and len(digits) < 3 and 0x30 <= data[j] <= 0x37:
                    digits += chr(data[j])
                    j += 1
                out.append(int(digits, 8) & 0xFF)
                i = j
            else:
                out.append(nxt)
                i += 2
        elif c == 0x28:
            depth += 1
            out.append(c)
            i += 1
        elif c == 0x29:
            depth -= 1
            if depth == 0:
                return bytes(out), i + 1
            out.append(c)
            i += 1
        else:
            out.append(c)
            i += 1
    raise ValueError("unterminated string")


def write_literal(raw: bytes) -> bytes:
    """Re-encode bytes as a PDF literal string, escaping what must be escaped."""
    out = bytearray(b"(")
    for byte in raw:
        if byte in (0x28, 0x29, 0x5C):
            out += b"\\" + bytes([byte])
        elif byte == 0x0D:
            out += b"\\r"
        elif byte < 32 or byte > 126:
            out += f"\\{byte:03o}".encode("latin1")
        else:
            out.append(byte)
    out += b")"
    return bytes(out)


def gids(raw: bytes) -> list:
    return [int.from_bytes(raw[i:i + 2], "big") for i in range(0, len(raw) - 1, 2)]


def find_shows(data: bytes) -> list:
    """
    Every text-showing operator: (start, end, [(kind, payload)...], operator).

    Payload is a list of glyph-id runs and kerning numbers, in order, so a TJ
    array round-trips.
    """
    shows = []
    operands = []
    i = 0
    n = len(data)
    while i < n:
        c = data[i]
        if c == 0x28:
            raw, i = read_literal(data, i)
            operands.append(("str", raw, i))
            continue
        if c == 0x3C and data[i:i + 2] != b"<<":
            j = data.index(b">", i)
            text = data[i + 1:j].decode("latin1")
            text = "".join(ch for ch in text if ch in "0123456789abcdefABCDEF")
            if len(text) % 2:
                text += "0"
            operands.append(("str", bytes.fromhex(text), j + 1))
            i = j + 1
            continue
        if c == 0x5B:  # [
            operands.append(("open", None, i))
            i += 1
            continue
        if c == 0x5D:  # ]
            operands.append(("close", None, i))
            i += 1
            continue
        if data[i:i + 3] in (b"Tj\n", b"Tj ", b"Tj\r") or data[i:i + 2] == b"Tj" and (
            i + 2 >= n or data[i + 2] in b" \n\r\t/[(<"
        ):
            shows.append((operands[-1][2] if operands else i, i + 2, [operands[-1]], b"Tj"))
            operands = []
            i += 2
            continue
        if data[i:i + 2] == b"TJ" and (i + 2 >= n or data[i + 2] in b" \n\r\t/[(<"):
            k = len(operands) - 1
            while k >= 0 and operands[k][0] != "open":
                k -= 1
            if k >= 0:
                shows.append((operands[k][2], i + 2, operands[k + 1:], b"TJ"))
            operands = []
            i += 2
            continue
        if c in b"0123456789+-." and operands is not None:
            j = i
            while j < n and data[j] in b"0123456789+-.eE":
                j += 1
            operands.append(("num", data[i:j], i))
            i = j
            continue
        # Anything else resets the operand stack at the next operator boundary.
        if c in b" \n\r\t":
            i += 1
            continue
        j = i
        while j < n and data[j] not in b" \n\r\t/[(<":
            j += 1
        if data[i:j] not in (b"Tf", b"Tm", b"Td", b"TD", b"Tc", b"Tw", b"Tz", b"TL", b"Ts", b"Tr"):
            operands = []
        i = max(j, i + 1)
    return shows


FONT_OP = re.compile(rb"/([A-Za-z0-9._]+)\s+[\d.]+\s*Tf")


def redact_stream(data: bytes, tables: dict) -> tuple:
    """
    Replace every {{token}} with an exact kerning advance.

    Tokens are found across the WHOLE page, not within a single operator: the
    quotation draws one glyph per operator, so `{`, `{`, `f`, `u`... are
    eighteen separate operators and no one of them contains a token. The text
    is reassembled in stream order, tokens are located in that, and the spans
    are mapped back to the operators that own them.
    """
    shows = find_shows(data)
    if not shows:
        return data, 0

    # Decode every operator once, remembering which font it used.
    decoded = []
    for start, end, payload, _op in shows:
        fonts = FONT_OP.findall(data, 0, start)
        table = tables.get(fonts[-1], {}) if fonts else {}
        runs = [(kind, raw) for kind, raw, _pos in payload if kind in ("str", "num")]
        uni = table.get("uni", {})
        text = "".join(
            "".join(uni.get(g, "\ufffd") for g in gids(raw))
            for kind, raw in runs
            if kind == "str"
        )
        decoded.append({
            "start": start, "end": end, "runs": runs, "table": table, "text": text
        })

    joined = "".join(d["text"] for d in decoded)
    spans = [(m.start(), m.end()) for m in TOKEN.finditer(joined)]
    if not spans:
        return data, 0

    # Global character index -> (operator index, index within that operator).
    owner = []
    for i, d in enumerate(decoded):
        owner.extend((i, j) for j in range(len(d["text"])))

    doomed = {}
    for a, b in spans:
        for i, j in owner[a:b]:
            doomed.setdefault(i, set()).add(j)

    pieces = []
    last = 0
    removed = 0

    for i in sorted(doomed):
        d = decoded[i]
        widths = d["table"].get("w", {})
        default = d["table"].get("dw", 1000.0)
        drop = doomed[i]

        out = []
        cursor = 0
        for kind, raw in d["runs"]:
            if kind == "num":
                out.append(raw)
                continue
            keep = bytearray()
            for g in gids(raw):
                index = cursor
                cursor += 1
                if index in drop:
                    if keep:
                        out.append(write_literal(bytes(keep)))
                        keep = bytearray()
                    out.append(f"{-widths.get(g, default):.0f}".encode("latin1"))
                    removed += 1
                else:
                    keep += g.to_bytes(2, "big")
            if keep:
                out.append(write_literal(bytes(keep)))

        merged = []
        for item in out:
            if merged and item[:1] in b"-0123456789" and merged[-1][:1] in b"-0123456789":
                merged[-1] = f"{float(merged[-1]) + float(item):.0f}".encode("latin1")
            else:
                merged.append(item)

        pieces.append(data[last:d["start"]])
        # An operator that showed nothing but token glyphs is dropped entirely;
        # its kerning would advance a text position nothing else depends on.
        if any(item[:1] == b"(" for item in merged):
            pieces.append(b"[" + b" ".join(merged) + b"] TJ")
        last = d["end"]

    pieces.append(data[last:])
    return b"".join(pieces), removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("out")
    args = ap.parse_args()

    reader = PdfReader(args.master)
    writer = PdfWriter()
    total = 0

    for page in reader.pages:
        data = page.get_contents().get_data()
        redacted, removed = redact_stream(data, font_tables(page))
        total += removed
        if removed:
            stream = DecodedStreamObject()
            stream.set_data(redacted)
            page[NameObject("/Contents")] = stream
        writer.add_page(page)

    with open(args.out, "wb") as fh:
        writer.write(fh)

    print(f"{Path(args.master).name}: removed {total} placeholder glyphs -> {args.out}")


if __name__ == "__main__":
    main()

"""
The SRD's spell descriptions, in its own words, as data the game reads by spell id:
vendor/srd-spells/spells.json.

  python3 tools/srd-spells/build.py                      # download the sources, check them, write the JSON
  python3 tools/srd-spells/build.py --pdf SRD.pdf --md spells.md   # from copies already downloaded
  python3 tools/srd-spells/build.py --check              # build and check, write nothing
  python3 tools/srd-spells/build.py --srd52 SRD_CC_v5.2.pdf        # and compare the spell chapter with SRD 5.2's

The words are Wizards of the Coast's System Reference Document 5.2.1, CC BY 4.0: the official PDF
from D&D Beyond (SOURCES below, checked by its SHA-256). Its spell chapter is word for word the same
as SRD 5.2's (--srd52). A PDF's text comes out a line at a time, so where the paragraphs break, the
lists, the tables and the emphasis come from a Markdown conversion of the same document, the one the
rules engine's author keeps as its SRD reference (greghcarr/dnd-5e-srd-markdown, CC BY 4.0, pinned).

Then every spell is checked against its own text in the PDF (read a column at a time, from its name
to the next spell's), both ways, by letters and digits (spacing, punctuation and line breaks aside):
each paragraph, list item, heading and caption is in it, in order, every table cell is in it, and
nothing in it is left out. Where the Markdown and the PDF differ, the PDF's words are kept (FIXES),
and the build stops on anything else. Each spell is matched to the rules engine's starter pack by
name (vendor/dnd-srd-engine), with its level, school and classes; all 339 are in both. Needs
pdftotext (poppler-utils).

The JSON has, for each spell id, the SRD's name, its header lines as the SRD prints them (casting
time, with a reaction's trigger; range; components; duration) and its description as blocks: a
string is a paragraph, {"item"} a list item, {"heading"} a heading in a stat block (the creature a
spell summons), and {"table", "head", "caption"} a table (rows of cells; head: the first row is the
header). Paragraphs and cells keep the SRD's emphasis as _italic_ and **bold**.
"""
import argparse
import difflib
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PACK = os.path.join(ROOT, "vendor", "dnd-srd-engine", "starter-pack.json")
OUT = os.path.join(ROOT, "vendor", "srd-spells", "spells.json")

SOURCES = {
    "pdf": {
        "title": "System Reference Document 5.2.1",
        "url": "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf",
        "sha256": "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87",
    },
    "markdown": {
        "title": "dnd-5e-srd-markdown (SRD 5.2.1 in Markdown), spells.md",
        "url": "https://raw.githubusercontent.com/greghcarr/dnd-5e-srd-markdown/1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4/spells.md",
        "sha256": "3431f5b8f50fdb0c65cdf98f0164301c8757d20983d32b5ae9b5be7dc634bffb",
    },
}

# The attribution statement the SRD 5.2.1 asks for, word for word (its Legal Information page).
ATTRIBUTION = (
    "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, "
    "available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 "
    "International License, available at https://creativecommons.org/licenses/by/4.0/legalcode."
)

# Where the Markdown says more than the PDF: the PDF's words, and why.
FIXES = {
    # The PDF's paragraph stops at a comma: the rest of the sentence isn't in it (SRD 5.2 or 5.2.1). The
    # Markdown finishes it from elsewhere; we keep the SRD's words and mark the cut.
    ("telekinesis", "You can exert fine control on objects with your telekinetic grip, such as manipulating a simple tool, opening a door or a container, stowing or retrieving an item from an open container, or pouring the contents from a vial."):
        "You can exert fine control on objects with your telekinetic grip, such as manipulating a simple tool, …",
}

LEVEL = re.compile(r"^_(?:Level (\d) (\w+)|(\w+) Cantrip) \(([^)]*)\)_\s*$")
FIELD = re.compile(r"\*\*(Casting Time|Range|Components?|Duration):\*\*\s*")
BULLET = re.compile(r"^\s*(?:[-*]|•)\s+")


DOWNLOADS = tempfile.TemporaryDirectory(prefix="srd-spells-")


def fetch(source, path):
    """A source, downloaded unless it's given, and checked against its SHA-256."""
    if not path:
        path = os.path.join(DOWNLOADS.name, os.path.basename(source["url"]))
        print(f"downloading {source['url']}", file=sys.stderr)
        urllib.request.urlretrieve(source["url"], path)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if digest != source["sha256"]:
        sys.exit(f"{path}: SHA-256 {digest}, expected {source['sha256']} ({source['title']})")
    return path


def key(name):
    """A spell's name as the pack's ids have it: "Arcanist's Magic Aura" is arcanists-magic-aura."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "").replace("’", "")).strip("-")


def letters(text):
    """Letters and digits only, for comparing words with words whatever the spacing and punctuation."""
    text = unicodedata.normalize("NFKC", re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"[^0-9A-Za-z]", "", text)


# ---------------------------------------------------------------------------------------------
# The Markdown: spells, their header lines, their blocks.

def markdown_spells(path):
    text = open(path, encoding="utf-8-sig").read()
    lines = text[text.index("## Spell Descriptions"):].split("\n")
    spells, cur = [], None
    for i, line in enumerate(lines):
        if line.startswith("#### "):
            nxt = next((l for l in lines[i + 1:] if l.strip()), "")
            if LEVEL.match(nxt):
                cur = {"name": line[5:].strip(), "lines": []}
                spells.append(cur)
                continue
        if cur is not None:
            cur["lines"].append(line)
    return [entry(s["name"], s["lines"]) for s in spells]


def entry(name, lines):
    i = 0
    while not lines[i].strip():
        i += 1
    level_line = lines[i].strip().strip("_")
    i += 1
    # The header: "**Casting Time:** Action" and so on, a line each (or, once, two to a line).
    fields = {}
    while i < len(lines) and (not lines[i].strip() or (FIELD.search(lines[i]) and not fields.get("Duration"))):
        parts = FIELD.split(lines[i].strip())
        for k in range(1, len(parts) - 1, 2):
            fields["Components" if parts[k] == "Component" else parts[k]] = parts[k + 1].strip()
        i += 1
    return {"name": name, "level": level_line, "fields": fields, "blocks": blocks(lines[i:])}


def emphasis(text):
    """The Markdown's emphasis as _italic_ and **bold** (it writes italics both ways)."""
    return re.sub(r"(?<![*\w])\*(?!\*)([^*]+?)\*(?!\*)", r"_\1_", text.strip())


def blocks(lines):
    out, para = [], []

    def flush():
        if para:
            out.append(emphasis(" ".join(l.strip() for l in para)))
            para.clear()

    i = 0
    while i < len(lines):
        line, s = lines[i], lines[i].strip()
        if not s:
            flush()
        elif s.startswith("<table"):
            flush()
            j = i
            while "</table>" not in lines[j]:
                j += 1
            rows, head = table("\n".join(lines[i:j + 1]))
            block = {"table": rows, **({"head": True} if head else {})}
            # A bold line just before a table is its caption ("**Omens**").
            if out and isinstance(out[-1], str) and re.fullmatch(r"\*\*[^*]+\*\*", out[-1]):
                block = {**block, "caption": out.pop()[2:-2]}
            out.append(block)
            i = j
        elif re.match(r"^#{2,4} ", s):
            flush()
            out.append({"heading": re.sub(r"^#+ ", "", s)})
        elif BULLET.match(line):
            flush()
            out.append({"item": emphasis(BULLET.sub("", line))})
        elif para and s.startswith("**") and para[0].strip().startswith("**"):
            # A stat block's lines ("**AC** 15", "**HP** 10"): a line each.
            flush()
            para.append(line)
        else:
            para.append(line)
        i += 1
    flush()
    return out


def table(src):
    rows, head = [], False
    for n, tr in enumerate(re.findall(r"<tr>(.*?)</tr>", src, re.S)):
        cells = re.findall(r"<t([hd])([^>]*)>(.*?)</t[hd]>", tr, re.S)
        if n == 0 and cells and all(c[0] == "h" for c in cells):
            head = True
        row = []
        for kind, attrs, body in cells:
            span = re.search(r'colspan="(\d+)"', attrs)
            row += [emphasis(html.unescape(re.sub(r"<[^>]+>", "", body)))] + [""] * (int(span.group(1)) - 1 if span else 0)
        rows.append(row)
    # A stat block's abilities: score, modifier and save under "MOD SAVE", three abilities a row.
    if len(rows) == 3 and rows[1] and rows[1][0] == "STR":
        rows[0] = ["", "", "MOD", "SAVE"] * 3
        head = True
    return rows, head


# ---------------------------------------------------------------------------------------------
# The PDF: its spell chapter as text, to check the Markdown's words against.

FIRST_PAGE, LAST_PAGE = 107, 175  # "Spell Descriptions" to the page before "Rules Glossary"


def pdf_lines(path):
    """
    The spell chapter's lines in reading order: each page's left column top to bottom, then its
    right (pdftotext's own order wanders at column breaks), without page numbers and running heads.
    """
    out = subprocess.run(["pdftotext", "-bbox-layout", "-f", str(FIRST_PAGE), "-l", str(LAST_PAGE), path, "-"], check=True, capture_output=True, text=True).stdout
    lines = []
    for page in re.split(r"<page ", out)[1:]:
        width, height = (float(v) for v in re.match(r'width="([\d.]+)" height="([\d.]+)"', page).groups())
        found = []
        for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</line>', page, re.S):
            words = [html.unescape(w) for w in re.findall(r"<word[^>]*>(.*?)</word>", m.group(3), re.S)]
            text = " ".join(words).strip()
            x, y = float(m.group(1)), float(m.group(2))
            # The page number and the running head, at the foot of the page.
            if not text or (y > height - 60 and re.fullmatch(r"\d{1,3}|System Reference Document 5\.2(\.1)?", text)):
                continue
            found.append((0 if x < width / 2 else 1, y, x, text))
        lines += [t for *_, t in sorted(found)]
    return lines


def pdf_spells(path, names):
    """Each spell's text in the PDF (its letters), from its name to the next spell's name: they're in order."""
    lines = pdf_lines(path)
    level = re.compile(r"^(Level \d \w+|\w+ Cantrip) \(")
    starts = []
    at = 0
    for name in names:
        # Headings are set in a display face, wide enough apart that a word can come out in two ("A cid S plash").
        want = letters(name)
        i = next((k for k in range(at, len(lines)) if letters(lines[k]) == want and any(level.match(l) for l in lines[k + 1:k + 3])), None)
        if i is None:
            sys.exit(f"{name}: not found in the PDF's spell chapter")
        starts.append(i)
        at = i + 1
    starts.append(len(lines))
    return {name: letters(" ".join(lines[starts[n]:starts[n + 1]])) for n, name in enumerate(names)}


def check(spells, pdf, pack):
    """
    Each spell against its own text in the PDF, both ways: every block of the Markdown's is in it (a
    paragraph whole, or in a few long pieces where something else comes between its parts), and
    nothing in it is missing from the Markdown's blocks and header lines.
    """
    problems = []
    for s in spells:
        sid = key(s["name"])
        p = pack.get(sid)
        if not p:
            problems.append(f"{s['name']}: no spell {sid} in the pack")
            continue
        m = LEVEL.match(f"_{s['level']}_")
        level, school = (int(m.group(1)), m.group(2)) if m.group(1) else (0, m.group(3))
        classes = sorted(c.strip().lower() for c in m.group(4).split(","))
        if (level, school.lower(), classes) != (p["level"], p["school"], sorted(p["classes"])):
            problems.append(f"{s['name']}: level, school or classes differ from the pack's")
        own = pdf[s["name"]]
        seen = bytearray(len(own))
        after = 0

        def find(text):
            """The text in order after what came before it (or anywhere, failing that); what it covers is seen."""
            nonlocal after
            needle = letters(text)
            found = pieces(needle, own, after) or pieces(needle, own)
            for at, n in found or []:
                seen[at:at + n] = b"\x01" * n
                after = max(after, at + n)
            return found is not None

        def cell(text):
            """
            A table cell, anywhere in the spell: a table's cells come out of the PDF in its own order
            (a row's number between the lines of its text, a header's words a line each). A stat
            block's abilities are in small capitals there (Str, Dex).
            """
            hay = own.lower()
            found = pieces(letters(text).lower(), hay)
            for at, n in found or []:
                seen[at:at + n] = b"\x01" * n
            for w in filter(None, (letters(w).lower() for w in text.split())):
                for m in re.finditer(re.escape(w), hay):
                    seen[m.start():m.end()] = b"\x01" * len(w)
            return found is not None

        for name, value in [("name", s["name"]), ("level", s["level"]), *s["fields"].items()]:
            # The PDF says "Component:" for a few one-line headers.
            labelled = [f"{label}: {value}" for label in ([name, "Component"] if name == "Components" else [name])] if name in FIELD.pattern else [value]
            if not any(find(t) for t in labelled):
                problems.append(f"{s['name']}: its {name} isn't in the PDF ({value!r})")
        for b in s["blocks"]:
            if isinstance(b, dict) and "table" in b:
                if b.get("caption") and not find(b["caption"]):
                    problems.append(f"{s['name']}: a caption isn't in the PDF ({b['caption']!r})")
                for c in [c for r in b["table"] for c in r if letters(c)]:
                    if not cell(c):
                        problems.append(f"{s['name']}: a table cell isn't in the PDF ({c!r})")
                continue
            text = b if isinstance(b, str) else b.get("item") or b.get("heading")
            if not find(text):
                problems.append(f"{s['name']}: not in the PDF: {text[:160]!r}")
        unread = [own[a:b] for a, b in runs(seen) if b - a >= 3]
        if unread:
            problems.append(f"{s['name']}: in the PDF, not in the Markdown: {unread}")
    return problems


def runs(seen):
    """Where nothing was found: (start, end) of each run of unseen letters."""
    out, i = [], 0
    while i < len(seen):
        if seen[i]:
            i += 1
            continue
        j = i
        while j < len(seen) and not seen[j]:
            j += 1
        out.append((i, j))
        i = j
    return out


def pieces(text, hay, at=0, least=12):
    """
    Where the text is in hay, from `at` on: whole, or in a few long pieces in order (a stat block or
    a table can come between a paragraph's parts). The longest prefix found each time, none shorter
    than `least`. A list of (at, length), or None.
    """
    out = []
    while text:
        lo, hi = 0, len(text)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if hay.find(text[:mid], at) >= 0:
                lo = mid
            else:
                hi = mid - 1
        if lo < min(least, len(text)) or len(out) > 3:
            return None
        i = hay.find(text[:lo], at)
        out.append((i, lo))
        at = i + lo
        text = text[lo:]
    return out


def build(pdf, md):
    pack = {s["id"]: s for s in json.load(open(PACK))["spells"]}
    spells = markdown_spells(md)
    for s in spells:
        sid = key(s["name"])
        s["blocks"] = [FIXES.get((sid, b), b) if isinstance(b, str) else b for b in s["blocks"]]
    problems = check(spells, pdf_spells(pdf, [s["name"] for s in spells]), pack)
    missing = sorted(set(pack) - {key(s["name"]) for s in spells})
    problems += [f"{sid}: in the pack, not in the SRD's spells" for sid in missing]
    data = {
        "about": "Spell descriptions from the System Reference Document 5.2.1, in its own words, by the rules engine's spell id. Built by tools/srd-spells/build.py; see vendor/srd-spells/README.md.",
        "license": "CC-BY-4.0",
        "attribution": ATTRIBUTION,
        "sources": SOURCES,
        "changes": "Laid out as data (paragraphs, list items, stat-block headings, tables, emphasis as _italic_ and **bold**), apostrophes and quotes straight, and a stat block's ability table with its MOD and SAVE headings over their columns; the words otherwise as the SRD 5.2.1 PDF has them. Telekinesis: the PDF's paragraph on fine control stops mid-sentence, kept as it is and marked with an ellipsis.",
        "spells": {
            key(s["name"]): {
                "name": s["name"],
                "castingTime": s["fields"].get("Casting Time", ""),
                "range": s["fields"].get("Range", ""),
                "components": s["fields"].get("Components", ""),
                "duration": s["fields"].get("Duration", ""),
                "text": s["blocks"],
            }
            for s in sorted(spells, key=lambda s: key(s["name"]))
        },
    }
    return data, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[1], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", help="the SRD 5.2.1 PDF, already downloaded")
    ap.add_argument("--md", help="dnd-5e-srd-markdown's spells.md, already downloaded")
    ap.add_argument("--check", action="store_true", help="build and check, write nothing")
    ap.add_argument("--srd52", help="the SRD 5.2 PDF: compare its spell chapter with 5.2.1's, word for word")
    args = ap.parse_args()
    pdf = fetch(SOURCES["pdf"], args.pdf)
    if args.srd52:
        a, b = " ".join(pdf_lines(args.srd52)).split(), " ".join(pdf_lines(pdf)).split()
        diff = [op for op in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if op[0] != "equal"]
        for op, i1, i2, j1, j2 in diff:
            print(f"5.2: {' '.join(a[i1:i2])!r} 5.2.1: {' '.join(b[j1:j2])!r}")
        print(f"the spell chapter: {len(a)} words in SRD 5.2, {len(b)} in 5.2.1, {len(diff)} differences")
    data, problems = build(pdf, fetch(SOURCES["markdown"], args.md))
    for p in problems:
        print(f"problem: {p}", file=sys.stderr)
    if problems:
        sys.exit(f"{len(problems)} problems: nothing written")
    blocks = sum(len(s["text"]) for s in data["spells"].values())
    print(f"{len(data['spells'])} spells, {blocks} blocks, every one checked against the PDF")
    if not args.check:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"wrote {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()

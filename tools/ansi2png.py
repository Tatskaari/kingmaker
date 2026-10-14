"""Turn ANSI (24-bit SGR) text into StyledLine JSON, then a PNG via preview.py. Splits into one PNG per demo section."""
import json, re, subprocess, sys, os
S = os.path.dirname(os.path.abspath(__file__))
src, prefix = sys.argv[1], sys.argv[2]
text = open(src).read()
sections = re.split(r"\n(?=\x1b\[1;33m== )", text)
for n, sec in enumerate(sections):
    lines = []
    for raw in sec.split("\n"):
        spans, fg, bg, bold = [], None, None, False
        for part in re.split(r"(\x1b\[[0-9;]*m)", raw):
            m = re.fullmatch(r"\x1b\[([0-9;]*)m", part)
            if m:
                codes = [int(c) for c in m.group(1).split(";") if c != ""] or [0]
                i = 0
                while i < len(codes):
                    c = codes[i]
                    if c == 0: fg, bg, bold = None, None, False
                    elif c == 1: bold = True
                    elif c == 38 and codes[i+1] == 2: fg = "#%02x%02x%02x" % tuple(codes[i+2:i+5]); i += 4
                    elif c == 48 and codes[i+1] == 2: bg = "#%02x%02x%02x" % tuple(codes[i+2:i+5]); i += 4
                    i += 1
            elif part:
                s = {"text": part}
                if fg: s["fg"] = fg
                if bg: s["bg"] = bg
                if bold: s["bold"] = True
                spans.append(s)
        lines.append(spans or [{"text": " "}])
    out = os.path.join(S, f"{prefix}-{n}.json")
    json.dump(lines, open(out, "w"))
    subprocess.run(["python3", os.path.join(S, "preview.py"), out, os.path.join(S, f"{prefix}-{n}.png")], check=True)

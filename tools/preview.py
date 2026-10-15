"""Render StyledLine[] JSON to a PNG like a terminal would: a fixed cell grid,
block elements drawn as rectangles, glyphs from a monospace font with a symbol fallback."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

src = sys.argv[1]; out = sys.argv[2]
lines = json.load(open(src))
CW, CH = 10, 20
fonts = [ImageFont.truetype(p, 17) for p in [
    "/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf",
    "/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf",
    "/usr/share/fonts/gdouros-symbola/Symbola.ttf",
]]
bold = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 17)
W = max(sum(len(s["text"]) for s in l) for l in lines)
img = Image.new("RGB", (W * CW, len(lines) * CH), (16, 16, 20))
d = ImageDraw.Draw(img)
DEFAULT_FG = (200, 200, 200)

def col(h, default):
    if not h: return default
    n = int(h[1:], 16); return ((n >> 16) & 255, (n >> 8) & 255, n & 255)

_cache = {}
_notdef = {}
def has_glyph(font, ch):
    k = (id(font), ch)
    if k not in _cache:
        try:
            if id(font) not in _notdef:
                _notdef[id(font)] = bytes(font.getmask(""))
            m = font.getmask(ch)
            _cache[k] = ch == " " or (m.getbbox() is not None and bytes(m) != _notdef[id(font)])
        except Exception:
            _cache[k] = False
    return _cache[k]

def blend(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

BLOCKS = {"█": (0, 0, 1, 1), "▀": (0, 0, 1, .5), "▄": (0, .5, 1, 1), "▌": (0, 0, .5, 1), "▐": (.5, 0, 1, 1),
          "▁": (0, .875, 1, 1), "▂": (0, .75, 1, 1), "▃": (0, .625, 1, 1), "▔": (0, 0, 1, .125),
          "▖": (0, .5, .5, 1), "▗": (.5, .5, 1, 1), "▘": (0, 0, .5, .5), "▝": (.5, 0, 1, .5)}
SHADES = {"░": .25, "▒": .5, "▓": .75}

for y, line in enumerate(lines):
    x = 0
    for span in line:
        fg = col(span.get("fg"), DEFAULT_FG); bg = col(span.get("bg"), (16, 16, 20))
        for ch in span["text"]:
            x0, y0 = x * CW, y * CH
            d.rectangle([x0, y0, x0 + CW - 1, y0 + CH - 1], fill=bg)
            if ch in SHADES:
                d.rectangle([x0, y0, x0 + CW - 1, y0 + CH - 1], fill=blend(bg, fg, SHADES[ch]))
            elif ch in BLOCKS:
                a, b, c, e = BLOCKS[ch]
                d.rectangle([x0 + a * CW, y0 + b * CH, x0 + c * CW - 1, y0 + e * CH - 1], fill=fg)
            elif ch == "▚":
                d.rectangle([x0, y0, x0 + CW/2 - 1, y0 + CH/2 - 1], fill=fg); d.rectangle([x0 + CW/2, y0 + CH/2, x0 + CW - 1, y0 + CH - 1], fill=fg)
            elif ch == "▞":
                d.rectangle([x0 + CW/2, y0, x0 + CW - 1, y0 + CH/2 - 1], fill=fg); d.rectangle([x0, y0 + CH/2, x0 + CW/2 - 1, y0 + CH - 1], fill=fg)
            elif ch == "▙":
                d.rectangle([x0, y0, x0 + CW/2 - 1, y0 + CH - 1], fill=fg); d.rectangle([x0, y0 + CH/2, x0 + CW - 1, y0 + CH - 1], fill=fg)
            elif ch != " ":
                f = bold if span.get("bold") and has_glyph(bold, ch) else next((f for f in fonts if has_glyph(f, ch)), fonts[0])
                d.text((x0, y0 + 1), ch, font=f, fill=fg)
            x += 1
img.save(out)
print(out, img.size)

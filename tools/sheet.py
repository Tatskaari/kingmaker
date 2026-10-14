"""Put PNGs side by side on one sheet, each with a caption, scaled to a common height.

python3 tools/sheet.py OUT.png [--height 420] [--cols 4] A.png:caption B.png:caption ...
"""
import sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
out = args.pop(0)
height, cols = 420, 4
while args and args[0].startswith("--"):
    flag, value = args.pop(0), args.pop(0)
    if flag == "--height": height = int(value)
    if flag == "--cols": cols = int(value)
items = []
for a in args:
    path, _, caption = a.partition(":")
    im = Image.open(path).convert("RGB")
    # Trim the empty border the renderer leaves round the map.
    bg = im.getpixel((0, 0))
    mask = Image.new("RGB", im.size, bg)
    from PIL import ImageChops
    box = ImageChops.difference(im, mask).getbbox() or (0, 0, im.width, im.height)
    im = im.crop((max(0, box[0] - 10), max(0, box[1] - 10), min(im.width, box[2] + 10), min(im.height, box[3] + 10)))
    k = height / im.height
    items.append((im.resize((max(1, int(im.width * k)), height), Image.LANCZOS), caption or path))
font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf", 16)
cap = 26
rows = [items[i:i + cols] for i in range(0, len(items), cols)]
width = max(sum(im.width for im, _ in r) + 12 * (len(r) + 1) for r in rows)
sheet = Image.new("RGB", (width, len(rows) * (height + cap + 12) + 12), (16, 16, 20))
d = ImageDraw.Draw(sheet)
y = 12
for r in rows:
    x = 12
    for im, caption in r:
        sheet.paste(im, (x, y + cap))
        d.text((x, y + 4), caption, font=font, fill=(220, 210, 180))
        x += im.width + 12
    y += height + cap + 12
sheet.save(out)
print(out, sheet.size)

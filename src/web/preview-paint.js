// The PR preview's screens (src/web/preview.tsx), painted on their canvases a cell at a time, as a
// terminal would: each cell's background, then its character in the middle of its own cell, so a
// glyph from a fallback font can't push the rest of the row along. Box and block characters are
// drawn as lines and rectangles, so they join up whatever the font (as xterm.js draws them).
(() => {
  const { palette, background, screens } = JSON.parse(document.getElementById("screens").textContent);
  // The browser page's font stack (src/web/page/client.js).
  const FONT = '"Adwaita Mono", "JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", monospace';
  const SIZE = 15;
  const LINE = 19;

  // Box drawing: a character's arms (up, right, down, left), 1 light, 2 heavy, 3 double.
  const BOX = {
    "─": [0, 1, 0, 1], "━": [0, 2, 0, 2], "│": [1, 0, 1, 0], "┃": [2, 0, 2, 0],
    "┌": [0, 1, 1, 0], "┐": [0, 0, 1, 1], "└": [1, 1, 0, 0], "┘": [1, 0, 0, 1],
    "╭": [0, 1, 1, 0], "╮": [0, 0, 1, 1], "╰": [1, 1, 0, 0], "╯": [1, 0, 0, 1],
    "├": [1, 1, 1, 0], "┤": [1, 0, 1, 1], "┬": [0, 1, 1, 1], "┴": [1, 1, 0, 1], "┼": [1, 1, 1, 1],
    "┏": [0, 2, 2, 0], "┓": [0, 0, 2, 2], "┗": [2, 2, 0, 0], "┛": [2, 0, 0, 2],
    "┣": [2, 2, 2, 0], "┫": [2, 0, 2, 2], "┳": [0, 2, 2, 2], "┻": [2, 2, 0, 2], "╋": [2, 2, 2, 2],
    "═": [0, 3, 0, 3], "║": [3, 0, 3, 0], "╔": [0, 3, 3, 0], "╗": [0, 0, 3, 3], "╚": [3, 3, 0, 0], "╝": [3, 0, 0, 3],
    "╠": [3, 3, 3, 0], "╣": [3, 0, 3, 3], "╦": [0, 3, 3, 3], "╩": [3, 3, 0, 3], "╬": [3, 3, 3, 3],
    "╤": [0, 3, 1, 3], "╧": [1, 3, 0, 3], "╟": [3, 1, 3, 0], "╢": [3, 0, 3, 1], "╪": [1, 3, 1, 3], "╫": [3, 1, 3, 1],
    "╞": [1, 3, 1, 0], "╡": [1, 0, 1, 3], "╥": [0, 1, 3, 1], "╨": [3, 1, 0, 1],
    "╒": [0, 3, 1, 0], "╕": [0, 0, 1, 3], "╘": [1, 3, 0, 0], "╛": [1, 0, 0, 3],
    "╓": [0, 1, 3, 0], "╖": [0, 0, 3, 1], "╙": [3, 1, 0, 0], "╜": [3, 0, 0, 1],
  };
  // Blocks, as parts of the cell: [left, top, right, bottom].
  const half = [[0, 0, 1, 0.5]], low = [[0, 0.5, 1, 1]];
  const q = { tl: [0, 0, 0.5, 0.5], tr: [0.5, 0, 1, 0.5], bl: [0, 0.5, 0.5, 1], br: [0.5, 0.5, 1, 1] };
  const BLOCK = {
    "█": [[0, 0, 1, 1]], "▀": half, "▄": low, "▌": [[0, 0, 0.5, 1]], "▐": [[0.5, 0, 1, 1]],
    "▔": [[0, 0, 1, 0.125]], "▕": [[0.875, 0, 1, 1]],
    "▖": [q.bl], "▗": [q.br], "▘": [q.tl], "▝": [q.tr], "▚": [q.tl, q.br], "▞": [q.tr, q.bl],
    "▙": [q.tl, q.bl, q.br], "▛": [q.tl, q.tr, q.bl], "▜": [q.tl, q.tr, q.br], "▟": [q.tr, q.bl, q.br],
  };
  for (let i = 1; i <= 7; i++) {
    BLOCK[String.fromCodePoint(0x2580 + i)] = [[0, 1 - i / 8, 1, 1]]; // ▁▂▃▄▅▆▇ from the bottom
    BLOCK[String.fromCodePoint(0x2590 - i)] = [[0, 0, i / 8, 1]]; // ▏▎▍▌▋▊▉ from the left
  }
  const SHADE = { "░": 0.25, "▒": 0.5, "▓": 0.75 };

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };
  // Cells a character takes: two for emoji and East Asian wide ones, none for a joiner or a mark.
  const cellsOf = ch => {
    const c = ch.codePointAt(0);
    if (/\p{Mn}|\p{Me}|‍|️/u.test(ch)) return 0;
    if ((c >= 0x1f000 && /\p{Extended_Pictographic}/u.test(ch)) || (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) return 2;
    return 1;
  };

  function paint(canvas, screen) {
    const dpr = window.devicePixelRatio || 1;
    const probe = canvas.getContext("2d");
    probe.font = `${SIZE * dpr}px ${FONT}`;
    // Whole device pixels a cell, so blocks and lines meet without seams.
    const cw = Math.max(1, Math.round(probe.measureText("M").width));
    const ch = Math.round(LINE * dpr);
    const rows = screen.rows;
    canvas.width = screen.cols * cw;
    canvas.height = rows.length * ch;
    canvas.style.width = `${(screen.cols * cw) / dpr}px`;
    const g = canvas.getContext("2d");
    g.fillStyle = background;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lw = Math.max(1, Math.round(dpr));

    // A box character's arms, out from the middle of the cell to its sides: a light or heavy one a
    // line, a double one two strips either side of the axis that turn their corners neatly.
    const box = (arms, x0, y0, w) => {
      const [up, right, down, left] = arms;
      const cx = x0 + Math.floor((w - lw) / 2), cy = y0 + Math.floor((ch - lw) / 2), x1 = x0 + w, y1 = y0 + ch, off = lw;
      const H = (xa, xb, y, t) => g.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), t);
      const V = (x, ya, yb, t) => g.fillRect(x, Math.min(ya, yb), t, Math.abs(yb - ya));
      // Where a double strip stops near the middle: short of a double arm on its own side, past one on the other.
      const stop = (mine, other) => (mine === 3 ? off : other === 3 ? -off : 0);
      for (const [weight, dir] of [[right, "right"], [left, "left"], [down, "down"], [up, "up"]]) {
        if (!weight) continue;
        const across = dir === "right" || dir === "left";
        const [before, after] = across ? [up, down] : [left, right];
        if (weight === 3) {
          for (const [side, mine, other] of [[-1, before, after], [1, after, before]]) {
            const p = stop(mine, other);
            if (dir === "right") H(cx + p, x1, cy + side * off, lw);
            else if (dir === "left") H(x0, cx - p + lw, cy + side * off, lw);
            else if (dir === "down") V(cx + side * off, cy + p, y1, lw);
            else V(cx + side * off, y0, cy - p + lw, lw);
          }
          continue;
        }
        // A light or heavy line, from the middle, or from the double strip it meets.
        const t = weight === 2 ? lw * 2 : lw, a = Math.floor(t / 2), meets = before === 3 || after === 3;
        if (dir === "right") H(meets ? cx + off : cx - a, x1, cy - a, t);
        else if (dir === "left") H(x0, meets ? cx - off + lw : cx - a + t, cy - a, t);
        else if (dir === "down") V(cx - a, meets ? cy + off : cy - a, y1, t);
        else V(cx - a, y0, meets ? cy - off + lw : cy - a + t, t);
      }
    };

    rows.forEach((runs, y) => {
      let x = 0;
      const y0 = y * ch;
      for (const [text, fgi, bgi, style, cells] of runs) {
        const fg = palette[fgi], bg = palette[bgi];
        const chars = [...text];
        const widths = chars.map(cellsOf);
        const sum = widths.reduce((a, b) => a + b, 0);
        if (sum !== cells && widths.length) widths[widths.length - 1] = Math.max(0, widths.at(-1) + cells - sum);
        g.font = `${style & 2 ? "italic " : ""}${style & 1 ? "bold " : ""}${SIZE * dpr}px ${FONT}`;
        chars.forEach((c, i) => {
          const n = widths[i];
          if (!n) return;
          const x0 = x * cw, w = n * cw;
          g.fillStyle = bg;
          g.fillRect(x0, y0, w, ch);
          g.fillStyle = fg;
          if (BOX[c]) box(BOX[c], x0, y0, w);
          else if (BLOCK[c]) for (const [l, t, r, b] of BLOCK[c]) g.fillRect(x0 + Math.round(l * w), y0 + Math.round(t * ch), Math.round(r * w) - Math.round(l * w), Math.round(b * ch) - Math.round(t * ch));
          else if (SHADE[c]) { g.fillStyle = mix(bg, fg, SHADE[c]); g.fillRect(x0, y0, w, ch); }
          else if (c !== " ") g.fillText(c, x0 + w / 2, y0 + ch / 2 + dpr);
          if (style & 4) g.fillRect(x0, y0 + ch - lw * 2, w, lw);
          x += n;
        });
      }
    });
  }

  const draw = () => {
    for (const canvas of document.querySelectorAll("canvas[data-screen]")) {
      const screen = screens.find(s => s.id === canvas.dataset.screen);
      if (screen) paint(canvas, screen);
    }
  };
  // The fonts first, so the cells are measured in the one they're drawn in.
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
  // A move to a screen with another pixel density (or a zoom) paints them again, sharp.
  let ratio = window.devicePixelRatio;
  window.addEventListener("resize", () => { if (window.devicePixelRatio !== ratio) { ratio = window.devicePixelRatio; draw(); } });
})();

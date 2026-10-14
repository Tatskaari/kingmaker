# src/web: the game in a browser

A spike: the real game (`npm run game`) runs on a small server in a pty, one per browser tab, and the page shows it with xterm.js. Keystrokes and output go over a WebSocket. Nothing in the game changes; it's the same terminal app drawing to a terminal that happens to be in a browser.

```sh
npm install          # builds node-pty (needs g++, make and python3; package.json lets its install script run)
npm run web          # http://127.0.0.1:7311/
npm run web -- --offline              # no GM: make a character and walk the town
npm run web -- --port 8000 --max-games 2
```

| flag | env | |
|---|---|---|
| `--host` | `KM_WEB_HOST` | where to listen; `127.0.0.1` unless you say otherwise, and anything else prints a warning |
| `--port` | `KM_WEB_PORT` | `7311`; `0` picks a free port |
| `--max-games` | `KM_WEB_MAX_GAMES` | games running at once (4); a tab past the cap is told to try later |
| `--offline` | `KM_WEB_OFFLINE=1` | every game runs without the GM |
| `--origin` | `KM_WEB_ORIGINS` | another origin allowed to open games, such as an HTTPS proxy in front |

`KM_RUNS_DIR` moves the saves as it does for the terminal game, and `KM_WEB_DEBUG=1` logs what happens to each connection (never what's in it).

## The GM's key

- If the server has a key (`OPENROUTER_API_KEY`, or `~/secrets/kingmaker-dev-openrouter.txt`), games use it and the page doesn't ask. The server only checks the file is there; the game reads it, as it always does.
- Otherwise the page asks for an OpenRouter key before starting, or offers to look around offline. The key goes to the server once, in the WebSocket message that starts the game (never in a URL). The server checks it looks like a key and puts it in that game's environment (`OPENROUTER_API_KEY`), and nowhere else. It isn't logged, written to a file or sent back, and the page clears the field once it's sent. When the game ends, its process and the key go with it; the next game asks again.
- The check (`--key-form`) confirms the key isn't in the server's output, the frames the page received, the URL or any file the run wrote.
- An environment is readable by the same OS user (`/proc/<pid>/environ`). That's fine on your own machine, but worth knowing on a shared one.

## Safety

- The server listens on `127.0.0.1` by default.
- Every request must name the server as it was reached (the Host header), so a DNS-rebinding page can't.
- The WebSocket must come from the server's own page (the Origin header). Another site open in the same browser can't start a game or send a key to localhost.
- The page has a strict CSP (no inline script, no eval) and refuses to be framed.
- `--host 0.0.0.0` works, but there's no TLS and no login: anyone who can reach it can play, on the server's key if it has one. A typed key would also travel in the clear. Put an authenticating HTTPS proxy in front, with `--origin https://your.host`.

## How it plays

- **Closing the tab** ends the game the way Ctrl+C does (it saves and quits). If that doesn't work, the server sends SIGTERM (which also saves), then SIGKILL, and checks that nothing of the game's process group is left. The page asks before closing while a game runs, since Ctrl+W is a word-delete in terminals.
- **Ctrl+C** in the page saves and quits as in a terminal. Play again starts a new game process, whose title screen offers Continue.
- **Resize** follows the window: xterm's fit addon sizes the terminal, and the server resizes the pty.
- **Keys:** arrows, WASD, Esc, Enter, Tab, PgUp/PgDn and Ctrl+C reach the game. The browser keeps a few (Ctrl+W, Ctrl+T, Ctrl+N).
- **The page:** xterm.js 6 with the WebGL renderer, so xterm draws box and block characters itself and the map's ▚▞▀▄█ join up. Without WebGL it falls back to the DOM renderer, which takes them from the font. It uses Unicode 11 widths, so 🎲 takes two cells as the game expects. The theme is the game's palette, and the font stack starts with Adwaita Mono. Browser zoom changes the size, and so does `?font=17` (15 by default).
- **Glyph fonts:** any `.ttf` or `.otf` in `assets/fonts/` gets an `@font-face` (`/fonts.css`) and goes at the front of the terminal's font stack, loaded before the terminal measures its cells. The family, weight and style come from the font's own tables, and its `unicode-range` from its cmap. A font of private-use glyphs (Kingmaker Glyphs, U+10E000 on) is used only for those and never changes the cell size.
- **Output:** the game's bytes go to the page as they're read from the pty. permessage-deflate brings them down about 9 times, since a frame is mostly the same truecolor escape sequences. If the page falls a megabyte behind, the server stops reading the pty until it catches up.

## Checking it

```sh
npm run web:check                 # offline, about a minute: screens, keys, latency, bandwidth, tab close, the cap, HiDPI, Origin and Host
npm run web:check -- --live       # the server's own key: a real GM reply
npm run web:check -- --key-form   # no key on the server: the page asks, the key from ~/secrets goes in through it, a real GM reply
```

It drives the real server and game through headless Chromium (Playwright) with the keys a player would press. Each screen is saved under `runs/web/<run>/` as a PNG, with the terminal's text beside it. The screens are 130x42 (`?size=130x42` pins the page to that), like `src/app/smoke`'s, so the two can be diffed: the sheet, the map, the help and the granary scene match the terminal's cell for cell. The HiDPI screens use a real device scale factor (2 and 1.25). Playwright's emulated one disagrees with the canvas's device-pixel size, and that magnifies xterm's WebGL canvas. That's the emulation, not the page.

The last offline run measured these (headless Chromium with software WebGL, on this machine):

- **A step on the map,** keydown to drawn: median 41 ms (p90 48 ms). The game itself takes 27 ms from key to first byte under a plain pty, so the server and WebSocket add next to nothing. The rest is xterm parsing and drawing the step's 50 KB.
- **Opening or closing the sheet:** median 54 ms.
- **The map idle:** 0.1 KB/s.
- **Walking 4 steps a second:** 198 KB/s from the game, 22 KB/s on the wire.

## What it doesn't do yet

- No accounts and no TLS, so it's for localhost or behind a proxy that has both.
- Every tab shares the server's saves: Continue offers the latest game, whoever played it.
- A dropped connection ends the game (it saves). There's no reattaching to a running one.
- A key from the page isn't checked until the GM first speaks; a wrong one shows up as the GM failing to answer.
- Fonts are the viewer's own. Adwaita Mono is only on GNOME systems, so elsewhere a few map symbols (▬ ▫ ▾ ‿) come from fallback fonts. Serving Adwaita Mono (it's SIL OFL) would fix that.
- No touch keyboard, so it needs a real keyboard. Only Chromium has been tried.

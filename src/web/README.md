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
- Otherwise the page asks for an OpenRouter key before starting, or offers to look around offline. The key goes to the server once, in the WebSocket message that starts the game (never in a URL).
- The server checks the key before starting a game:
  - Another provider's key (OpenAI's `sk-…` or `sk-proj-…`, Anthropic's `sk-ant-…`) or anything not shaped like an OpenRouter key (`sk-or-…`) goes back to the form with a word on what's needed, without being sent anywhere.
  - An `sk-or-` key is checked with OpenRouter (`GET /api/v1/key`, which is free). A key OpenRouter turns down goes back to the form too. If OpenRouter can't be reached, the game starts anyway and the GM says what's wrong.
- The key goes into that game's environment (`OPENROUTER_API_KEY`) and nowhere else. It isn't logged, written to a file or sent back, and the page clears the field once it's sent. The next game asks again.
- **When the game ends, the key can outlive it by up to 3 minutes.** After each turn the game starts background jobs, the GM's notes on that turn (the memory review and the co-GM's repair), in sessions of their own, as it does in a terminal. They inherit the key with the rest of the environment.
  - The server finds them by a tag every process of the game inherits. It lets them finish, for up to 3 minutes after the game ends, and stops whatever is left then.
  - Meanwhile they keep the game's place under `--max-games`.
  - When the server stops, it waits for them too (see below).
  - So nothing of a game outlives the server, unless the server is killed outright (SIGKILL). Then the game itself still saves and stops, but its background jobs run to their end, as they would after the terminal game.
  - Finding them reads `/proc`, so this is Linux only. Elsewhere (macOS), they run to their end unwatched.
- The check (`--key-form`) confirms the wrong kinds of key are turned back. Then, with the real key, it confirms the key isn't in the server's output, the frames the page received, the URL or any file the run wrote, and that no process of the run holds it once the server has stopped.
- An environment is readable by the same OS user (`/proc/<pid>/environ`). That's fine on your own machine, but worth knowing on a shared one.

## Safety

- The server listens on `127.0.0.1` by default.
- Every request must name the server as it was reached (the Host header), so a DNS-rebinding page can't.
- The WebSocket must come from the server's own page (the Origin header). Another site open in the same browser can't start a game or send a key to localhost.
- The page has a strict CSP (no inline script, no eval) and refuses to be framed.
- A request or message the server can't make sense of ends only itself. A path like `//` gets a 400, and a message that isn't a JSON object closes that one connection. The server stays up for everyone else.
- `--host 0.0.0.0` works, but there's no TLS and no login: anyone who can reach it can play, on the server's key if it has one. A typed key would also travel in the clear. Put an authenticating HTTPS proxy in front, with `--origin https://your.host`.

## How it plays

- **Closing the tab** ends the game the way Ctrl+C does (it saves and quits). If that doesn't work, the server sends SIGTERM (which also saves), then SIGKILL, and checks that nothing of the game's process group is left. The page asks before closing while a game runs, since Ctrl+W is a word-delete in terminals.
- **The last turn's background jobs** (above) can run on after the game for up to 3 minutes, and keep its place under `--max-games` meanwhile. A tab turned away in that time is told so: "…just finishing the GM's notes on a last turn. Try again in a minute or two."
- **Ctrl+C** in the page saves and quits as in a terminal. Play again starts a new game process, whose title screen offers Continue.
- **Stopping the server:** Ctrl+C (or SIGTERM, or closing its terminal) stops every game, each saving as it goes. The server then waits for their background jobs and says so. Ctrl+C again stops those at once. Under `npm run`, one Ctrl+C reaches the server twice (npm passes it on too), so a second press counts only if it comes a moment later.
- **Resize** follows the window: xterm's fit addon sizes the terminal, and the server resizes the pty.
- **Keys:** arrows, WASD, Esc, Enter, Tab, PgUp/PgDn and Ctrl+C reach the game. The browser keeps a few (Ctrl+W, Ctrl+T, Ctrl+N).
- **The page:** xterm.js 6 with the WebGL renderer, so xterm draws box and block characters itself and the map's ▚▞▀▄█ join up. Without WebGL it falls back to the DOM renderer, which takes them from the font. It uses Unicode 11 widths, so 🎲 takes two cells as the game expects. The theme is the game's palette, and the font stack starts with Adwaita Mono. Browser zoom changes the size, and so does `?font=17` (15 by default).
- **Glyph fonts:** any `.ttf` or `.otf` in `assets/fonts/` gets an `@font-face` (`/fonts.css`) and goes at the front of the terminal's font stack, loaded before the terminal measures its cells. The family, weight and style come from the font's own tables, and its `unicode-range` from its cmap. A font of private-use glyphs (Kingmaker Glyphs, U+10E000 on) is used only for those and never changes the cell size.
- **Output:** the game's bytes go to the page as they're read from the pty. permessage-deflate brings them down about 9 times, since a frame is mostly the same truecolor escape sequences. If the page falls a megabyte behind, the server stops reading the pty until it catches up.

## Checking it

```sh
npm run web:check                 # offline, about a minute: screens, keys, latency, bandwidth, tab close, the cap, HiDPI, Origin and Host, odd requests
npm run web:check -- --live       # the server's own key: a real GM reply
npm run web:check -- --key-form   # no key on the server: the page asks, turns back the wrong kinds, and the key from ~/secrets goes in through it; a real GM reply
npm run web:check -- --gpu        # any of the above with Chromium drawing on the GPU (Vulkan) rather than in software
```

It drives the real server and game through headless Chromium (Playwright) with the keys a player would press. Each screen is saved under `runs/web/<run>/` as a PNG, with the terminal's text beside it. The screens are 130x42 (`?size=130x42` pins the page to that), like `src/app/smoke`'s, so the two can be diffed: the sheet, the map, the help and the granary scene match the terminal's cell for cell. The HiDPI screens use a real device scale factor (2 and 1.25). Playwright's emulated one disagrees with the canvas's device-pixel size, and that magnifies xterm's WebGL canvas. That's the emulation, not the page.

The latency is from the browser's keydown to three points:

- **First output:** the game's first output, parsed by xterm.
- **Drawn:** xterm's draw.
- **On screen:** the next animation frame after the draw. The frame that shows the draw has gone to the screen by then.

The last runs measured these on this machine, at 130x42:

| | the game alone (plain pty) | first output | drawn | on screen, GPU | on screen, software |
|---|---|---|---|---|---|
| a step on the map (50 KB) | 27 ms | 28 ms | 40 ms | 56 ms (p90 62) | 114 ms (p90 118) |
| opening or closing the sheet | 60 / 43 ms | | 55-60 ms | 75 ms (p90 86) | 121 ms (p90 130) |

"The game alone" is from key to first byte. "GPU" is an RTX 3080 Ti through ANGLE and Vulkan; "software" is SwiftShader, the check's default.

So the server and WebSocket add about a millisecond, and xterm parses and draws a step's 50 KB in about 12 ms. On a GPU, a step reaches the screen about 29 ms after the game has answered: the draw plus one frame.

- **The map idle:** 0.1 KB/s.
- **Walking 4 steps a second:** 198 KB/s from the game, 22 KB/s on the wire.

## The PR preview

GitHub Pages can only serve files, and this needs a server with a pty (and the game needs a GM), so a pull request's preview (`.github/workflows/preview.yml`, which runs `npm run build:web`) is a page of the game's screens instead: `src/web/preview.tsx` writes `dist/web/index.html`.

```sh
npm run build:web                 # dist/web/index.html, in a couple of seconds
```

- **The screens:** the title, a character just made, the map, a spell on the sheet, a scene and a fight. They're the real App's, at 130x42, drawn by OpenTUI headless the way `src/app/smoke/screens-check.tsx` draws them: offline, with no model calls, for ready-made characters. The scene's conversation is the scene check's, made up for it.
- **The page:** each screen is kept as its cells and their colours, and `preview-paint.js` (inlined) paints them on a canvas a cell at a time. A character from a fallback font stays in its own cell, and the box and block characters are drawn as lines and rectangles, so they join up whatever the font. Each has its text beside it, under "As text".
- **CI:** `moon.yml`'s `build` is the same build, and its `check` is the typecheck, the tests and the screens check (`npm run check`; `.github/workflows/check.yml` runs both).

## What it doesn't do yet

- No accounts and no TLS, so it's for localhost or behind a proxy that has both.
- Every tab shares the server's saves: Continue offers the latest game, whoever played it.
- A dropped connection ends the game (it saves). There's no reattaching to a running one.
- A key OpenRouter accepts can still run out of credit. That shows up only when the GM fails to answer.
- Fonts are the viewer's own. Adwaita Mono is only on GNOME systems, so elsewhere a few map symbols (▬ ▫ ▾ ‿) come from fallback fonts. Serving Adwaita Mono (it's SIL OFL) would fix that.
- No touch keyboard, so it needs a real keyboard. Only Chromium has been tried.
- An Enter that reaches the game in the same read as the letters before it sends the line without them. This happens with a paste, or with keystrokes bunched up by a slow link. The scene's input submits what it last drew. It's the game's, and it happens under a plain pty too; the fix belongs in `src/app/ui/scene.tsx`.

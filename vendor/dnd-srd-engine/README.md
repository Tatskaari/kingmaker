# dnd-srd-engine, module-ready (vendored)

An event-sourced D&D 5.5e rules engine for the SRD 5.2.1, by Greg Carr
(<https://github.com/greghcarr/dnd-srd-engine>): code MIT, SRD content CC-BY-4.0 (`LICENSE`,
`NOTICE`). The simulation makes the player's character and rolls every check with it; the AI service
runs it only to make the build cards it offers. Both load it through `shared/rules/shim.ts`, and
hand it to `shared/rules`, which never imports it at run time.

It's the prototype's build at `44c6d4a` (`vendor/dnd-srd-engine/`: the engine at `ead852b`, its
dependencies bundled, and the prototype's two fixes already in it), made ready for a SpacetimeDB
module by two edits and nothing else. How that build was made, and what the fixes are, is in the
prototype's `vendor/dnd-srd-engine/README.md`, which went with it: it's in git history at `bc2ab1f`
(`git show bc2ab1f:vendor/dnd-srd-engine/README.md`), with the build, its `patch.ts` and the tool
below.

## Files

| File | What | sha256 |
|---|---|---|
| `dnd-srd-engine.module.js` | the bundle, with the two edits below | `63a1c640ceddd11af4813e7c9ab17e2f831d80c1350cd1a2c5d16b6852ba937b` |
| `dnd-srd-engine.module.d.ts` | the prototype's hand-written typings (`dnd-srd-engine.d.ts`), renamed to pair with the bundle | `ffaf1dbc177d15515228050ff60627f51869a18f8c9bbcf52438536a8acd0c49` |
| `starter-pack.json` | the starter content pack, already validated, as it is | `c4b9fdb668974e27606b1e2adfbadafe60d8920f1782295634748c02601beb16` |
| `LICENSE`, `NOTICE` | as they are | `cb09fe75…1734`, `307ff831…42bf` |

The source bundle, `vendor/dnd-srd-engine/dnd-srd-engine.js` at `44c6d4a`, has sha256
`94b626995f2ec79f664fe8292668f413501f0eee4980a69b69a8595c839918f0`.

## The two edits

A module has no Node: no `node:` built-ins and no `process` (spacetime.md §3, §8). So:

1. **Line 1 deleted:** `import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);`.
   The prototype's build added it for ulid's `require("crypto")`; the bundle's own `typeof require`
   guards cope without it, and ulid finds `window.crypto` instead, which the shim provides.
2. **`process.env.NODE_ENV` replaced with `"production"`,** in all five places (immer's). The CLI's
   bundler would turn each into a bare `production`, which throws `ReferenceError` as the module loads.

So immer runs in production mode, as in any production build, where the prototype runs it in
development mode. The golden sheets and checks recorded from the prototype (`shared/rules/golden/`)
would show it if that changed anything.

## What the host provides

`shared/rules/shim.ts`, imported before the bundle:
- `window.crypto.getRandomValues`, which ulid looks for as the bundle loads (the bundle won't load
  without it: "secure crypto unusable"). It draws on the current call's source: the game's dice in the
  simulation, so the engine's ids are a pure function of the rows; `crypto` in the AI service.
- a clock that can be pinned: in the simulation, the transaction's time, so the events' `at` is too.
- `process.env.NODE_ENV`, for any copy that still reads it.

## Making it again

```sh
node --no-warnings tools/v2/module-engine.mts --proto <the prototype at 44c6d4a> --out v2/vendor
```

It checks the source's sha256, that line 1 is the banner and that `NODE_ENV` is in exactly five
places, writes this folder's files (and `../srd-spells/spells.json`) and prints their sha256s. A new
engine build was made in the prototype first; then the tool's expected sha256 and this table
changed. The tool and the prototype's build are in git history at `bc2ab1f`, where the game was
still in `v2/` (`--out v2/vendor`): an engine upgrade brings that pipeline back first.

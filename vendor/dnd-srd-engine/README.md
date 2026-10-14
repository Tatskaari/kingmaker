# dnd-srd-engine (vendored)

An event-sourced D&D 5.5e rules engine for the SRD 5.2.1, by Greg Carr: https://github.com/greghcarr/dnd-srd-engine

- **Code:** MIT. **SRD content:** CC-BY-4.0, from Wizards of the Coast's System Reference Document 5.2.1. See `LICENSE` and `NOTICE`.
- **Pinned commit:** `ead852b` (0.11.0-alpha.0). It isn't published to npm, and its build isn't committed, so we vendor a build.

## Files

- **`dnd-srd-engine.js`:** the engine's ESM build bundled with its dependencies (zod, immer, ulid, all MIT), so the game needs no runtime npm packages.
- **`starter-pack.json`:** the starter content pack, already validated. Loading it this way takes about 5 ms, against about 1 s through `loadStarterPack()`, which validates the pack on every load. A game turn may load it in a fresh process, so the difference matters.
- **`dnd-srd-engine.d.ts`:** hand-written types for the small surface `src/rules/` uses.

## Rebuilding

```sh
git clone https://github.com/greghcarr/dnd-srd-engine && cd dnd-srd-engine
git checkout ead852b && npm ci && npm run build
npx esbuild dist/dnd-srd-engine.js --bundle --format=esm --platform=node --minify --legal-comments=none \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile=<kingmaker>/vendor/dnd-srd-engine/dnd-srd-engine.js
node -e 'import("<kingmaker>/vendor/dnd-srd-engine/dnd-srd-engine.js").then(E => require("fs").writeFileSync("<kingmaker>/vendor/dnd-srd-engine/starter-pack.json", JSON.stringify(E.loadStarterPack())))'
```

The banner is needed because ulid's UMD wrapper calls `require("crypto")`.

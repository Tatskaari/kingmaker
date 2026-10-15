# dnd-srd-engine (vendored)

An event-sourced D&D 5.5e rules engine for the SRD 5.2.1, by Greg Carr: https://github.com/greghcarr/dnd-srd-engine

- **Code:** MIT. **SRD content:** CC-BY-4.0, from Wizards of the Coast's System Reference Document 5.2.1. See `LICENSE` and `NOTICE`.
- **Pinned commit:** `ead852b` (0.11.0-alpha.0). It isn't published to npm, and its build isn't committed, so we vendor a build.

## Files

- **`dnd-srd-engine.js`:** the engine's ESM build bundled with its dependencies (zod, immer, ulid, all MIT), so the game needs no runtime npm packages.
- **`starter-pack.json`:** the starter content pack, already validated. Loading it this way takes about 5 ms, against about 1 s through `loadStarterPack()`, which validates the pack on every load. A game turn may load it in a fresh process, so the difference matters.
- **`dnd-srd-engine.d.ts`:** hand-written types for the small surface `src/rules/` uses.
- **`patch.ts`:** our fixes to the build and the pack, already applied to both (below).

## Our fixes

`patch.ts` applies them, and changes only what still needs it:

- **What a character chose counts in the dice.** The engine adds the effects of a character's choices (an Ability Score Improvement, a fighting style, a species' chosen resistance) only when it's handed the campaign's `pendingChoices`. The sheet hands it them, but most planners didn't, so from level 4 a wizard's sheet said save DC 15 and spell attack +7 while their spells rolled DC 14 and +6, and the same went for weapon attacks, AC, saves and resistances. Every derivation the build hands a campaign's item instances is now handed its choices too.
- **Archery is for bows.** The fighter's and the Champion's Archery gave +2 to every attack roll. The SRD's Archery, like the ranger's in the same pack, is +2 to attack rolls with ranged weapons.

`src/rules/attack.test.ts` and `src/rules/spells.test.ts` fail if a rebuild loses them.

## Rebuilding

```sh
git clone https://github.com/greghcarr/dnd-srd-engine && cd dnd-srd-engine
git checkout ead852b && npm ci && npm run build
npx esbuild dist/dnd-srd-engine.js --bundle --format=esm --platform=node --minify --legal-comments=none \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile=<kingmaker>/vendor/dnd-srd-engine/dnd-srd-engine.js
node -e 'import("<kingmaker>/vendor/dnd-srd-engine/dnd-srd-engine.js").then(E => require("fs").writeFileSync("<kingmaker>/vendor/dnd-srd-engine/starter-pack.json", JSON.stringify(E.loadStarterPack())))'
node --no-warnings <kingmaker>/vendor/dnd-srd-engine/patch.ts
```

The banner is needed because ulid's UMD wrapper calls `require("crypto")`.

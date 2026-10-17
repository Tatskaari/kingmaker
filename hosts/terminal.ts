import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { detectGlyphSet, setGlyphSet } from "../client/look/glyphs.ts";
import { LookCache, setLookCache, type CachedInvention, type LookStore } from "../client/look/invent.ts";
import { setPace, type Pace } from "../client/pace.ts";

/**
 * What a terminal host sets for the client before it draws (browser-design §4.1): what the client
 * once read from the environment and the disk itself, which a page has neither of. The glyph set
 * (KM_GLYPHS, or the environment's best guess: Kingmaker Glyphs when its font is installed here),
 * the invented looks kept in a file (KM_LOOK_CACHE, or runs/look-cache.json) and the pace
 * (KM_APP_STEP_MS, KM_APP_TALK_MS). So the terminal client, and the headless ones that draw the map
 * and the places as text, draw as they did.
 */
export function configureTerminal(env: NodeJS.ProcessEnv): void {
  setGlyphSet(detectGlyphSet(env, kingmakerFontHere()).set);
  setLookCache(new LookCache(lookFile(env.KM_LOOK_CACHE ?? "runs/look-cache.json")));
  setPace(paceOf(env));
}

/** Is the Kingmaker Glyphs font installed for this user (where npm run glyphs puts it)? */
export const kingmakerFontHere = () => existsSync(join(homedir(), ".local", "share", "fonts", "kingmaker", "KingmakerGlyphs-Regular.ttf"));

/**
 * The looks in a file, as the look cache kept them before it was the host's: read on first use (no
 * file, or a broken one, is no looks), written whole to a file beside it and moved into place, since
 * a half-written cache would cost every look again.
 */
export function lookFile(path: string): LookStore {
  return {
    load() {
      try {
        const file = JSON.parse(readFileSync(path, "utf8")) as { version?: number; looks?: Record<string, CachedInvention> };
        return file.looks ?? {};
      } catch {
        return {};
      }
    },
    save(looks) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ version: 1, looks }, null, 1)}\n`);
      renameSync(tmp, path);
    },
  };
}

/** The pace the environment asks for: KM_APP_STEP_MS and KM_APP_TALK_MS where they're set, the client's own otherwise. */
function paceOf(env: NodeJS.ProcessEnv): Partial<Pace> {
  return {
    ...(env.KM_APP_STEP_MS !== undefined ? { stepMs: Number(env.KM_APP_STEP_MS) } : {}),
    ...(env.KM_APP_TALK_MS !== undefined ? { talkMs: Number(env.KM_APP_TALK_MS) } : {}),
  };
}

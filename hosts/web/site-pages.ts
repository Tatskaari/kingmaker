// After the prototype's src/web/static/build.ts:194-220 at bc2ab1f (the site around the game: the pitch and the roadmap, their links pointed at the site's own pages), as a module of its own for the site's build (build-site.ts) and its test.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The site's own pages around the game (npm run build:site): the pitch, its front page, and the
 * roadmap. Both are the user's claude.ai artifacts, saved in web/site as they're published there,
 * where they're edited, so they're never edited here. The build points their links at the site's own
 * pages: the pitch's "Play the tech demo" at play/ and its "See the roadmap" at roadmap/, and the
 * roadmap's links to the pitch at ../. Each swap has to happen, or the page changed under the build,
 * and no link to a claude.ai artifact may be left: either fails the build.
 */

/** The artifacts' links, as patterns: the pitch and the roadmap as published on claude.ai. */
export const ARTIFACT = { pitch: String.raw`https://claude\.ai/artifact/1Ck3UDwhFdG7PwPB7DZWWe`, roadmap: String.raw`https://claude\.ai/artifact/SdWwGZBtvKZ3JuAt73Hxq6` };

/** A swap: what to find, what it becomes, and what it is, for the build's error. */
export type Swap = [pattern: RegExp, to: string, what: string];

/** The site's pages, by their path in the site (and in web/site), and the swaps each needs. */
export const PAGES: ReadonlyArray<{ path: string; swaps: Swap[] }> = [
  {
    path: "index.html",
    swaps: [
      [/<a class="cta" href="[^"]*"(?: target="_blank" rel="noopener")?>Play the tech demo/, '<a class="cta" href="play/">Play the tech demo', "its demo button at play/"],
      [new RegExp(`<a class="cta" href="${ARTIFACT.roadmap}"(?: target="_blank" rel="noopener")?>See the roadmap`), '<a class="cta" href="roadmap/">See the roadmap', "its roadmap button at roadmap/"],
    ],
  },
  {
    path: "roadmap/index.html",
    swaps: [
      [new RegExp(`<p>The pitch: <a href="${ARTIFACT.pitch}">[^<]*</a></p>`), '<p>The pitch is the site\'s <a href="../">front page</a>.</p>', "its footer at the pitch"],
      [new RegExp(`href="${ARTIFACT.pitch}"`, "g"), 'href="../"', "its links to the pitch at ../"],
    ],
  },
];

/** A page with its links pointed at the site's (and its language said, en-GB). Throws if a swap misses, or a claude.ai artifact link is left. */
export function pointed(path: string, html: string, swaps: readonly Swap[]): string {
  let page = html.replace(/^<!doctype html><html>/i, '<!doctype html><html lang="en-GB">');
  for (const [pattern, to, what] of swaps) {
    const swapped = page.replace(pattern, to);
    if (swapped === page) throw new Error(`web/site/${path} changed: the site's build couldn't point ${what}`);
    page = swapped;
  }
  const stray = /https:\/\/claude\.ai\/artifact\/[\w-]+/.exec(page);
  if (stray) throw new Error(`web/site/${path} still links to a claude.ai artifact (${stray[0]})`);
  return page;
}

/** The pitch and the roadmap from their folder (web/site), pointed, by their path in the site. */
export function sitePages(dir: string): Map<string, string> {
  return new Map(PAGES.map(({ path, swaps }) => [path, pointed(path, readFileSync(join(dir, path), "utf8"), swaps)]));
}

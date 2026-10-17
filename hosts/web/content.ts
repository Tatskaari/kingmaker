import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { Content } from "../../web/server/content.ts";

export type { Content };

/**
 * What the page's server worker reads as it starts (content.json, browser-design §5): the campaign's
 * files, the prompts and the fake model's options, taken from the repo's folders by an allowlist, and
 * nothing else. The build (build.ts) writes it, the build and the check (check.ts) hold it to the
 * allowlist, and the server worker alone fetches it, asking with its own ?v= (it's served as
 * server-worker.js?v=<the build's stamp>). The rest of the game is code, bundled. Its shape is the
 * server worker's (web/server/content.ts), which reads it.
 */

/** The allowlist, by the repo's folders: what may go into content.json. Nothing hidden does. */
export const CONTENT = [
  { dir: "campaigns/caerwyn", include: /\.(md|json|kmscene|kmscenario|kmmap|kmplace)$/, what: "the campaign's Markdown and JSON, and its scenario, scenes, maps and places" },
  { dir: "ai/prompts", include: /^(?!README\.md$).*\.md$/, what: "the prompts" },
  { dir: "hosts/dev", include: /^fake\.json$/, what: "the fake model's options" },
] as const;

const [CAMPAIGN, PROMPTS, FAKE] = CONTENT;

/** content.json's contents, from the repo's folders (`v2`: its root). */
export function readContent(v2: string): Content {
  const prompts = Object.entries(filesUnder(v2, PROMPTS.dir, PROMPTS.include)).map(([path, text]) => [path.replace(/\.md$/, ""), text]);
  return {
    campaign: filesUnder(v2, CAMPAIGN.dir, CAMPAIGN.include),
    prompts: Object.fromEntries(prompts),
    fake: JSON.parse(readFileSync(join(v2, FAKE.dir, "fake.json"), "utf8")) as FakeOptions,
  };
}

/** Where each of content.json's files came from, as a path in the repo: what the allowlist is asked about. */
export function contentPaths(content: Content): string[] {
  return [
    ...Object.keys(content.campaign).map(path => `${CAMPAIGN.dir}/${path}`),
    ...Object.keys(content.prompts).map(name => `${PROMPTS.dir}/${name}.md`),
    ...(content.fake ? [`${FAKE.dir}/fake.json`] : []),
  ];
}

/** Is a path in the repo (forward slashes) one the allowlist lets in? */
export function allowed(path: string): boolean {
  const parts = path.split("/");
  if (parts.some(part => part.startsWith("."))) return false;
  return CONTENT.some(c => path.startsWith(`${c.dir}/`) && c.include.test(parts.at(-1)!));
}

/** A folder's files that the allowlist's pattern takes (under it, at any depth; nothing hidden), by their path in it. */
function filesUnder(v2: string, dir: string, include: RegExp): Record<string, string> {
  const root = join(v2, dir);
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && include.test(entry.name))
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(path => !path.split("/").some(part => part.startsWith(".")))
    .sort();
  return Object.fromEntries(paths.map(path => [path, readFileSync(join(root, path), "utf8")]));
}

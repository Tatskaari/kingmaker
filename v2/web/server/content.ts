import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { CampaignStore } from "../../ai/service/stores.ts";

/**
 * What the build ships for the server worker alone (browser-design §5): content.json, fetched from
 * beside the worker with the build's ?v=. It holds the campaign's files by their paths in its folder,
 * as the install sends them ("scenes/hanged-clerk/scene.json"); the prompts by name, their paths
 * under ai/prompts/ without .md ("gm", "review/system"); and the fake GM's options
 * (hosts/dev/fake.json). The campaign is served to the AI service from here (contentCampaigns), never
 * written to the database: the next build ships its own.
 */
export interface Content {
  campaign: Record<string, string>;
  prompts: Record<string, string>;
  fake: FakeOptions;
}

/** content.json couldn't be had: the site was published again since the page opened, say. The page offers a reload. */
export class Unloaded extends Error {}

export async function loadContent(url: URL | string, fetchContent: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Content> {
  const response = await fetchContent(url).catch((error: Error) => { throw new Unloaded(`content.json: ${error.message}`); });
  if (!response.ok) throw new Unloaded(`content.json: HTTP ${response.status}`);
  const content = (await response.json().catch((error: Error) => { throw new Unloaded(`content.json: ${error.message}`); })) as Partial<Content>;
  const missing = (["campaign", "prompts", "fake"] as const).filter(part => typeof content[part] !== "object" || content[part] === null);
  if (missing.length) throw new Unloaded(`content.json has no ${missing.join(" or ")}: it isn't this build's`);
  return content as Content;
}

/**
 * The AI service's campaigns, from the build's content (stores.ts's CampaignStore): its one version,
 * read from content.json's files and never written. The install's PUT of that version has nothing
 * to keep; a PUT of another is refused, since only the build's is here.
 */
export function contentCampaigns(files: Record<string, string>): CampaignStore {
  const { id, version } = JSON.parse(files["campaign.json"] ?? "{}") as { id?: string; version?: string };
  const served = `${id}@${version}`;
  const reader = { read: (path: string) => files[path], paths: () => Object.keys(files) };
  return {
    async put(campaign, putVersion) {
      if (`${campaign}@${putVersion}` !== served) throw new Error(`this page serves its build's campaign, ${served}, not ${campaign}@${putVersion}`);
    },
    files: (campaign, wanted) => (`${campaign}@${wanted}` === served ? reader : undefined),
    list: () => [served],
  };
}

/** A campaign's files, hashed (SHA-256, as hex): the page host installs the build's campaign again only when it has changed. */
export async function campaignHash(files: Record<string, string>): Promise<string> {
  const text = JSON.stringify(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

import type { CampaignPutAnswer } from "../../shared/protocol/ai.ts";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import { campaignId, installArgsOf } from "../../shared/scene/files.ts";
import { checkCampaign, packOf, readCampaignFiles } from "./campaign.ts";
import { bearer, request } from "./http.ts";
import { call } from "./spacetime.ts";

/**
 * A campaign installed into a running stack (v0-design §8): checked, then its words to the AI
 * service (PUT /v1/campaigns/<id>/<version>, every file of the folder: it needs the graph as well as
 * the prose), then its structure to the module (install_campaign, as the owner). Re-installing a
 * version replaces it, so the dev host runs this at every start. A campaign no GM plays (its
 * scenario's gm "none": the zoo, M6) goes to the module alone: the AI service serves one campaign,
 * the story's, and is never asked about one with no GM.
 */

/** Where a stack is, and as whom the install calls it: the AI service with the bearer, the module as its owner. */
export interface InstallTarget { http: string; aiFromHost: string; owner: { token: string }; ai: { bearer: string } }

export interface Installed {
  /** "caerwyn@0.1.0" */
  id: string;
  /** What the AI service stored, or why it didn't; or that it wasn't sent, no GM playing the campaign. */
  words: { ok: true; answer: CampaignPutAnswer } | { ok: true; skipped: true } | { ok: false; error: string };
  /** Whether the module installed the structure, or why it didn't. */
  structure: { ok: true } | { ok: false; error: string };
}

/** Installs a campaign folder into both services; throws when the campaign doesn't pass its check (nothing is sent then). */
export async function installCampaign(dir: string, target: InstallTarget): Promise<Installed> {
  const files = readCampaignFiles(dir);
  const problems = checkCampaign(files);
  if (problems.length) throw new Error(`${dir} doesn't pass its check:\n  ${problems.join("\n  ")}`);
  const pack = packOf(files);

  const words: Installed["words"] = pack.campaign.gm === "none" ? { ok: true, skipped: true } : await putWords(target, pack.campaign.id, pack.campaign.version, files);
  const structure = await installStructure(target, installArgsOf(pack));

  return { id: campaignId(pack.campaign), words, structure };
}

/** "caerwyn 0.1.0 installed in both" ("zoo 0.1.0 installed in the module" for one no GM plays), or what went wrong where. */
export function describeInstall(installed: Installed): string {
  const [name, version] = installed.id.split("@");
  if (installed.words.ok && installed.structure.ok) return `${name} ${version} installed in ${"skipped" in installed.words ? "the module (no GM plays it)" : "both"}`;
  return [
    installed.words.ok ? "" : `the AI service didn't take its words: ${installed.words.error}`,
    installed.structure.ok ? "" : `the module didn't take its structure: ${installed.structure.error}`,
  ].filter(Boolean).join("; ");
}

async function putWords(target: InstallTarget, campaign: string, version: string, files: Record<string, string>): Promise<Installed["words"]> {
  const url = `${target.aiFromHost}/v1/campaigns/${encodeURIComponent(campaign)}/${encodeURIComponent(version)}`;
  const answer = await request(url, { method: "PUT", headers: { ...bearer(target.ai.bearer), "content-type": "application/json" }, body: JSON.stringify({ files }), timeoutMs: 60_000 });
  if ("error" in answer) return { ok: false, error: `PUT ${url}: ${answer.error}` };
  if (answer.status !== 200) return { ok: false, error: `PUT ${url}: ${answer.status} ${errorText(answer.body)}` };
  return { ok: true, answer: JSON.parse(answer.body) as CampaignPutAnswer };
}

async function installStructure(target: InstallTarget, args: ReturnType<typeof installArgsOf>): Promise<Installed["structure"]> {
  const answer = await call(target.http, "install_campaign", args, target.owner.token, 60_000);
  if ("error" in answer) return { ok: false, error: `install_campaign: ${answer.error}` };
  if (answer.status !== 200) return { ok: false, error: `install_campaign: ${refusalIn(answer.body)?.text ?? `${answer.status} ${answer.body.trim()}`}` };
  return { ok: true };
}

/** The AI service's error JSON as its message; any other body as it is. */
function errorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
    if (parsed.error?.code) return `${parsed.error.code}: ${parsed.error.message ?? ""}`.trim();
  } catch {
    /* not JSON */
  }
  return body.trim().slice(0, 300);
}

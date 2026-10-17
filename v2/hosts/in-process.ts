import type { AiService } from "../ai/service/server.ts";
import type { StreamReplyArgs } from "../shared/protocol/ai.ts";
import { installArgsOf } from "../shared/scene/files.ts";
import type { MemoryHost, StreamArgs } from "../simulation/src/host/memory.ts";
import { packOf, type CampaignFiles } from "./dev/pack.ts";

/**
 * The simulation on the memory host and the AI service in one process, with no sockets (v0-design
 * §4.5): the parts that join them, for the local host (hosts/local.ts) under Node and the page's
 * server worker in a browser. Nothing here touches Node: each draft the service streams is answered
 * in process, and a campaign is installed in both from files already in hand.
 */

/** stream_reply's HTTP call, answered in process: the post's JSON body to the simulation. */
export function streamInto(post: (args: StreamReplyArgs) => void): typeof fetch {
  return async (_url, init) => {
    post(JSON.parse(String(init?.body)) as StreamReplyArgs);
    return new Response("");
  };
}

/** The posted arguments as the reducer takes them: the turn a u64, the markup's option unwrapped. */
export function streamArgsOf(post: StreamReplyArgs): StreamArgs {
  return {
    turnId: BigInt(post.turnId), attempt: post.attempt, seq: post.seq, speaker: post.speaker, text: post.text, done: post.done,
    ...("some" in post.markup ? { markup: post.markup.some } : {}),
  };
}

/** A campaign's files into both, as the install tool does it: every file to the AI service (with the module's bearer), then the structure to the module as its owner. */
export async function install(files: CampaignFiles, ai: AiService, sim: MemoryHost, bearer: string): Promise<void> {
  const pack = packOf(files);
  const name = `${pack.campaign.id}@${pack.campaign.version}`;

  const put = await ai.answer({ method: "PUT", path: `/v1/campaigns/${pack.campaign.id}/${pack.campaign.version}`, headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ files }) });
  if (put.status !== 200) throw new Error(`the AI service didn't take ${name}: ${put.status} ${put.body}`);

  const refused = sim.as(sim.owner).installCampaign(installArgsOf(pack));
  if (refused) throw new Error(`install_campaign refused ${name}: ${refused.text}`);
}

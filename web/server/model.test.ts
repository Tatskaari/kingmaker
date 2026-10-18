import assert from "node:assert/strict";
import { test } from "node:test";
import { keyModel, redact } from "./model.ts";

/**
 * The player's key in the page host (browser-design §5): with none, OpenRouter isn't asked; a 401
 * from OpenRouter is the page's to hear; a call that fails is told without the key; a new key is
 * the next call's.
 */

const KEY = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;
const RESPONSES = "https://openrouter.ai/api/v1/responses";

test("with no key OpenRouter isn't asked (a 401 made here); a 401 from it is the page's to hear; a failed call is told without the key; a new key is the next call's", async () => {
  const asked: string[] = [];
  let refused = 0;
  const network: typeof fetch = async (input, init) => {
    asked.push(`${String(input)} ${new Headers(init?.headers).get("authorization")}`);
    if (String(input).endsWith("/down")) throw new TypeError(`fetch failed (Bearer ${KEY})`);
    return new Response("{}", { status: String(input).endsWith("/turned-down") ? 401 : 200 });
  };
  const model = keyModel(undefined, () => refused++, network);

  const none = await model.transport(0).fetch!(RESPONSES, { headers: { authorization: "Bearer " } });
  assert.deepEqual([none.status, asked, refused, model.transport(0).apiKey], [401, [], 0, ""], "no request leaves the page, and the page isn't told: there was no key to turn down");

  model.setKey(` ${KEY} `);
  const { fetch: send, apiKey } = model.transport(1);
  assert.equal(apiKey, KEY);
  assert.equal((await send!(RESPONSES, { headers: { authorization: `Bearer ${apiKey}` } })).status, 200);
  assert.equal((await send!("https://openrouter.ai/api/v1/turned-down", {})).status, 401);
  assert.equal(refused, 1, "the page asks for another key");
  await assert.rejects(send!("https://openrouter.ai/api/v1/down", {}), (error: Error) => error.name === "TypeError" && !error.message.includes(KEY) && error.message.includes("[redacted]"));
  assert.equal(asked[0], `${RESPONSES} Bearer ${KEY}`);
});

test("redact takes the key out, and anything else shaped like an OpenRouter key", () => {
  assert.equal(redact(`the key ${KEY} and sk-or-v1-somethingelse1234`, KEY), "the key [redacted] and [redacted]");
  assert.equal(redact("nothing secret here"), "nothing secret here");
});

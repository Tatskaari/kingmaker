import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { portraitExpressions, type PortraitExpression } from "../packages/providers/src/conversation-expression.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { strangerPortrait } from "../apps/web/src/stranger-portrait.js";

test("every classified expression has a portrait and fear displays amusement", () => {
  for (const expression of Object.keys(portraitExpressions) as PortraitExpression[]) {
    const portrait = strangerPortrait(expression);
    const publicRoot = new URL("../apps/web/public/", import.meta.url);
    assert.ok(existsSync(new URL(portrait.src, publicRoot)));
    assert.match(portrait.alt, new RegExp(expression === "scared" ? "amused" : expression));
  }
  assert.deepEqual(strangerPortrait("scared"), strangerPortrait("amused"));
});

test("portrait URLs stay inside the deployed site at root and GitHub Pages paths", () => {
  for (const sitePath of ["/", "/kingmaker/"]) {
    for (const expression of Object.keys(portraitExpressions) as PortraitExpression[]) {
      const portrait = strangerPortrait(expression);
      for (const documentPath of [sitePath, `${sitePath}index.html`]) {
        const url = new URL(portrait.src, `https://example.github.io${documentPath}`);
        assert.equal(url.pathname, `${sitePath}assets/laughing-stranger/${portrait.expression}.png`);
      }
    }
  }
});

test("the classifier sees Stranger speech and the player, excluding setup and tools", async t => {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  const saved = runtime.snapshot();
  saved.gameMasterHistory = [
    { role: "user", content: "[Crossroads character creation] Hidden setup" },
    { role: "assistant", content: null, tool_calls: [{ id: "tool", type: "function", function: { name: "offer_replies", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "tool", content: "Internal result" },
    { role: "assistant", content: "What do you want?" },
  ];
  runtime.restore(saved);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: "He laughs. A splendid joke!" }));
  await runtime.talkToGameMaster("I want to make them laugh.");
  t.mock.method(JevClient.prototype, "choose", async (input: any) => {
    assert.deepEqual(input, { characterId: "gm", history: [
      { speakerId: "gm", text: "What do you want?" },
      { speakerId: "player", text: "I want to make them laugh." },
      { speakerId: "gm", text: "He laughs. A splendid joke!" },
    ], recentPortraits: ["serious", "neutral", "amused", "amused", "amused"] });
    return { choice: "amused", probabilities: { amused: 1 } };
  });
  const before = runtime.snapshot();
  assert.equal(await runtime.classifyStrangerExpression(["angry", "serious", "neutral", "amused", "amused", "amused"]), "amused");
  await assert.rejects(runtime.classifyStrangerExpression(["invented"]), /Invalid portrait history/);
  assert.deepEqual(runtime.snapshot(), before);
  assert.equal(runtime.recentTranscripts()[0]!.kind, "conversation_expression");
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("Offline"); });
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  assert.equal(runtime.recentTranscripts()[0]!.status, "error");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { AlertLog } from "../apps/web/src/alerts.js";

test("worker text updates display incrementally, coalesce frames, and discard stale or failed replies", async () => {
  const frames: Array<() => void> = [], sent: any[] = [];
  let receive!: (event: any) => void;
  let mounted = false, markup = "", insertions = 0;
  const text = { textContent: "" }, reply = { hidden: true }, waiting = { hidden: false };
  const draft = { remove() { mounted = false; text.textContent = ""; } };
  const container = {
    querySelector(selector: string): any {
      return selector === "[data-dialogue-stream]" ? mounted ? draft : null
        : selector === "[data-stream-text]" ? text : selector === "[data-stream-reply]" ? reply : waiting;
    },
    insertAdjacentHTML(_position: string, html: string) { mounted = true; markup = html; insertions++; },
    scrollTo() {}, scrollHeight: 100,
  };
  const context = createContext({
    URL, AlertLog, installDicePreview() {}, window: {}, devOpenRouterApiKey: "", newTraveller: () => ({}),
    coalescedRefresh: () => () => {}, patronName: "The Stranger",
    escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    document: { querySelector: (selector: string) => selector === "[data-dialogue-stream]" ? mounted ? draft : null : container, addEventListener() {} },
    Worker: class {
      addEventListener(_type: string, callback: typeof receive) { receive = callback; }
      postMessage(message: any) { sent.push(message); }
    },
  });
  const source = readFileSync(new URL("../apps/web/src/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", JSON.stringify(import.meta.url))
    .replace(/if \(apiKey\) run\(\(\) => configure\(apiKey\)\);\s*else render\(\);/, "");
  runInContext(`${source}
    render = () => { throw new Error("Streaming must not rebuild the page"); };
    busy = true; state = { phase: "player_creation", characters: [{ id: "rowan", name: "Rowan" }] };
  `, context);
  const emit = (requestId: number, characterId: string, value: string) => receive({ data: { type: "dialogue_stream", requestId, characterId, text: value } });
  const flush = () => { while (frames.length) frames.shift()!(); };
  const gm = runInContext('rpc("gm", { message: "<Hello>" })', context);
  emit(sent[0].id, "gm", "Hello"); emit(sent[0].id, "gm", "Hello traveller");
  assert.equal(frames.length, 1);
  flush();
  assert.equal(text.textContent, "Hello traveller");
  assert.match(markup, /&lt;Hello&gt;/);
  assert.equal(waiting.hidden, true);
  emit(sent[0].id, "gm", "Hello traveller, welcome."); flush();
  assert.equal(text.textContent, "Hello traveller, welcome.");
  assert.equal(insertions, 1, "Reuse the existing bubble while text grows");
  emit(sent[0].id, "gm", ""); flush();
  assert.equal(reply.hidden, true, "A retry clears the abandoned text");
  emit(sent[0].id, "gm", "retry");
  receive({ data: { id: sent[0].id, ok: true, value: {} } }); await gm; flush();
  assert.equal(mounted, false, "Completion removes the provisional bubble");
  emit(sent[0].id, "gm", "late"); flush();
  assert.equal(mounted, false);

  runInContext('activeCharacter = "rowan"; state.phase = "conversations";', context);
  const talk = runInContext('rpc("talk", { characterId: "rowan", message: "Hi" })', context);
  const failure = assert.rejects(talk, /Offline/);
  emit(sent[1].id, "someone-else", "wrong character"); flush();
  assert.equal(mounted, false);
  emit(sent[1].id, "rowan", "Welcome"); flush();
  assert.equal(text.textContent, "Welcome");
  receive({ data: { id: sent[1].id, ok: false, error: "Offline" } }); await failure;
  assert.equal(mounted, false, "Failures remove uncommitted text");

  const stale = runInContext('rpc("talk", { characterId: "rowan", message: "Hi" })', context);
  runInContext("gameViewGeneration++;", context);
  emit(sent[2].id, "rowan", "wrong game"); flush();
  assert.equal(mounted, false);
  receive({ data: { id: sent[2].id, ok: true, value: {} } }); await stale;
});

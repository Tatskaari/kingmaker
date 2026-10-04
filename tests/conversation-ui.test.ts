import { loadPlayableWorld } from "./fixtures.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { act, createElement } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ConversationApp, type ConversationResult } from "../apps/conversation-cli/app.js";
import { loreService } from "../packages/conversation/src/adapters.js";
import { DisclosureSession } from "../packages/conversation/src/disclosure.js";

test("OpenTUI scrolls and copies pane-local text while preserving message clicks and dialogue", async () => {
  const copied: string[] = [];
  const setup = await testRender(createElement(ConversationApp, {
    input: {
      snapshot: { world: loadPlayableWorld() },
      characterId: "corvin", transcript: [], message: "",
      sources: [{ path: "private.md", markdown: Array.from({ length: 100 }, (_, i) => `Lore line ${i + 1}`).join("\n") }, { path: "knowledge.md", markdown: "Known things" }, { path: "character.md", markdown: "Scenario" }],
    },
    complete: async () => ({ role: "assistant" as const, content: "A reply from Corvin." }),
    copyText: async text => { copied.push(text); return "Copied selection."; },
    onFinish: () => { throw new Error("Copy must not finish the conversation"); },
  }), { width: 100, height: 30, exitOnCtrlC: false, autoFocus: false });
  const step = async (action: () => void | Promise<void>) => { await act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 60)); }); await setup.flush(); };
  try {
    await setup.flush();
    await step(() => setup.mockMouse.click(83, 4));
    assert.match(setup.captureCharFrame(), /2\. system · Esc/);
    await step(() => setup.mockMouse.drag(2, 4, 12, 6));
    const selection = setup.renderer.getSelection()?.getSelectedText();
    assert.equal(selection, "Lore line 1\nLore line 2\nLore line 3");
    await step(() => setup.mockInput.pressKey("c", { ctrl: true }));
    assert.deepEqual(copied, [selection]);
    await step(() => setup.mockMouse.scroll(10, 10, "down"));
    assert.doesNotMatch(setup.captureCharFrame(), /# Lore: private/);
    assert.match(setup.captureCharFrame(), /1\. system/);
    // Dragging in the other pane must not activate a message or copy left-pane lore.
    await step(() => setup.mockMouse.drag(81, 3, 89, 5));
    const sidebar = setup.renderer.getSelection()?.getSelectedText() ?? "";
    assert.match(sidebar, /system/);
    assert.doesNotMatch(sidebar, /Lore line/);
    assert.match(setup.captureCharFrame(), /2\. system · Esc/);
    await step(() => setup.mockInput.pressKey("y", { ctrl: true }));
    assert.equal(copied[1], sidebar);
    await step(() => setup.mockInput.pressEscape());
    await step(() => setup.mockInput.typeText("Hello"));
    await step(() => setup.mockInput.pressEnter());
    await setup.waitForFrame(frame => frame.includes("A reply from Corvin."));
    assert.match(setup.captureCharFrame(), /7\. assistant/);
    await step(() => setup.mockMouse.click(83, 9));
    assert.match(setup.captureCharFrame(), /7\. assistant · Esc/);
    await step(() => setup.resize(80, 24));
    assert.match(setup.captureCharFrame(), /A reply from Corvin/);
  } finally { await act(() => setup.renderer.destroy()); }
});

test("Jev rounds and opened Markdown can be inspected and exported alongside model messages", async () => {
  const initial = [{ path: "character.md", markdown: "[Details](detail.md)" }];
  const detail = { path: "detail.md", markdown: "REVEALED_DETAIL" };
  const disclosure = new DisclosureSession(loreService({ initial, read: () => detail,
    candidates: opened => opened.length === 1 ? [{ path: detail.path, from: initial[0]!.path }] : [],
  }), { responses: async () => { throw new Error("unused"); }, decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(id => [id,
    { choice: id, probabilities: { [id]: 0.9, skip: 0.1 } },
  ])) });
  let exported: ConversationResult | undefined;
  const setup = await testRender(createElement(ConversationApp, {
    input: { snapshot: { world: loadPlayableWorld() },
      characterId: "corvin", sources: initial, transcript: [], message: "" },
    disclosure,
    complete: async request => {
      assert.ok(request.messages.some(message => message.content?.includes("REVEALED_DETAIL")));
      return { role: "assistant" as const, content: "Informed reply." };
    },
    copyText: async () => "Copied.", onFinish: result => { exported = result; },
  }), { width: 100, height: 30, exitOnCtrlC: false, autoFocus: false });
  const step = async (action: () => void | Promise<void>) => {
    await act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 60)); }); await setup.flush();
  };
  const click = async (id: string) => {
    const row = setup.renderer.root.findDescendantById(id)!;
    await step(() => setup.mockMouse.click(row.x + 2, row.y));
  };
  try {
    await setup.flush();
    await step(() => setup.mockInput.typeText("Tell me more."));
    await step(() => setup.mockInput.pressEnter());
    assert.match(setup.captureCharFrame(), /Informed reply/);
    const rowY = (id: string) => setup.renderer.root.findDescendantById(id)!.y;
    assert.ok(rowY("message-4") < rowY("jev-1-1"), "player message precedes Jev");
    assert.ok(rowY("jev-1-1") < rowY("opened-1-1-0"), "opened note follows its Jev round");
    assert.ok(rowY("opened-1-1-0") < rowY("jev-1-2"), "opened note stays with its round");
    assert.ok(rowY("jev-1-2") < rowY("message-5"), "Jev precedes the character reply");
    await click("jev-1-1");
    assert.match(setup.captureCharFrame(), /open_1: 0.9/);
    assert.match(setup.captureCharFrame(), /OPENED/);
    await click("opened-1-1-0");
    assert.match(setup.captureCharFrame(), /REVEALED_DETAIL/);
    await click("jev-1-2");
    assert.match(setup.captureCharFrame(), /no_links/);
    await step(() => setup.mockInput.pressKey("d", { ctrl: true }));
    assert.equal(exported?.disclosure.length, 2);
    assert.equal(exported?.openedDocuments[1]?.markdown, detail.markdown);
    assert.equal(exported?.transcript.length, 2);
  } finally { await act(() => setup.renderer.destroy()); }
});

test("CLI pauses for a manual d20, rejects invalid input, and shows the GM ruling", async () => {
  let calls = 0;
  const ai: import("../packages/conversation/src/services.js").AiService = {
    decisions: async (_state, questions) => Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      const choice = "needed" in question.criteria ? id === "persuasion" ? "needed" : "not_needed" : "normal";
      return [id, { choice, probabilities: { [choice]: 1 } }];
    })),
    responses: async request => {
      calls++;
      assert.match(JSON.stringify(request.messages), /critical_success/);
      return { role: "assistant", content: JSON.stringify({ direction: "Accept the proposal." }) };
    },
  };
  const initial = [{ path: "character.md", markdown: "A cautious envoy." }];
  const disclosure = new DisclosureSession({ initial, links: () => [], open: async () => { throw new Error("unused"); } }, ai);
  const setup = await testRender(createElement(ConversationApp, {
    input: { snapshot: { world: loadPlayableWorld() },
      characterId: "corvin", sources: initial, transcript: [], message: "" },
    disclosure, checks: { ai, build: undefined },
    complete: async request => {
      assert.match(JSON.stringify(request.messages), /Accept the proposal/);
      return { role: "assistant", content: "Agreed." };
    },
    copyText: async () => "Copied.", onFinish: () => {},
  }), { width: 120, height: 30, exitOnCtrlC: false, autoFocus: false });
  const step = async (action: () => void | Promise<void>) => {
    await act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 60)); }); await setup.flush();
  };
  try {
    await setup.flush();
    await step(() => setup.mockInput.typeText("Support my proposal."));
    await step(() => setup.mockInput.pressEnter());
    assert.match(setup.captureCharFrame(), /persuasion.*normal.*modifier \+0/);
    assert.equal(calls, 0);
    await step(() => setup.mockInput.typeText("21"));
    await step(() => setup.mockInput.pressEnter());
    assert.match(setup.captureCharFrame(), /whole number from 1 to 20/);
    assert.equal(calls, 0);
    await step(() => setup.mockInput.pressKey("a", { ctrl: true }));
    await step(() => setup.mockInput.pressKey("k", { ctrl: true }));
    await step(() => setup.mockInput.typeText("20"));
    await step(() => setup.mockInput.pressEnter());
    assert.match(setup.captureCharFrame(), /Agreed/);
    assert.match(setup.captureCharFrame(), /GM roll ruling/);
    assert.equal(calls, 1);
    const rowY = (id: string) => setup.renderer.root.findDescendantById(id)!.y;
    assert.ok(rowY("jev-1-1") < rowY("gm-0"));
    assert.ok(rowY("gm-0") < rowY("message-4"));
  } finally { await act(() => setup.renderer.destroy()); }
});

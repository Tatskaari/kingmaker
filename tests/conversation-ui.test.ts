import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
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
      snapshot: { scenario: JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")) },
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
    assert.match(setup.captureCharFrame(), /6\. assistant/);
    await step(() => setup.mockMouse.click(83, 8));
    assert.match(setup.captureCharFrame(), /6\. assistant · Esc/);
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
    input: { snapshot: { scenario: JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")) },
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

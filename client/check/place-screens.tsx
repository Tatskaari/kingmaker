// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a, its scene's place (:419-598): the place drawn beside the conversation, pointing by mouse and by key, a click, the right-click menu and what its choices do; drawn from the place's rows (check/place.ts) in place of a live session, the moves recorded.
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ScenePlay } from "../app.tsx";
import { setGlyphSet } from "../look/glyphs.ts";
import { registerLookCanvas } from "../look/opentui.ts";
import { DEED_WAITS, SceneModel, type SceneActions } from "../scene/model.ts";
import { sceneViewOf } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";
import { sceneSide } from "../ui/scene.tsx";
import { yardPlaceRows } from "./place.ts";

/**
 * The scene's place (the world bridge's §3.5) at 80x24, 100x30 and 130x42: the granary yard drawn
 * from above in the side panel, from its rows, with who's in it listed under it by the names the
 * lead knows; the lead's @ in it. The pointer on someone says who they are and what a click does on
 * the bottom line (the spinner stays up beside it); a click on someone starts the line with their
 * name, on something leaves a glance (a quiet note, nothing sent); a right-click opens its menu
 * inside the panel, over none of the conversation; Prout's has getting him down, a spell, and the
 * rope under him, whose own menu cuts it, sent as the lead's line; an attack asks with what; giving
 * lists what Pell carries. By key: Tab to the nearest, ↓ the next, Enter its menu, a letter puts it
 * away and goes in the box, Esc lets go. While the GM has the floor the menu only looks, and a
 * spectator's only looks. On a page, the side panel has no game's number. Glyphs are the ascii
 * set's, whatever this terminal has.
 */
export async function checkPlace(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  registerLookCanvas();
  setGlyphSet("ascii");
  // The live canvas and the spinner redraw between frames, as in play: React's word on each isn't news.
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    for (const size of [[80, 24], [100, 30], [130, 42]] as const) await placeAt(checks, size, show);
    await onAPage(checks, show);
  } finally {
    console.error = error;
  }
}

/** The bottom line (what's pointed at, in place of the keys), the line under the conversation, and what's in the box. */
const under = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
const status = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) - 1]!.trim(); };
const boxed = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) + 1]!.replace(/│/g, "").trim(); };
/** The conversation's words, row by row: left of its scrollbar's column (and the padding and border right of that). */
const words = (frame: string, upTo: number) => { const rows = frame.split("\n"); return rows.slice(0, rows.findIndex(r => r.includes("What do you say?")) - 1).map(r => [...r].slice(0, upTo).join("")); };
const flat = (t: string) => t.replace(/\s+/g, " ");
/** The conversation's words as one line, so a note that wraps reads whole. */
const talked = (frame: string, upTo: number) => flat(words(frame, upTo).map(r => r.replace(/[│┃╭╮╰╯─┌┐└┘▄█]/g, " ")).join(" "));
/** The mock mouse's buttons. */
const LEFT = 0, RIGHT = 2;

async function placeAt(checks: Array<[string, boolean]>, [w, h]: readonly [number, number], show: boolean): Promise<void> {
  const size = `place ${w}x${h}`;
  const side = sceneSide(w);
  const sent: string[] = [];
  const actions: SceneActions = { say: text => sent.push(text), retry: () => sent.push("/retry"), setSuggestions: async () => undefined, out: () => sent.push("(out)"), quit: () => {} };
  const yard = sceneViewOf(yardPlaceRows());
  const scene = new SceneModel(yard, actions);
  const set = (view: SceneView) => act(() => scene.update(view));
  const setup = await testRender(<ScenePlay scene={scene} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  // A lone Esc reaches the screen once the terminal's reader is sure it isn't the start of a longer key.
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); await setup.renderOnce(); };
  const click = async (p: { x: number; y: number }, button: typeof LEFT | typeof RIGHT = LEFT) => { await act(async () => { await setup.mockMouse.click(p.x, p.y, button); }); return await draw(); };
  const key = async (k: string) => { act(() => setup.mockInput.pressKey(k)); return await draw(); };
  await draw();
  let frame = await draw();
  if (show) console.log(`${size}\n${frame}`);

  // The place, its title over it and who's in it under it, by the names Pell knows.
  const rows = frame.split("\n");
  const top = rows.findIndex(r => r.includes("The yard behind the K"));
  const list = rows.findIndex((r, i) => i > top && r.includes("@ you"));
  const placeRows = rows.slice(top + 1, list).map(r => [...r].slice(w - side + 2, w - 2).join(""));
  checks.push([`${size}: the yard is drawn in the side panel, the lead's @ in it, and who's in it under it, by the names the lead knows`,
    top > 0 && list > top + 4 && placeRows.some(r => r.includes("@")) && /K Sergeant Agnes K/.test(frame) && /c the boy in the to/.test(frame) && /m the girl in the/.test(frame)]);
  checks.push([`${size}: the game's number still, to watch it by`, w < 100 ? /Game 1 · --join 1/.test(frame) : /Game 1/.test(frame) && /--join 1 to watch/.test(frame)]);
  checks.push([`${size}: the keys say Tab goes through the place`, /Tab the place/.test(under(frame))]);

  /**
   * Point at each cell of the place until the bottom line names someone (and `also` holds there),
   * then at the lines of the list under it: a small place draws someone behind whoever stands in
   * front of them (at 80x24, Kell is under the lead's @).
   */
  const end = rows.findIndex((r, i) => i > list && /Game 1/.test(r));
  const find = async (name: string, also: (p: { x: number; y: number }) => Promise<boolean> = async () => true) => {
    for (let y = top + 1; y < end; y++) for (let x = w - side + 2; x < w - 2; x++) {
      if (y >= list && x > w - side + 3) break;
      await act(async () => { await setup.mockMouse.moveTo(x, y); });
      await setup.renderOnce();
      if (under(setup.captureCharFrame()).startsWith(name) && await also({ x, y })) return { x, y };
    }
    return undefined;
  };
  const cob = await find("The boy in the too-big boots");
  checks.push([`${size}: pointing at Cob in the place says who he is (as he's known: no name yet) and what he's doing (${under(setup.captureCharFrame()).slice(0, 60)})`, !!cob && /^The boy in the too-big boots +· +under the body/.test(under(setup.captureCharFrame()))]);
  const kell = await find("Sergeant Agnes Kell");
  checks.push([`${size}: pointing at Kell, and what a click does`, !!kell && /click(:| to) talk/.test(under(setup.captureCharFrame()))]);
  const prout = await find("Wendell Prout's body");
  checks.push([`${size}: pointing at Prout's body names it, hanging (${under(setup.captureCharFrame()).slice(0, 60)})`, !!prout && /^Wendell Prout's body +· +hanging/.test(under(setup.captureCharFrame()))]);
  // The list under the place points too.
  const girl = rows.findIndex(r => r.includes("m the girl in the"));
  await act(async () => { await setup.mockMouse.moveTo(w - side + 6, girl); });
  frame = await draw();
  checks.push([`${size}: pointing at a line of the list says who it is`, /^The girl in the shawl +· +sitting on top of the yar/.test(under(frame))]);
  // The GM's spinner stays up while the pointer rests on someone.
  set({ ...yard, phase: "replying", mayType: false, draft: { speaker: "gm", kind: "narration", text: "Kell looks up.", attempt: 1, seq: 1 } });
  frame = await draw();
  checks.push([`${size}: with the GM speaking, the spinner stays up under the conversation while the pointer's on someone`, /The GM is speaking/.test(status(frame)) && /^The girl in the shawl/.test(under(frame))]);
  set(yard);
  // Enter with the box empty and the mouse merely resting on someone: nothing (it's for what Tab picked out).
  act(() => setup.mockInput.pressEnter());
  await draw();
  checks.push([`${size}: Enter with the mouse only resting on someone opens nothing`, !scene.sceneMenu && !sent.length]);
  if (!cob || !kell || !prout) { await setup.dispose(); return; }

  // A right-click on Cob: his menu, inside the panel, never over the conversation's words.
  const before = words(await draw(), w - side - 3);
  frame = await click(cob, RIGHT);
  if (show) console.log(`${size}, Cob's menu\n${frame}`);
  checks.push([`${size}: a right-click on Cob opens his menu: talk, look, look him over, give, go over, cast, and last attack`, /1 Talk to them/.test(frame) && /2 Look at them/.test(frame) && /3 Look them over/.test(frame) && /4 Give them something…/.test(frame) && /6 Cast a spell at them…/.test(frame) && /7 Attack them…/.test(frame) && /Esc never mind/.test(frame)]);
  checks.push([`${size}: the menu hides none of the conversation`, words(frame, w - side - 3).every((r, i) => r === before[i])]);
  await esc();
  checks.push([`${size}: Esc closes the menu`, !scene.sceneMenu && !/Esc never mind/.test(await draw())]);
  // Looking: at once, a quiet note in the conversation, and not a turn.
  await click(cob, RIGHT);
  frame = await key("2");
  checks.push([`${size}: Look notes what a glance shows of him, and sends nothing`, /◉ +The boy in the too-big boots\. Under the/.test(frame) && !sent.length]);
  // A click on Prout: a glance (what anyone could see, never the GM's description).
  frame = await click(prout);
  checks.push([`${size}: a click on Prout's body leaves a glance at it in the conversation, and sends nothing`, talked(frame, w - side - 3).includes("◉ Wendell Prout's body: hanging from the hoist rope") && !sent.length && !/cord mark/.test(frame)]);
  // A right-click on Prout: get him down, a spell at him; → into the spell's menu, ← back out.
  frame = await click(prout, RIGHT);
  if (show) console.log(`${size}, Prout's menu\n${frame}`);
  const labels = scene.sceneMenu?.actions.map(a => a.label) ?? [];
  checks.push([`${size}: a right-click on Prout's body: look at it, get it down, a spell at it (${labels.join(", ")})`, ["Look at it", "Get it down", "Cast a spell at it…"].every(l => labels.includes(l)) && /Get it down/.test(frame)]);
  act(() => { scene.sceneMenu!.index = labels.indexOf("Cast a spell at it…"); scene.emit(); });
  await key("\u001b[C");
  const into = scene.sceneMenu?.title;
  await key("\u001b[D");
  checks.push([`${size}: → goes into the spells' menu (${into}), ← back out to Prout's`, into === "Cast at Wendell Prout's body…" && scene.sceneMenu?.title === "Wendell Prout's body"]);
  await esc();
  // Where the rope is drawn under him, his menu offers it too, with its own menu: cut it, a spell at it.
  const offers = async (p: { x: number; y: number }) => {
    await click(p, RIGHT);
    const has = !!scene.sceneMenu?.actions.some(a => a.label === "The hoist rope…");
    if (!has) await esc();
    return has;
  };
  const withRope = await find("Wendell Prout's body", offers);
  checks.push([`${size}: where the rope is drawn under him, Prout's menu offers it too (${scene.sceneMenu?.actions.map(a => a.label).join(", ")})`, !!withRope]);
  const rope = scene.sceneMenu?.actions.findIndex(a => a.label === "The hoist rope…") ?? -1;
  frame = await key(String(rope + 1));
  const ropeLabels = scene.sceneMenu?.actions.map(a => a.label) ?? [];
  checks.push([`${size}: the rope's own menu, under its title, cuts it (${ropeLabels.join(", ")})`, scene.sceneMenu?.title === "The hoist rope" && ropeLabels.includes("Cut it") && /Cut it/.test(frame)]);
  // The spells that fit, from what the rules say of them (the sheet's spellFacts): Fire Bolt at a rope, not Shield.
  const cast = ropeLabels.indexOf("Cast a spell at it…");
  frame = await key(String(cast + 1));
  const spells = scene.sceneMenu?.actions.map(a => a.label) ?? [];
  checks.push([`${size}: a spell at the rope: those that fit (${spells.join(", ")})`, spells.includes("Fire Bolt (cantrip)") && spells.includes("Magic Missile (level 1)") && !spells.some(s => /Shield|Sleep/.test(s))]);
  // ← back out to the rope's menu; Cut it is sent as the lead's line.
  await key("\u001b[D");
  frame = await draw();
  const cut = scene.sceneMenu?.actions.findIndex(a => a.label === "Cut it") ?? -1;
  frame = await key(String(cut + 1));
  checks.push([`${size}: back in the rope's menu, Cut it is sent as the lead's line (${sent.at(-1)})`, cut >= 0 && sent.at(-1) === "(I cut the hoist rope)" && !scene.sceneMenu]);
  // A right-click on the open menu chooses nothing: it opens the menu of what's under it.
  frame = await click(kell, RIGHT);
  const item = (() => { const rs = frame.split("\n"); const y = rs.findIndex(r => r.includes("1 Talk to them")); return y < 0 ? undefined : { x: [...rs[y]!].join("").indexOf("1 Talk to them") + 4, y }; })();
  const said = sent.length;
  if (item) frame = await click(item, RIGHT);
  checks.push([`${size}: a right-click on the open menu chooses nothing (${scene.sceneMenu?.title ?? "none"})`, !!item && sent.length === said && !/^(Kell, |Sergeant Kell, )/.test(boxed(frame))]);
  await esc();
  // An attack is two choices: with what.
  await click(cob, RIGHT);
  const attack = scene.sceneMenu?.actions.findIndex(a => a.id === "attack") ?? -1;
  frame = await key(String(attack + 1));
  checks.push([`${size}: choosing to attack asks with what, and sends nothing yet (${scene.sceneMenu?.title})`, attack >= 0 && /with…$/.test(scene.sceneMenu?.title ?? "") && /Your bare hands/.test(frame) && /Your quarterstaff/.test(frame) && sent.length === said]);
  await esc();
  // A deed from a further menu: what to give him, sent as the lead's line.
  await click(cob, RIGHT);
  const giving = scene.sceneMenu?.actions.findIndex(a => a.id === "give") ?? -1;
  frame = await key(String(giving + 1));
  const pennies = scene.sceneMenu?.actions.findIndex(a => a.id.startsWith("give:") && /pennies/.test(a.label)) ?? -1;
  checks.push([`${size}: giving him something lists what Pell carries, under its own title`, /Give the boy in the/.test(frame) && /12 pennies/.test(frame) && pennies >= 0]);
  frame = await key(String(pennies + 1));
  checks.push([`${size}: choosing the pennies sends the deed as the lead's line (${sent.at(-1)})`, sent.at(-1) === "(I give the boy in the too-big boots one of my pennies)" && !scene.sceneMenu]);
  // A click talks: what he's called starts the line, before anything typed; Kell's in its place.
  frame = await click(cob);
  checks.push([`${size}: a click on Cob starts the line "Boy, "`, boxed(frame) === "Boy,"]);
  await act(async () => { await setup.mockInput.typeText("who cut him down?"); });
  frame = await click(kell);
  checks.push([`${size}: then a click on Kell: "Sergeant Kell, who cut him down?" (nothing typed lost)`, boxed(frame) === "Sergeant Kell, who cut him down?"]);
  // The box keeps its keys: Enter sends what's in it, not a menu.
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: Enter sends the line in the box`, sent.at(-1) === "Sergeant Kell, who cut him down?" && !scene.sceneMenu]);
  // By key: Tab to the nearest person (no marks in the reply to go through since M2), ↓ the next, Enter for the menu, a letter puts it away and goes in the box.
  await act(async () => { await setup.mockMouse.moveTo(1, 1); });
  act(() => setup.mockInput.pressTab());
  frame = await draw();
  checks.push([`${size}: Tab picks out the nearest person at once (${under(frame).slice(0, 40)})`, under(frame).startsWith("Sergeant Agnes Kell")]);
  act(() => setup.mockInput.pressArrow("down"));
  frame = await draw();
  checks.push([`${size}: ↓ (nothing typed) the next (${under(frame).slice(0, 40)})`, under(frame).startsWith("The girl in the shawl")]);
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: Enter (nothing typed) opens her menu`, scene.sceneMenu?.title === "The girl in the shawl" && /Esc never mind/.test(frame)]);
  await act(async () => { await setup.mockInput.typeText("M"); });
  frame = await draw();
  checks.push([`${size}: a letter with the menu open closes it and goes in the box`, !scene.sceneMenu && boxed(frame) === "M"]);
  act(() => setup.mockInput.pressBackspace());
  await esc();
  frame = await draw();
  checks.push([`${size}: Esc lets go of what Tab picked out`, !/^The girl in the shawl/.test(under(frame))]);

  // While the GM has the floor: only looking (Prout's menu is a glance, and the rope's under it), and a deed waits for nobody.
  set({ ...yard, phase: "deciding", mayType: false });
  await click(prout, RIGHT);
  const busy = scene.sceneMenu?.actions.map(a => a.id) ?? [];
  checks.push([`${size}: while the GM has the floor, Prout's menu only looks (${busy.join(", ")})`, busy[0] === "look" && !busy.includes("get-down") && !busy.includes("cast")]);
  await esc();
  const deeds = sent.length;
  act(() => scene.deed("(I cut the hoist rope)"));
  frame = await draw();
  checks.push([`${size}: a deed while the GM has the floor waits for nobody: the prototype's words on the status line, nothing sent`, status(frame) === DEED_WAITS && sent.length === deeds]);
  // A spectator: the same place (a row lower, under "Watching"); the menu only looks, and talks to no one.
  set({ ...yard, watching: "Pell Marrow", mayType: false });
  frame = await draw();
  const watched = frame.split("\n").findIndex(r => r.includes("The yard behind the K"));
  const theirs = watched > 0 ? await (async () => { for (let y = watched + 1; y < h - 4; y++) for (let x = w - side + 2; x < w - 2; x++) { await act(async () => { await setup.mockMouse.moveTo(x, y); }); await setup.renderOnce(); if (under(setup.captureCharFrame()).startsWith("Sergeant Agnes Kell")) return { x, y }; } return undefined; })() : undefined;
  if (theirs) await click(theirs, RIGHT);
  checks.push([`${size}: a spectator sees the place, and Kell's menu only looks (${scene.sceneMenu?.actions.map(a => a.label).join(", ")})`, /Watching/.test(frame) && /K Sergeant Agnes K/.test(frame) && scene.sceneMenu?.title === "Sergeant Agnes Kell" && scene.sceneMenu.actions.map(a => a.label).join() === "Look at them"]);
  checks.push([`${size}: a spectator's list names the lead's character, not "you"`, /@ Pell Marrow/.test(frame) && !/@ you/.test(frame)]);
  await esc();
  await setup.dispose();
}

/** The yard on a page (the app's surface): the place and who's in it as in a terminal, and no game's number, since no terminal can watch from there. */
async function onAPage(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const scene = new SceneModel(sceneViewOf(yardPlaceRows()), { say: () => {}, retry: () => {}, setSuggestions: async () => undefined, out: () => {}, quit: () => {} });
  const setup = await testRender(<ScenePlay scene={scene} surface="page" />, { width: 100, height: 30 });
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  if (show) console.log(`place 100x30 on a page\n${frame}`);
  checks.push(["place 100x30 on a page: the yard and who's in it, and no game's number to watch it by", /The yard behind the K/.test(frame) && /K Sergeant Agnes K/.test(frame) && !/Game 1/.test(frame) && !/--join/.test(frame)]);
  await setup.dispose();
}

/**
 * The scene screen with a marked-up conversation (src/runtime/markup.ts), drawn offline: for a look
 * at the speakers' colours, the paragraphs, the marks and their popover, at any size.
 *
 *   KM_RUNS_DIR=runs/check OPENROUTER_API_KEY=offline node --experimental-ffi --no-warnings --import tsx src/app/smoke/marks-demo.tsx [80x24] [--open N] [--tab N] [--spans]
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession } from "../../game/combat/index.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import type { Game as Core } from "../../game/play.ts";
import { presentCast } from "../../runtime/brief.ts";
import { linkMarks } from "../../runtime/knowledge.ts";
import { parseMarkup } from "../../runtime/markup.ts";
import { readReply } from "../../runtime/voices.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import type { SessionState } from "../../runtime/session.ts";
import { Game, type Line } from "../game.ts";
import { Overlay } from "../ui/overlay.tsx";
import { SceneScreen } from "../ui/scene.tsx";

process.env.KM_GLYPHS ??= "ascii";
registerLookCanvas();

/** The granary yard, a few turns in: the replies as the GM wrote them, markup and all. */
export async function markedYard(): Promise<{ session: SessionState; lines: Line[] }> {
  const scene = sceneById("hanged-clerk");
  const yard = await pregenSession({ pregen: "wizard", name: "Pell Marrow", level: 3, seed: 3, sceneId: "hanged-clerk" });
  Object.assign(yard, { beat: scene.start });
  const people = presentCast(scene, yard);
  yard.world = buildWorld(scene.id, scene.world!, people.map(c => ({ id: c.id, name: c.name })), yard.player);
  joinWorld(yard.world, people.map(c => ({ id: c.id, name: c.name })), 0);
  const lines: Line[] = [{ kind: "header", speaker: "system", name: scene.title, text: scene.hook, scene: scene.id }];
  const say = (text: string, turn: number) => {
    yard.transcript.push({ turn, scene: scene.id, speaker: "player", kind: "player", text });
    lines.push({ kind: "player", speaker: "player", name: yard.player.name, text, scene: scene.id });
  };
  // Each reply as the GM wrote it, and its notes as the notes' writer might have written them (here,
  // the demo's own, in the markup: src/runtime/notes.ts writes the real ones, from what the player knows).
  const reply = (raw: string, turn: number) => {
    const { text, marked: { speech } } = readReply(scene, yard, raw);
    const marked = linkMarks({ speech, marks: parseMarkup(raw).marks }, text, scene, yard);
    yard.transcript.push({ turn, scene: scene.id, speaker: "gm", kind: "narration", text, marked });
    lines.push({ kind: "narration", speaker: "gm", text, scene: scene.id, marked });
  };
  reply("The yard behind (the King's Granary)[know: The King's Granary feeds the palace; its yard backs onto the granary lane, and the watch keeps a house on the corner.] smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him.\n\n[Kell] “Sergeant Kell, of the watch. The Captain says suicide.” She doesn't say what she says. [Kell] “Investigator.”", 0);
  say("Boy! Stop that. Show some respect for the dead.", 1);
  reply("The boy freezes mid-throw. Then, very deliberately, he lobs one more.\n\n[the boy in the too-big boots] “He's not bothered.” He wipes his nose on his sleeve. [the boy in the too-big boots] “And you're not my da.”\n\nOn the wall, the girl in the shawl snorts. [the girl in the shawl] “Leave him be. (He don't talk to the watch's friends)[why: You came in with Sergeant Kell, and on the granary lane the watch takes a good coat's word over a granary kid's every time.].”", 1);
  say("*I put my hands up* I'm not the watch. I just want to know who found him.", 2);
  reply("Kell's pencil stops. [Kell] “You told the boy to show respect, and now (you're asking him for help)[you: You barked at him to stop throwing stones a minute ago.]. He'll have noticed.”\n\nThe boy looks at your hands, then at hers, and says nothing at all.", 2);
  return { session: yard, lines };
}

const size = (process.argv.find(a => /^\d+x\d+$/.test(a)) ?? "80x24").split("x").map(Number) as [number, number];
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : undefined; };
if (import.meta.main) {
  const { session, lines } = await markedYard();
  const game = new Game();
  game.core = { session, state: { version: 1, id: "demo", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode: "scene", text: "", actions: [] }) } as unknown as Core;
  game.screen = "scene";
  game.lines = lines;
  const [w, h] = size;
  const setup = await testRender(<><SceneScreen game={game} /><Overlay game={game} /></>, { width: w, height: h });
  await setup.renderOnce();
  await setup.renderOnce();
  const tabs = arg("tab") ?? 0;
  for (let i = 0; i < tabs; i++) { act(() => setup.mockInput.pressTab()); await setup.renderOnce(); }
  const open = arg("open");
  if (open !== undefined) { const last = game.lastMarks()[open]; if (last) game.openMark(last.line, last.mark); await act(async () => { game.emit(); }); await setup.renderOnce(); }
  // --click "some words": a click on the middle of them, where they're drawn.
  const click = process.argv.indexOf("--click");
  if (click >= 0) {
    const want = process.argv[click + 1]!;
    const rows = setup.captureCharFrame().split("\n");
    const y = rows.findIndex(r => r.includes(want));
    if (y >= 0) await act(async () => { await setup.mockMouse.click([...rows[y]!].join("").indexOf(want) + Math.floor(want.length / 2), y); });
    await setup.renderOnce();
  }
  console.log(setup.captureCharFrame());
  if (process.argv.includes("--spans")) {
    const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
    for (const [y, line] of setup.captureSpans().lines.entries()) {
      const marked = line.spans.filter(s => s.text.trim() && (s.attributes & 8 || !/^#(e9e2d0|ddd5c4|4a4458|8a8273|5c564d|15131a|302b39)$/.test(hex(s.fg))));
      if (marked.length) console.log(`${String(y).padStart(2)}: ${marked.map(s => `[${hex(s.fg)}${s.attributes & 8 ? " u" : ""}] ${s.text.trim()}`).join("  ")}`);
    }
  }
  await setup.dispose();
}

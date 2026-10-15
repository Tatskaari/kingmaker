/**
 * Live check of the scene's menu with the real GM: a ready-made wizard walks to the clerk's yard
 * (the real opening), then plays two deeds from the menu on the real screen. A right-click on the
 * boy in the list, Give them something, the pennies; then Prout's menu, the hoist rope under him,
 * Cast a spell at it, Fire Bolt, by key. Each goes as the turn, as if typed: the player's line,
 * the director and the rules (the spell's roll), the GM's reply, and what the world says after.
 *
 *   KM_RUNS_DIR=runs/live-check node --experimental-ffi --no-warnings --import tsx src/app/smoke/scene-menu-live.tsx
 *
 * Needs OPENROUTER_API_KEY (or ~/secrets/kingmaker-dev-openrouter.txt, which the game reads itself).
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { PREGENS } from "../../game/combat/index.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import { Game as Core } from "../../game/play.ts";
import { Game, type Line } from "../game.ts";
import { SceneScreen } from "../ui/scene.tsx";

process.env.KM_GLYPHS ??= "ascii";
registerLookCanvas();
const checks: Array<[string, boolean]> = [];
const note = (what: string, ok: boolean) => { checks.push([what, ok]); console.log(`${ok ? "ok" : "FAIL"}: ${what}`); };
const settle = async (game: Game, ms = 240_000) => { const end = Date.now() + ms; while ((game.busy || game.live) && Date.now() < end) await new Promise(r => setTimeout(r, 250)); };
const show = (lines: Line[]) => lines.map(l => `   [${l.kind}] ${l.name ? `${l.name}: ` : ""}${l.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");

const game = new Game();
game.core = await Core.create({ player: "Pell Marrow: an absent-minded hedge-wizard of the Invisible College", level: 3, build: PREGENS.wizard!.build, explorer: game.explorer, fights: game.fights });
game.screen = "explore";
console.log(`spells: ${(game.session?.rules?.spells ?? []).map(s => s.name).join(", ")}`);
await game.toLead();
await settle(game);
note(`the clerk's yard opens with the real GM (${game.lines.filter(l => l.kind === "narration" || l.kind === "dialogue").length} lines)`, (game.screen as string) === "scene" && game.lines.some(l => l.kind === "narration" || l.kind === "dialogue"));
console.log(show(game.lines.slice(-3)));

const setup = await testRender(<SceneScreen game={game} />, { width: 130, height: 42 });
const render = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
let frame = await render();
await render();

// 1. A right-click on the boy in the list under the place, Give them something, the pennies. (He's
// listed by what he's called until the GM has said his name: often in the opening, "Cob says...")
const listed = /c (the boy in the|Cob\b)/;
const row = frame.split("\n").findIndex(r => listed.test(r));
const col = row >= 0 ? (listed.exec(frame.split("\n")[row]!)?.index ?? 0) : 0;
const cob = game.sceneContext().unnamed?.cob ?? "Cob";
note(`the boy is listed under the place, as "${cob}"`, row > 0);
await act(async () => { await setup.mockMouse.click(col + 4, row, 2); });
frame = await render();
const give = game.sceneMenu?.actions.findIndex(a => a.id === "give") ?? -1;
note(`a right-click on him opens his menu (${game.sceneMenu?.actions.map(a => a.label).join(", ")})`, give >= 0);
act(() => setup.mockInput.pressKey(String(give + 1)));
frame = await render();
const pennies = game.sceneMenu?.actions.findIndex(a => a.id.startsWith("give:pennies")) ?? -1;
note("Give them something lists the pennies", pennies >= 0);
const line = game.sceneMenu?.actions[pennies]?.line;
const before = game.lines.length;
act(() => setup.mockInput.pressKey(String(pennies + 1)));
await new Promise(r => setTimeout(r, 300));
note(`choosing them sends the deed as the turn: ${line}`, game.busy !== undefined || game.lines.length > before);
await settle(game);
let turn = game.lines.slice(before);
console.log(show(turn));
note("the player's line is the deed, as if typed", turn[0]?.kind === "player" && turn[0].text === line);
note("the GM answers it", turn.some(l => l.kind === "narration" || l.kind === "dialogue"));
const world = game.session!.world!;
const cobs = Object.values(world.entities).filter(e => e.parent === "cob" && /penn/i.test(e.name));
const mine = Object.values(world.entities).find(e => e.parent === "player" && e.name === "pennies");
console.log(`   the world: the boy holds ${cobs.map(e => `${e.quantity ?? 1} ${e.name}`).join(", ") || "no pennies"}; you have ${mine?.quantity ?? 0} pennies`);

// 2. Prout's menu, the hoist rope under him, Cast a spell at it, Fire Bolt: by key.
await render();
game.openSceneMenu({ id: "prout", under: ["hoist-rope", "hoist-beam"] }, 100, 12);
frame = await render();
const rope = game.sceneMenu?.actions.findIndex(a => a.id === "also:hoist-rope") ?? -1;
note(`Prout's menu offers the rope under him (${game.sceneMenu?.actions.map(a => a.label).join(", ")})`, rope >= 0);
for (let i = 0; i < rope; i++) act(() => setup.mockInput.pressArrow("down"));
act(() => setup.mockInput.pressArrow("right"));
frame = await render();
const cast = game.sceneMenu?.actions.findIndex(a => a.id === "cast") ?? -1;
note(`→ goes into the rope's menu (${game.sceneMenu?.actions.map(a => a.label).join(", ")})`, game.sceneMenu?.title === "The hoist rope" && cast >= 0);
for (let i = 0; i < cast; i++) act(() => setup.mockInput.pressArrow("down"));
act(() => setup.mockInput.pressEnter());
frame = await render();
const bolt = game.sceneMenu?.actions.findIndex(a => a.id === "cast:fire-bolt") ?? -1;
note(`Enter opens the spells that fit (${game.sceneMenu?.actions.map(a => a.label).join(", ")})`, bolt >= 0 && !game.sceneMenu?.actions.some(a => a.id === "cast:shield"));
for (let i = 0; i < bolt; i++) act(() => setup.mockInput.pressArrow("down"));
const spell = game.sceneMenu?.actions[bolt]?.line;
const at = game.lines.length;
act(() => setup.mockInput.pressEnter());
await new Promise(r => setTimeout(r, 300));
await settle(game);
turn = game.lines.slice(at);
console.log(show(turn));
note(`the spell goes as the turn: ${spell}`, turn[0]?.kind === "player" && turn[0].text === spell);
note("the rules cast it (their line names Fire Bolt)", turn.some(l => (l.kind === "roll" || l.kind === "info") && /Fire Bolt/.test(l.text)));
note("the GM tells it", turn.some(l => l.kind === "narration" || l.kind === "dialogue"));
const after = game.session?.world;
const ropeNow = after?.entities["hoist-rope"], proutNow = after?.entities.prout;
console.log(`   the world: the rope ${ropeNow ? `${ropeNow.states.join(", ") || "as it was"} (hp ${ropeNow.hp?.current}/${ropeNow.hp?.max})` : "gone"}; Prout ${proutNow?.states.join(", ") || "as he was"}`);
console.log(`   the turns cost $${(game.session?.metrics ?? []).reduce((n, m) => n + m.costUsd, 0).toFixed(4)}`);
await setup.dispose();
const failed = checks.filter(([, ok]) => !ok).length;
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);

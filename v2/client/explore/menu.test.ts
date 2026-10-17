import assert from "node:assert/strict";
import { test } from "node:test";
import { actionId, type MapMove } from "../../shared/map/moves.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import { newGameOf, type Rejection } from "../backend.ts";
import { demoBackend } from "../demo.ts";
import * as verbs from "../headless.ts";
import { exploreRow, laneRows, mapView, useCaerwyn } from "../check/map.ts";
import { FIXTURE_TOWN, WIZARD_CATALOGUE } from "../check/town.ts";
import { entriesOf, ExploreModel } from "./model.ts";
import type { ExploreView } from "./rows.ts";
import { exploreText } from "./text.ts";
import type { TownMenu } from "./town.ts";

/**
 * The map's action menu in the explore model (town-design §3.9: the prototype's game.ts:1047-1170
 * over rows), on the lane in the morning with the ready-made wizard's catalogue and the fixture menu
 * (check/town.ts): m, a dimmed entry, aiming and doing it as its move, an area that would catch you,
 * a right-click's "Do something…", a refusal's words, a spectator's, the menu going wrong, the fight's
 * card, and observe's menu.
 */

function lane(options: { refuse?: Rejection; town?: TownMenu; view?: Partial<ExploreView> } = {}): { model: ExploreModel; moves: MapMove[]; fought: () => number } {
  useCaerwyn();
  const moves: MapMove[] = [];
  let fought = 0;
  const view: ExploreView = { ...mapView(laneRows(exploreRow({ x: 42, y: 9 }))), catalogue: WIZARD_CATALOGUE, keep: {}, ...options.view };
  const model = new ExploreModel(view, {
    move: m => { moves.push(m); return Promise.resolve(options.refuse); }, quit: () => {},
    fightItOut: async () => { fought++; return undefined; },
  }, () => undefined, () => undefined, options.town ?? FIXTURE_TOWN);
  return { model, moves, fought: () => fought };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("m: the menu by kind, the first thing that can be done picked out; one that can't is only picked out, and does nothing", async () => {
  const { model, moves } = lane();
  model.openActions();
  const menu = model.doMenu!;
  assert.equal(menu.view.title, "What will you do?");
  assert.deepEqual(menu.view.sections.map(s => s.title), ["Cantrips", "1st level", "2nd level", "Class features", "Actions"]);
  const entries = entriesOf(menu.view);
  assert.equal(entries[menu.index]!.key, "spell:fire-bolt");
  assert.equal(entries.find(e => e.key === "hide")?.id, "hide", "what needs no aim is ready as it is");
  assert.equal(entries.find(e => e.key === "spell:fire-bolt")?.aiming, true, "what's aimed is aimed on the map first");

  const shield = entries.findIndex(e => e.key === "spell:shield");
  model.chooseAction(shield);
  assert.equal(model.doMenu?.index, shield, "a dimmed one is picked out");
  assert.equal(model.aiming, undefined);
  await settle();
  assert.equal(moves.length, 0);
});

test("an aimed entry is aimed at the nearest in reach; Enter does it there, as its move", async () => {
  const { model, moves } = lane();
  model.openActions();
  model.chooseAction(entriesOf(model.doMenu!.view).findIndex(e => e.key === "spell:fire-bolt"));
  const aiming = model.aiming!;
  assert.equal(model.doMenu, undefined);
  assert.equal(aiming.item.key, "spell:fire-bolt");
  assert.deepEqual(aiming.at, aiming.view.start, "at the nearest thing in reach");
  assert.equal(aiming.check?.ok, true);
  assert.ok(aiming.view.ring.length > 0, "the ring of its reach");

  const at = { ...aiming.at };
  model.fire();
  await settle();
  assert.equal(model.aiming, undefined);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { move: "cast", args: { spell: "fire-bolt", at } });
  assert.equal(actionId(moves[0]!), `cast_fire-bolt@${at.x},${at.y}`);
});

test("aiming: out of reach says why and does nothing; an area that would catch you asks first, and the second Enter does it", async () => {
  const { model, moves } = lane();
  model.openActions();
  model.chooseAction(entriesOf(model.doMenu!.view).findIndex(e => e.key === "spell:sleep"));
  model.aimTo({ x: model.ex.at.x - 13, y: model.ex.at.y });
  assert.equal(model.aiming?.check?.why, "out of reach: 65 ft (it reaches 60 ft)");
  model.fire();
  await settle();
  assert.equal(moves.length, 0);

  // Next to you, Sleep's sphere has you in it.
  const beside = { x: model.ex.at.x + 1, y: model.ex.at.y };
  model.aimTo(beside);
  assert.ok(model.aiming?.check?.caught?.includes("you"));
  model.fire();
  assert.equal(model.aiming?.confirm, true, "asked first");
  await settle();
  assert.equal(moves.length, 0);
  model.fire();
  await settle();
  assert.deepEqual(moves.map(m => actionId(m)), [`cast_sleep@${beside.x},${beside.y}`]);
});

test("a right-click's Do something… with a catalogue: the menu aimed at that tile already; none without one", () => {
  const { model } = lane();
  const kell = FIXTURE_TOWN.aim(model.menuCtx(), "spell:fire-bolt")!.targets.find(t => /Kell/.test(t.name))!;
  model.openMenu(kell.at, 10, 5);
  const something = model.menu!.actions.findIndex(a => a.label === "Do something…");
  assert.ok(something >= 0);
  void model.chooseFromMenu(something);
  assert.equal(model.menu, undefined);
  assert.deepEqual(model.doMenu?.view.at, kell.at);
  assert.match(model.doMenu!.view.title, /^Do something: Sergeant/);
  const entries = entriesOf(model.doMenu!.view);
  assert.equal(entries.find(e => e.key === "spell:fire-bolt")?.id, `cast_fire-bolt@${kell.at.x},${kell.at.y}`);
  assert.match(entries.find(e => e.key === "shove")?.why ?? "", /^out of reach/);
  assert.equal(entries.find(e => e.key === "spell:sleep")?.aiming, true, "an area is aimed there first, not cast");

  const plain = lane({ view: { catalogue: undefined } }).model;
  plain.openMenu(kell.at, 10, 5);
  assert.ok(!plain.menu!.actions.some(a => a.label === "Do something…"), "no rules character, nothing to do");
  plain.openActions();
  assert.equal(plain.doMenu, undefined);
  assert.equal(plain.messages.at(-1), "There's no rules character here to do anything with.");
});

test("a refused act says the simulation's words in What happens; a spectator's m says whose map it is; the menu going wrong says so", async () => {
  const words = "(Short rest: not now, nothing to rest off: you're whole and fresh.)";
  const { model } = lane({ refuse: refusal("not_now", { text: words }) });
  await model.act("rest_short");
  assert.equal(model.messages.at(-1), words);

  const watched = lane({ view: { watching: "Pell Marrow" } }).model;
  watched.openActions();
  assert.equal(watched.doMenu, undefined);
  assert.equal(watched.messages.at(-1), "Pell Marrow has the lead: you're watching.");

  const broken: TownMenu = { ...FIXTURE_TOWN, menu: () => { throw new Error("not built: shared/map/menu.ts menuOf is package S's (town-design §2)"); } };
  const wrong = lane({ town: broken }).model;
  wrong.openActions();
  assert.equal(wrong.doMenu, undefined);
  assert.match(wrong.messages.at(-1) ?? "", /^\(The action menu went wrong: not built: shared\/map\/menu\.ts menuOf/);
});

test("a fight on the map: Enter's fight_it_out; none to fight, nothing sent", async () => {
  const fight = { map: "caerwyn", seed: 6, combatants: [{ id: "player", name: "Pell Marrow", side: "player" as const, at: { x: 42, y: 9 } }] };
  const { model, fought } = lane({ view: { fight } });
  assert.deepEqual(model.fight, fight);
  await model.fightItOut();
  assert.equal(fought(), 1);

  const calm = lane();
  await calm.model.fightItOut();
  assert.equal(calm.fought(), 0);
});

test("observe on the map: the menu as the QA console says it, and its acts among the ACTIONS", () => {
  const { model } = lane();
  const text = exploreText(model.view, FIXTURE_TOWN);
  assert.match(text, /\n\nWhat you can do \(the app's m; aimed ones take @x,y or _self\):\n {2}Cantrips:\n {4}Fire Bolt: 1d10 fire, 120 ft: sets things alight \[cast_fire-bolt@\d+,\d+/);
  assert.match(text, /\n {4}Shield: \+5 AC against a blow that would land \(not now: a reaction: only in a fight\)\n/);
  assert.match(text, /\n {4}Hide: slip out of sight: a Stealth check \(\+2\) \[hide\]\n/);
  assert.match(text, /\nACTIONS:\n(- .*\n)*- hide: Hide: slip out of sight: a Stealth check \(\+2\)\n/);
  assert.match(text, /\n- cast_fire-bolt@\d+,\d+: Fire Bolt at .* \(1d10 fire, 120 ft: sets things alight\)\n/);
  assert.doesNotMatch(text, /rest_short:/, "what can't be done isn't offered");

  const watching = exploreText({ ...model.view, watching: "Pell Marrow" }, FIXTURE_TOWN);
  assert.doesNotMatch(watching, /What you can do/, "a spectator's map: the lead's to act on");
});

test("headless on the demo's map: act --id hide hides (its Stealth line, then the map); a rest while whole is refused in the rules' sentence; the rules' acts are the dev stack's", async () => {
  const game = demoBackend({ ms: 1 });
  assert.equal(await game.newGame(newGameOf("Wren Ashdown: a hedge wizard", "wizard", "caerwyn")), undefined);
  assert.equal(game.explore()?.catalogue, WIZARD_CATALOGUE, "a wizard's sheet has the menu's catalogue");
  const capture = () => { const out = { printed: "", print: (t: string) => { out.printed += `${t}\n`; }, progress: () => {} }; return out; };

  const hid = capture();
  assert.equal(await verbs.act(game, "hide", hid), 0);
  assert.match(hid.printed, /^Stealth check to slip out of sight: 14 \+ 2 = 16 vs DC 10: success\nYou're out of sight\./);
  assert.match(hid.printed, /\nMODE: explore\n/);
  assert.equal(game.explore()?.ex.hidden, true);

  const rest = capture();
  assert.equal(await verbs.act(game, "rest_short", rest), 1);
  assert.equal(rest.printed, "(Short rest: not now, nothing to rest off: you're whole and fresh.)\n");

  const cast = capture();
  assert.equal(await verbs.act(game, "cast_fire-bolt@25,6", cast), 1);
  assert.match(cast.printed, /^\(The demo has no rules engine to play that on the town/);
});

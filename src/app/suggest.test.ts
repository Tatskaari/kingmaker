import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-suggest-app-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
process.env.KM_APP_STEP_MS = "0";
// A key shaped like OpenRouter's, so the game thinks it has a model: the fake answers in its place.
process.env.OPENROUTER_API_KEY = "sk-or-v1-suggest-app-test";
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
const { setBackgroundRunner } = await import("../runtime/background.ts");
const { sessionDir } = await import("../runtime/session.ts");
const { suggested } = await import("../runtime/suggest.ts");
const { Game: Core } = await import("../game/play.ts");
const { town } = await import("../game/town.ts");
const { mapFights } = await import("../game/fights.ts");
const { PREGENS } = await import("../game/combat/index.ts");
const { Game } = await import("./game.ts");

/**
 * A scene's suggested lines through the game core and the app, with a stand-in for OpenRouter: they
 * come after the opening and after each reply, as the core's say_1… choices (the QA console's
 * actions, the app's picks); choosing one says it; the setting turns them off and on, and is kept
 * with the game.
 */

setBackgroundRunner(() => {});

const GM = [
  "Prout turns slowly on the hoist rope. A woman in a rain cape looks up from her notebook. “Sergeant Kell. The Captain says suicide.”",
  "Kell taps her pencil against the notebook. “Porters, at first light.” A stone clangs off the hoist hook.",
  "Kell writes something down. “Noted.”",
];
const LINES = [
  "say: Sergeant, who found him?\ndo: (I look up at the body)\ntry: (I try to coax the boy down with a pie)",
  "say: Who barred the loft door, then?\ndo: (I pace out the yard under the hoist)\ntry: (I try to slip a coin to the girl on the wall)",
  "say: How long until the dead-cart?\ndo: (I study the shut loft door)\ntry: (I try to climb the water butt for a closer look)",
];

const saved = (id: string, file: string) => JSON.parse(readFileSync(join(sessionDir(id), file), "utf8"));

test("the lines come after the opening and each reply, as the core's say_1… choices; a choice says its line; the setting turns them off and on, kept with the game", async () => {
  const fake = fakeOpenRouter({ replies: GM, suggestions: LINES });
  try {
    const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor", level: 3, build: PREGENS.rogue!.build, explorer: town, fights: mapFights(), seed: 7 });
    const app = new Game();
    app.core = core;
    app.screen = "explore";
    for (let i = 0; i < 6 && core.state.mode === "explore"; i++) await app.act("go_to_lead");
    assert.equal(core.state.mode, "scene", "the walk to the lead opens its scene");
    // After the opening, a moment later: on screen as the app's choices, and the core's.
    await suggested(core.session);
    assert.deepEqual(app.choices.map(a => [a.id, a.label]), [["say_1", "Sergeant, who found him?"], ["say_2", "(I look up at the body)"], ["say_3", "(I try to coax the boy down with a pie)"]]);
    assert.deepEqual(app.suggestionKinds(), ["say", "do", "try"]);
    assert.ok(app.suggestionsExpected());
    assert.match(core.observe().hint ?? "", /or choose a suggested line/);
    // Choosing one says it (the QA console's act), and the next reply brings the next lines.
    await core.act("say_2");
    assert.equal(core.session.transcript.filter(e => e.kind === "player").at(-1)?.text, "(I look up at the body)");
    await core.suggested();
    assert.deepEqual(core.observe().actions.map(a => a.label), ["Who barred the loft door, then?", "(I pace out the yard under the hoist)", "(I try to slip a coin to the girl on the wall)"]);
    assert.equal(saved(core.state.id, "state.json").suggestions.turn, core.session.turn, "waited for and saved, for the QA console");
    // Off: from the Esc menu or /suggestions: none listed, none asked for, kept with the game.
    assert.ok(app.peek("/suggestions off"));
    assert.equal(core.suggestionsOn, false);
    assert.equal(saved(core.state.id, "game.json").settings.suggestions, false);
    assert.deepEqual(core.observe().actions, []);
    assert.ok(!app.suggestionsExpected());
    await core.say("Who found him, Sergeant?");
    await core.suggested();
    assert.deepEqual(core.observe().actions, []);
    assert.notEqual(core.session.suggestions?.turn, core.session.turn, "none asked for after the reply");
    assert.equal(Core.load(core.state.id, town, mapFights()).suggestionsOn, false, "off when the game's loaded again");
    // On again: this moment's lines are asked for at once.
    app.setSuggestions();
    assert.equal(core.suggestionsOn, true);
    await core.suggested();
    assert.equal(app.choices.length, 3);
  } finally {
    fake.restore();
  }
});

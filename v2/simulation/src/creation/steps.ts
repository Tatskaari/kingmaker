import type { Asked, CreationBusy, LoreIssue, Who } from "../../../shared/creation/types.ts";
import { STEP_ENDPOINT, STEP_TIMEOUT_MS, type AiRequestBase, type BackstoriesRequest, type BackstoriesResponse, type CharactersAsk, type CharactersRequest, type CharactersResponse } from "../../../shared/protocol/ai.ts";
import { creationKey, type CreationStep } from "../../../shared/protocol/keys.ts";
import { runMove, type TxCtx } from "../context.ts";
import type { AiCall, Move, Next } from "../moves/move.ts";
import { campaignFile, campaignVersion } from "../scenes.ts";
import { makeCharacter } from "./make.ts";
import { creationOwner } from "./owner.ts";
import { chosenOf, creationOf, json, moveOn, ownOf, planOf, rowAt, type CreationPlan, type CreationRow } from "./rows.ts";

/**
 * Character creation's AI steps (v1-design §3.5), one move whose job a creation's moves queue: the
 * three builds offered, the model's own pick, the player's own picks made legal, and the backstory's
 * draft, notes worked in, lore check and traits. Each step's request is built from the creation as
 * the move that asked for it left it; each commit moves the creation on (its rev bumped, so an older
 * answer is no longer wanted), and the check goes on to the traits, whose commit makes the game.
 */
export const creationSteps: Move<{ step: CreationStep }, CreationPlan> = {
  name: "creation",

  /** The step for the caller's creation as it stands. */
  resolve(tx, actor, { step }) {
    const row = creationOf(tx, actor.identity);
    if (!row) throw new Error("a creation step with no creation");
    return { done: false, plan: planOf(row, step) };
  },

  think: (tx, plan) => stepCall(tx, rowFor(tx, plan), plan.step),

  commit: (tx, plan, answer) => COMMITS[plan.step](tx, rowFor(tx, plan), answer),

  /** Read when the job loop asks, never at load: this file and the owner's import each other through the job loop. */
  get owner() {
    return creationOwner;
  },
};

/** What the GM is busy with while each step thinks (the busy column, which the screens show). */
const BUSY: Record<CreationStep, CreationBusy> = { offer: "builds", pick: "pick", own: "own", draft: "draft", work: "work", check: "check", traits: "traits" };

/** The GM asked for a step: the creation moved on with the changes, busy with the step, and the step's job queued in the same transaction. */
export function ask(tx: TxCtx, row: CreationRow, step: CreationStep, changes: Partial<CreationRow> = {}): CreationRow {
  const asking = moveOn(tx, row, { ...changes, busy: BUSY[step] });
  runMove(tx, creationSteps, { identity: row.identity }, { step });
  return asking;
}

// ---------------------------------------------------------------------------------------------
// The requests.

function stepCall(tx: TxCtx, row: CreationRow, step: CreationStep): AiCall {
  const key = creationKey(row.uid, row.rev, step);
  const base: AiRequestBase = { key, game: { id: row.uid, campaign: row.campaign, version: row.campaignVersion } };
  return { endpoint: STEP_ENDPOINT[step], key, timeoutMs: STEP_TIMEOUT_MS[step], request: requestFor(tx, row, step, base) };
}

function requestFor(tx: TxCtx, row: CreationRow, step: CreationStep, base: AiRequestBase): CharactersRequest | BackstoriesRequest {
  if (step === "offer") return characters(tx, row, base, { kind: "three" });
  if (step === "pick") return characters(tx, row, base, { kind: "one" });
  if (step === "own") return characters(tx, row, base, { kind: "own", picks: needs(ownOf(row), "own picks").picks });
  return { ...base, op: step, who: whoOf(row), text: step === "draft" ? "" : row.story };
}

/** POST /v1/characters: who they are, the level the campaign starts them at, and what's asked. */
function characters(tx: TxCtx, row: CreationRow, base: AiRequestBase, ask: CharactersAsk): CharactersRequest {
  const level = campaignFile(campaignVersion(tx, row.campaign, row.campaignVersion)).level;
  return { ...base, who: { name: row.name, concept: row.concept }, level, ask };
}

/** Who the backstory is for, as the model is told (game.ts:614): their name, concept, and the build chosen in a line. */
function whoOf(row: CreationRow): Who {
  const chosen = chosenOf(row);
  return { name: row.name, concept: row.concept, ...(chosen ? { build: chosen.line } : {}) };
}

// ---------------------------------------------------------------------------------------------
// The commits: each the prototype's after its await (game.ts:487-823).

type Commit = (tx: TxCtx, row: CreationRow, answer: unknown) => Next<CreationPlan>;

const COMMITS: Record<CreationStep, Commit> = {
  /** The three builds: on the choose screen. */
  offer: (tx, row, answer) => done(moveOn(tx, row, { offer: json(needs(characterAnswer(answer).offer, "offer")), busy: undefined })),
  /** The model's pick: chosen, on to the backstory. */
  pick: (tx, row, answer) => done(moveOn(tx, row, { chosen: json(needs(characterAnswer(answer).option, "option")), step: "backstory", busy: undefined })),
  own: (tx, row, answer) => done(ownMade(tx, row, characterAnswer(answer))),
  draft: (tx, row, answer) => done(proposed(tx, row, "draft", needs(backstoryAnswer(answer).asked, "asked"))),
  work: (tx, row, answer) => done(proposed(tx, row, "work", needs(backstoryAnswer(answer).asked, "asked"))),
  check: (tx, row, answer) => checked(tx, row, needs(backstoryAnswer(answer).checked, "checked")),
  /** What the backstory says of them: then the game is made, in this commit. */
  traits: (tx, row, answer) => {
    makeCharacter(tx, row, needs(backstoryAnswer(answer).backstory, "backstory"));
    return { done: true };
  },
};

/** The player's own build as the engine made it, or why it couldn't (game.ts:578-585); the lists to pick from, kept from the first answer. */
function ownMade(tx: TxCtx, row: CreationRow, answer: CharactersResponse): CreationRow {
  const own = needs(ownOf(row), "own picks");
  const lists = own.lists ?? answer.lists;
  if (answer.refusal) {
    return moveOn(tx, row, { own: json({ picks: own.picks, ...(lists ? { lists } : {}) }), note: `The rules engine couldn't make that one: ${answer.refusal}`, busy: undefined });
  }
  const option = needs(answer.option, "option");
  return moveOn(tx, row, { own: json({ picks: own.picks, option, ...(lists ? { lists } : {}) }), note: undefined, busy: undefined });
}

/** A draft, or the notes worked in, shown to take or leave; or why there's none (draftStory, workInStory). */
function proposed(tx: TxCtx, row: CreationRow, kind: "draft" | "work", asked: Asked<string>): CreationRow {
  return moveOn(tx, row, asked.ok ? { proposal: json({ kind, text: asked.value }), busy: undefined } : { note: asked.why, busy: undefined });
}

/**
 * What the lore check found (checkStory, game.ts:697-722): each issue to accept or rewrite, one at a
 * time; or, when it fits (or nobody could check it, which the sheet then says), on to the traits.
 */
function checked(tx: TxCtx, row: CreationRow, checked: Asked<LoreIssue[]>): Next<CreationPlan> {
  if (checked.ok && checked.value.length) return done(moveOn(tx, row, { issues: json(checked.value), issue: 0, busy: undefined }));

  const unchecked = checked.ok ? undefined : uncheckedWords(row.again, checked.reason ?? checked.why);
  const next = moveOn(tx, row, { unchecked, busy: BUSY.traits });
  return { done: false, plan: planOf(next, "traits") };
}

/** Why the backstory went in without the lore check, as the sheet says it over the backstory. */
const uncheckedWords = (again: boolean, reason: string) =>
  again ? `Your backstory went in with the fixes you took, but nobody checked them again: ${reason}.` : `Your backstory went in as you wrote it, without the lore check: ${reason}.`;

// ---------------------------------------------------------------------------------------------

/** The row a plan's step is for: the job loop has already checked that it's still at the plan's rev. */
function rowFor(tx: TxCtx, plan: CreationPlan): CreationRow {
  const row = rowAt(tx, plan);
  if (!row) throw new Error(`creation ${plan.uid} isn't at rev ${plan.rev}`);
  return row;
}

/** A commit that has moved the creation on, with nothing more to ask. */
const done = (_moved: CreationRow): Next<CreationPlan> => ({ done: true });

const characterAnswer = (answer: unknown) => (answer ?? {}) as CharactersResponse;
const backstoryAnswer = (answer: unknown) => (answer ?? {}) as BackstoriesResponse;

function needs<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`the answer has no ${what}`);
  return value;
}

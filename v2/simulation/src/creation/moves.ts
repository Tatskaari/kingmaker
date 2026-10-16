import type { Identity } from "spacetimedb";
import { applyFix, tooLong, wordCount } from "../../../shared/creation/story.ts";
import type { CreationHow, CreationStage, LoreIssue } from "../../../shared/creation/types.ts";
import { MAX_STORY, refusal } from "../../../shared/protocol/refusals.ts";
import { picksOf } from "../../../shared/rules/index.ts";
import type { BuildOption, OwnPicks, SrdLists } from "../../../shared/rules/types.ts";
import { Refused, type TxCtx } from "../context.ts";
import { deleteGameRows } from "../games/delete.ts";
import { characterConcept, characterName, newUid } from "../games/create.ts";
import type { CampaignRow } from "../rows.ts";
import { campaignFile, campaignNamed, campaignVersion } from "../scenes.ts";
import { makeCharacter } from "./make.ts";
import { chosenOf, creating, creationOf, issuesOf, json, moveOn, offerOf, ownOf, proposalOf, touch, type CreationRow } from "./rows.ts";
import { ask } from "./steps.ts";

/**
 * Character creation's moves (v1-design §3.3), one a method of the prototype's creation
 * (src/app/game.ts:487-823), each on the caller's own `creation` row: from a name and a concept,
 * through the builds and the backstory, to the game made from them. A move bumps the row's rev (but
 * set_backstory, the box's text as it's typed), so an answer asked for before it no longer lands;
 * the GM's part is a job of the creation's (creation/steps.ts). No move works on a creation that's
 * made but choose_again, which puts the made game away.
 */

/** "own:<species>,<class>,<subclass>,<background>": the QA console's own build (src/cli/qa.ts:123), the subclass optional. */
const OWN = /^own:([\w-]+),([\w-]+),([\w-]*),([\w-]+)$/;

/** Where each way of choosing a build starts, and what the GM does first. */
const START: Record<CreationHow, { step: CreationStage; ask: "offer" | "pick" | "own" }> = {
  three: { step: "choose", ask: "offer" },
  model: { step: "backstory", ask: "pick" },
  own: { step: "custom", ask: "own" },
};

/** The word for a draft taken (game.ts:675). */
const TAKEN = "It's yours now: change anything you like.";

/** Off to the backstory screen: whatever the last one showed is gone (toBackstory, game.ts:600). */
const TO_BACKSTORY = { step: "backstory", proposal: undefined, issues: undefined, issue: 0, note: undefined, rewriting: undefined } as const;

/**
 * A name and a concept to make a character from (offerBuilds, game.ts:500), in place of any the
 * caller was making, the backstory written so far kept. The same name and concept as one already
 * offered builds go back to those (nothing asked); otherwise by how: three builds offered, the model
 * picks one, or the player's own picks made.
 */
export function startCreationReducer(tx: TxCtx, sender: Identity, args: { campaign: string; name: string; concept: string; how: string }): void {
  const campaign = campaignNamed(tx, args.campaign);
  const name = characterName(args.name.replace(/:/g, " "));
  const concept = characterConcept(args.concept);
  const how = howOf(args.how);
  const was = creationOf(tx, sender);

  if (how.kind === "three" && was && sameOffer(was, campaign, name, concept)) {
    moveOn(tx, was, { step: "choose", busy: undefined, proposal: undefined, issues: undefined, issue: 0, note: undefined, rewriting: undefined });
    return;
  }

  const row = newCreation(tx, sender, campaign, { name, concept }, how, was);
  ask(tx, row, START[how.kind].ask);
}

/** Back a screen (backToConcept, backToBuilds): from the builds to the concept; from their own build or the backstory to the builds (or the concept, with none offered). What the GM was doing is let go; the box's text is kept when given. */
export function creationBackReducer(tx: TxCtx, sender: Identity, { story }: { story?: string }): void {
  const row = creating(tx, sender);
  if (story !== undefined) fitsTheBox(story);

  moveOn(tx, row, { step: backFrom(row), busy: undefined, proposal: undefined, issues: undefined, issue: 0, note: undefined, rewriting: undefined, ...(story !== undefined ? { story } : {}) });
}

/** One of the three builds: on to the backstory (chooseBuild, game.ts:529). */
export function chooseBuildReducer(tx: TxCtx, sender: Identity, { index }: { index: number }): void {
  const row = idle(creating(tx, sender));
  const option = offerOf(row)?.options[index];
  if (!option) throw new Refused(refusal("not_offered"));

  moveOn(tx, row, { chosen: json(option), ...TO_BACKSTORY });
}

/** "Make my own" (makeOwn, game.ts:547): their own picks so far, or the card they were looking at's, made by the engine. */
export function makeOwnReducer(tx: TxCtx, sender: Identity, { from }: { from: number }): void {
  const row = idle(creating(tx, sender));
  const options = offerOf(row)?.options ?? [];
  const card = options[from < 3 ? from : 0] ?? options[0];
  if (!card) throw new Refused(refusal("not_offered"));

  const own = ownOf(row);
  ask(tx, row, "own", { step: "custom", own: json({ ...own, picks: own?.picks ?? picksOf(card.build) }), note: undefined });
}

/** A pick of their own (pickOwn, game.ts:567): the class's subclass kept or its first, and the card it comes to made (the latest pick wins). */
export function pickOwnReducer(tx: TxCtx, sender: Identity, args: OwnPicks): void {
  const row = creating(tx, sender);
  if (row.busy && row.busy !== "own") throw new Refused(refusal("creation_busy"));
  const own = ownOf(row);
  if (!own) throw new Refused(refusal("not_now"));

  const picks = withSubclass(args, own.lists, levelOf(tx, row));
  ask(tx, row, "own", { step: "custom", own: json({ ...own, picks }), note: undefined });
}

/** The build of their own making: on to the backstory (takeOwn, game.ts:596). */
export function takeOwnReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = creating(tx, sender);
  if (row.busy === "own") throw new Refused(refusal("still_making"));
  const option = ownOf(idle(row))?.option;
  if (!option) throw new Refused(refusal("not_now"));

  moveOn(tx, row, { chosen: json(option), ...TO_BACKSTORY });
}

/** The box's text as it's typed (storyTyped): nothing in flight is let go. */
export function setBackstoryReducer(tx: TxCtx, sender: Identity, { text }: { text: string }): void {
  const row = creating(tx, sender);
  fitsTheBox(text);
  if (text !== row.story) touch(tx, row, { story: text });
}

/** "Draft one" (draftStory, game.ts:621): a backstory from who they are, shown to take or leave. */
export function draftBackstoryReducer(tx: TxCtx, sender: Identity, { text }: { text: string }): void {
  const row = idle(creating(tx, sender));
  fitsTheBox(text);
  ask(tx, row, "draft", { story: text, note: undefined });
}

/** "Work it in" (workInStory, game.ts:638): the box's notes as a story in their voice, shown to take or leave. */
export function workInBackstoryReducer(tx: TxCtx, sender: Identity, { text }: { text: string }): void {
  const row = idle(creating(tx, sender));
  fitsTheBox(text);
  if (!text.trim()) throw new Refused(refusal("nothing_to_work_in"));
  notTooLong(text);
  ask(tx, row, "work", { story: text, note: undefined });
}

/** The draft (or the notes worked in) taken: the box has it now (takeProposal, game.ts:670). */
export function takeProposalReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = creating(tx, sender);
  const proposal = proposalOf(row);
  if (!proposal) throw new Refused(refusal("not_now"));
  moveOn(tx, row, { story: proposal.text, version: row.version + 1, proposal: undefined, note: TAKEN });
}

/** The draft left: the box as it was (leaveProposal, game.ts:680). */
export function leaveProposalReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = creating(tx, sender);
  if (!row.proposal) throw new Refused(refusal("not_now"));
  moveOn(tx, row, { proposal: undefined });
}

/**
 * Done with the backstory (finishStory, game.ts:692): checked against the world's lore, what doesn't
 * fit to come up a fix at a time. Nothing written is the same as skipping: the game is made now.
 */
export function finishBackstoryReducer(tx: TxCtx, sender: Identity, { text }: { text: string }): void {
  const row = idle(creating(tx, sender));
  fitsTheBox(text);
  notTooLong(text);
  built(row);

  const settled = { story: text, rewriting: undefined, again: false, issues: undefined, issue: 0, note: undefined };
  if (!text.trim()) return makeCharacter(tx, moveOn(tx, row, { ...settled, unchecked: undefined }));
  ask(tx, row, "check", settled);
}

/**
 * The issue on show, fixed as the check suggests (acceptFix, game.ts:729): the next issue; after the
 * last, the story with the fixes in checked once more, then (not a third time) on to the traits. A
 * quote that's no longer in the story is theirs to rewrite instead.
 */
export function acceptFixReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = idle(creating(tx, sender));
  const issues = issuesOf(row) ?? [];
  const issue = issues[row.issue];
  if (!issue) throw new Refused(refusal("not_now"));

  const fixed = applyFix(row.story, issue);
  if (fixed === undefined) rewrite(tx, row, issue);
  else if (row.issue + 1 < issues.length) moveOn(tx, row, { story: fixed, version: row.version + 1, issue: row.issue + 1 });
  else afterTheFixes(tx, row, { story: fixed, version: row.version + 1, issues: undefined, issue: 0 });
}

/** The issue on show, to rewrite themselves: it stays over the box while they do, and Done checks it again (rewriteIssue, game.ts:747). */
export function rewriteIssueReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = creating(tx, sender);
  const issue = issuesOf(row)?.[row.issue];
  if (!issue) throw new Refused(refusal("not_now"));
  rewrite(tx, row, issue);
}

/** No backstory: straight into the game (skipStory, game.ts:756). */
export function skipBackstoryReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = idle(creating(tx, sender));
  built(row);
  makeCharacter(tx, moveOn(tx, row, { story: "", version: row.version + 1, unchecked: undefined, proposal: undefined, issues: undefined, issue: 0, rewriting: undefined, note: undefined }));
}

/**
 * Not who they meant, from the sheet (chooseAgain, game.ts:811): the game made from it put away,
 * every row of it, and back to the three builds with the backstory kept (or the concept, with none
 * offered).
 */
export function chooseAgainReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const row = creationOf(tx, sender);
  if (!row) throw new Refused(refusal("not_creating"));
  if (row.step !== "made" || row.gameId === undefined) throw new Refused(refusal("not_now"));

  const made = tx.db.game.id.find(row.gameId);
  moveOn(tx, row, { step: row.offer ? "choose" : "concept", gameId: undefined, backstory: undefined, busy: undefined, proposal: undefined, issues: undefined, issue: 0, note: undefined, rewriting: undefined });
  if (made) deleteGameRows(tx, made);
}

// ---------------------------------------------------------------------------------------------
// startCreation's parts.

type How = { kind: "three" } | { kind: "model" } | { kind: "own"; picks: OwnPicks };

function howOf(how: string): How {
  if (how === "three" || how === "model") return { kind: how };
  const own = OWN.exec(how.trim());
  if (!own) throw new Refused(refusal("bad_how"));
  return { kind: "own", picks: { speciesId: own[1]!, classId: own[2]!, ...(own[3] ? { subclassId: own[3] } : {}), backgroundId: own[4]! } };
}

/** The same name and concept, for the same campaign, as builds already offered (and not yet made into a game): those again. */
const sameOffer = (was: CreationRow, campaign: CampaignRow, name: string, concept: string) =>
  was.step !== "made" && !!was.offer && was.name === name && was.concept === concept && was.campaign === campaign.key && was.campaignVersion === campaign.version;

/** A creation afresh, in place of the caller's last: a new uid (the game made from it takes it), and the backstory they'd written kept. */
function newCreation(tx: TxCtx, sender: Identity, campaign: CampaignRow, who: { name: string; concept: string }, how: How, was: CreationRow | undefined): CreationRow {
  const file = campaignFile(campaign);
  const row: CreationRow = {
    identity: sender, uid: newUid(tx), campaign: file.id, campaignVersion: file.version, name: who.name, concept: who.concept,
    how: how.kind, step: START[how.kind].step, busy: undefined, rev: (was?.rev ?? 0) + 1,
    offer: undefined, own: how.kind === "own" ? json({ picks: how.picks }) : undefined, chosen: undefined,
    story: was?.story ?? "", version: (was?.version ?? 0) + 1, proposal: undefined, issues: undefined, issue: 0, rewriting: undefined,
    again: false, note: undefined, unchecked: undefined, backstory: undefined, gameId: undefined, calls: 0, costMicros: 0n, updatedAt: tx.now,
  };
  return was ? tx.db.creation.identity.update(row) : tx.db.creation.insert(row);
}

// ---------------------------------------------------------------------------------------------
// The other moves' parts.

/** Where back goes from each step. */
function backFrom(row: CreationRow): CreationStage {
  if (row.step === "custom" || row.step === "backstory") return row.offer ? "choose" : "concept";
  return "concept";
}

/** The GM isn't working on it: a move that would start or end something else waits (creation_busy). */
function idle(row: CreationRow): CreationRow {
  if (row.busy) throw new Refused(refusal("creation_busy"));
  return row;
}

/** A build chosen, which the game is made from: the backstory's way into the game needs one. */
function built(row: CreationRow): BuildOption {
  const chosen = chosenOf(row);
  if (!chosen) throw new Refused(refusal("not_now"));
  return chosen;
}

/** No more than the box keeps. */
function fitsTheBox(text: string): void {
  if (text.length > MAX_STORY) throw new Refused(refusal("story_too_big"));
}

/** No longer than the GM can be given every turn (tooLong's words). */
function notTooLong(text: string): void {
  if (tooLong(text)) throw new Refused(refusal("story_too_long", { words: String(wordCount(text)) }));
}

function rewrite(tx: TxCtx, row: CreationRow, issue: LoreIssue): CreationRow {
  return moveOn(tx, row, { rewriting: json(issue), issues: undefined, issue: 0 });
}

/** Every fix in: checked once more the first time; the second, on to the traits (or, with nothing left of the story, into the game). */
function afterTheFixes(tx: TxCtx, row: CreationRow, allIn: Partial<CreationRow> & { story: string }): void {
  if (!row.again) ask(tx, row, "check", { ...allIn, again: true, note: undefined });
  else if (allIn.story.trim()) ask(tx, row, "traits", allIn);
  else makeCharacter(tx, moveOn(tx, row, allIn));
}

/** A class's subclass where the level has one: the one picked, if it's the class's, else its first (game.ts:573-576). Without the lists yet, the picks as they are. */
function withSubclass(picks: OwnPicks, lists: SrdLists | undefined, level: number): OwnPicks {
  const base = { speciesId: picks.speciesId, classId: picks.classId, backgroundId: picks.backgroundId };
  if (!lists) return { ...base, ...(picks.subclassId ? { subclassId: picks.subclassId } : {}) };
  const subs = lists.subclasses[picks.classId] ?? [];
  const subclassId = level >= (lists.subclassLevel[picks.classId] ?? 3) ? (subs.some(s => s.id === picks.subclassId) ? picks.subclassId : subs[0]?.id) : undefined;
  return { ...base, ...(subclassId ? { subclassId } : {}) };
}

/** The level the campaign makes characters at. */
const levelOf = (tx: TxCtx, row: CreationRow) => campaignFile(campaignVersion(tx, row.campaign, row.campaignVersion)).level;

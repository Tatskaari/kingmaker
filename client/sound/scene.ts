// New: a scene as it's heard (docs/sound-design.md): its chime as it opens; the GM's reply said as it streams in, the narration in the narrator's tick and each person's lines in their own voice (the markup says whose); a talk's lines as they come; the dice as they're rolled, and how a check went; its close as it ends. It follows the scene's view, a change at a time, and keeps nothing the screen doesn't.
import type { Markup } from "../../shared/markup.ts";
import { isPlayer, isRoll, type Entry, type SceneView } from "../scene/view.ts";
import { sfx } from "./cues.ts";
import type { Voice } from "./patches.ts";
import { Talker } from "./talker.ts";
import { NARRATOR, PLAYER, VOICES, Voices, type Speaker } from "./voices.ts";

/** How long after the dice a check's outcome sounds (ms): once they've settled. */
const SETTLED = 480;

export class SceneSound {
  private readonly talker: Talker;
  private readonly voices: Voices;
  /** The scene heard last (its id and title), how many of its entries have been heard, whether it was over. */
  private scene: string | undefined;
  private heard = 0;
  private over = false;
  /** The reply being said as it streams: its turn and attempt, and its words so far. */
  private reply: { key: string; text: string } | undefined;

  constructor(voices = new Voices(), talker = new Talker("talk")) {
    this.voices = voices;
    this.talker = talker;
  }

  /** The scene's view, as it is now. */
  hear(view: SceneView): void {
    const scene = `${view.sceneId ?? ""}:${view.title}`;
    if (scene !== this.scene) {
      // Another scene: its chime (the entries it has are where it stands, not news), and the last one's talk stops.
      this.scene = scene;
      this.heard = view.entries.length;
      this.reply = undefined;
      this.over = view.over;
      this.talker.quiet();
      if (!view.over && !view.talk) sfx("story.scene");
      return;
    }
    if (view.draft) this.streaming(view);
    const fresh = view.entries.slice(this.heard);
    this.heard = view.entries.length;
    if (fresh.length) this.entries(view, fresh);
    if (view.over && !this.over) sfx("story.ended");
    this.over = view.over;
  }

  /** The player said something: whatever's still being said stops. */
  spoke(): void {
    this.talker.quiet();
  }

  /** The reply streaming in: what's new of it said; another try at it starts again. */
  private streaming(view: SceneView): void {
    const draft = view.draft!;
    const key = `${view.turn ?? ""}:${draft.attempt}`;
    if (this.reply?.key !== key) {
      if (this.reply) this.talker.quiet();
      this.reply = { key, text: "" };
    }
    const said = this.reply.text;
    if (draft.text.length <= said.length || !draft.text.startsWith(said)) {
      this.reply.text = draft.text;
      return;
    }
    this.talker.speak(draft.text, this.voiceAt(view, draft.kind === "dialogue" ? draft.speaker : undefined, draft.markup), said.length);
    this.reply.text = draft.text;
  }

  /** Entries new since the last view: lines said (the rest of a reply heard streaming), the dice rolled. */
  private entries(view: SceneView, fresh: Entry[]): void {
    const rolls = fresh.filter(e => e.kind === "roll" && isRoll(e.text));
    if (rolls.length) this.dice(rolls);
    for (const e of fresh) {
      if (e.kind === "player" && isPlayer(e.speaker)) { this.talker.quiet(); this.reply = undefined; continue; }
      if (e.kind !== "narration" && e.kind !== "dialogue") continue;
      const streamed = this.reply && e.text.startsWith(this.reply.text) ? this.reply.text.length : 0;
      if (streamed < e.text.length) this.talker.speak(e.text, this.voiceAt(view, e.kind === "dialogue" ? e.speaker : undefined, e.markup), streamed);
      this.reply = undefined;
    }
  }

  /** The dice: a roll's rattle, and once they've settled, how a check went (a natural 20 or 1 its own). */
  private dice(rolls: Entry[]): void {
    sfx("dice.roll", { count: Math.min(3, rolls.length) });
    const said = rolls.map(r => r.text).join("\n");
    const outcome = /natural 20|critical hit/i.test(said) ? "dice.crit"
      : /natural 1\b/i.test(said) ? "dice.fumble"
      : /\bcheck\b[^\n]*vs DC \d+: success/i.test(said) ? "dice.success"
      : /\bcheck\b[^\n]*vs DC \d+: failure/i.test(said) ? "dice.failure"
      : undefined;
    if (outcome) sfx(outcome, {}, { delay: SETTLED });
  }

  /**
   * Whose voice says the letter at `i`: a dialogue line's speaker's, all through; in narration, the
   * speaker of the spoken line it's in (the markup's), the narrator's between them.
   */
  private voiceAt(view: SceneView, speaker: string | undefined, markup: Markup | undefined): (i: number) => Voice | undefined {
    if (speaker) {
      const voice = this.voiceOf(view, speaker);
      return () => voice;
    }
    const lines = markup?.speech ?? [];
    return i => {
      const line = lines.find(s => s.start <= i && i < s.end);
      if (!line) return NARRATOR;
      return line.speaker ? this.voiceOf(view, line.speaker) : this.voices.of({ key: `voice:${line.tag ?? "someone"}`, ...(line.tag ? { called: line.tag } : {}) });
    };
  }

  /** A speaker's voice, from what the scene knows of them: who's here, the place's world, what the player calls them. */
  private voiceOf(view: SceneView, key: string): Voice {
    if (isPlayer(key)) return PLAYER;
    const entity = view.place?.world.entities[key];
    const who: Speaker = {
      key,
      name: view.present.find(p => p.key === key)?.name ?? entity?.name,
      kind: entity?.kind,
      size: entity?.size,
      tags: entity?.tags,
      description: entity?.description,
      called: view.place?.unnamed[key],
    };
    return this.voices.of(who);
  }
}

/** The talk between scenes' own: its lines come a beat apart, each said as it comes. */
const between = new Talker("talk");

/** A line of the talk between scenes, said as it comes on screen: a person's in their voice, narration in the narrator's. */
export function sayLine(line: { kind: string; speaker: string; name?: string | undefined; text: string }): void {
  const voice = line.kind === "dialogue" ? (isPlayer(line.speaker) ? PLAYER : VOICES.of({ key: line.speaker, name: line.name })) : line.kind === "narration" ? NARRATOR : undefined;
  if (voice) between.speak(line.text, () => voice);
}

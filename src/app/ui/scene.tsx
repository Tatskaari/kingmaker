import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import type { Action } from "../../game/play.ts";
import { presentCast } from "../../runtime/brief.ts";
import { sceneById } from "../../../scenes/index.ts";
import { COMMANDS, commandNamed, type Game, type Line, type Over } from "../game.ts";
import { TIME_WORDS } from "../story.ts";
import { C, personColor } from "../theme.ts";
import { BOLD, Clickable, ITALIC, Keys, SCROLLBAR, Spinner, useGame, wayOnKey, wrap, type KeyHint } from "./common.tsx";
import { Place } from "./place.tsx";

/** The edge of a turn gone by; the latest has the panels' own. */
const EDGE = "#302b39";
/** The rules' word on what changed without a roll (what you carry, what's burning): not the dice's yellow. */
const INFO = "#7cc6b4";
/** The marks in a rules line's margin: the dice for a roll, an i in a ring for news (one column wide; the die has always taken two). */
const MARK = { roll: "🎲", info: "ⓘ" } as const;

/** One piece of the conversation: the scene's heading, a turn, or a line between turns (how it ended, a fight's result). */
type Part = { kind: "header"; line: Line } | { kind: "rule"; line: Line } | { kind: "turn"; lines: Line[] };

/**
 * The conversation a turn at a time: what was set before the player spoke, then each thing they said
 * or did with everything that answered it. The system's lines (how a scene ended, how a fight went)
 * sit between turns.
 */
export function partsOf(lines: Line[]): Part[] {
  const parts: Part[] = [];
  let turn: Line[] | undefined;
  for (const line of lines) {
    if (line.kind === "header") { parts.push({ kind: "header", line }); turn = undefined; }
    else if (line.kind === "system") { parts.push({ kind: "rule", line }); turn = undefined; }
    else if (line.kind === "player" || !turn) { turn = [line]; parts.push({ kind: "turn", lines: turn }); }
    else turn.push(line);
  }
  return parts;
}

/** The conversation, in turns: each exchange in its own box, the latest the brightest; `live` is the reply streaming in. */
export function Transcript({ lines, live }: { lines: Line[]; live?: Line | undefined }) {
  const parts = partsOf(live ? [...lines, live] : lines);
  const last = parts.findLastIndex(p => p.kind === "turn");
  return <box flexDirection="column" flexShrink={0}>
    {parts.map((part, i) => part.kind === "header"
      ? <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
        <text fg={C.title} attributes={BOLD}>{`— ${part.line.name} —`}</text>
        <text fg={C.dim} attributes={ITALIC} wrapMode="word">{part.line.text}</text>
      </box>
      : part.kind === "rule" ? <Rule key={i} line={part.line} />
      : <Turn key={i} lines={part.lines} latest={i === last} live={live} />)}
  </box>;
}

/** A line between turns: how the scene ended as a rule across, the rest (a fight's result, a level gained) as a note. */
function Rule({ line }: { line: Line }) {
  const ending = /^Scene ends: (.+)$/.exec(line.text)?.[1];
  if (ending) return <text flexShrink={0} marginBottom={1} textAlign="center" wrapMode="word">
    <span fg={C.border}>{"──────── "}</span><span fg={C.system} attributes={ITALIC}>{ending}</span><span fg={C.border}>{" ────────"}</span>
  </text>;
  return <text marginBottom={1} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
}

/** About how many rows a conversation takes at a width (for a panel sized to fit it): its turns, their borders, the gaps. */
export function transcriptRows(lines: Line[], width: number): number {
  const inner = width - 4;
  return partsOf(lines).reduce((n, part) => {
    if (part.kind !== "turn") return n + 1 + (part.kind === "header" ? 1 + wrap(part.line.text, width).length : 0);
    const rows = part.lines.map((l, i) => (i ? 1 : 0) + wrap(l.kind === "dialogue" ? `${l.name ?? l.speaker}: ${l.text}` : l.text, l.kind === "player" || isMarked(l) ? inner - 3 : inner).length);
    return n + 2 + rows.reduce((a, b) => a + b, 0);
  }, 0);
}

/** One exchange: the player's line (under their name, with a bar down its side), then all that answered it. */
function Turn({ lines, latest, live }: { lines: Line[]; latest: boolean; live?: Line | undefined }) {
  const said = lines[0]?.kind === "player" ? lines[0] : undefined;
  const answer = said ? lines.slice(1) : lines;
  return <box border borderStyle="rounded" borderColor={latest ? C.border : EDGE} paddingX={1} flexDirection="column" flexShrink={0}
    {...(said ? { title: ` ${said.name ?? "You"} `, titleAlignment: "left" as const, titleColor: C.player } : {})}>
    {said ? <box border={["left"]} borderStyle="heavy" borderColor={C.player} paddingLeft={1} flexShrink={0}>
      <text fg={C.player} wrapMode="word">{said.text}</text>
    </box> : null}
    {answer.map((line, i) => {
      const prev = i ? answer[i - 1] : said;
      // The rules' lines come in bursts: no gap between them.
      const close = !!prev && isMarked(prev) && isMarked(line);
      return <Entry key={i} line={line} live={line === live} gap={prev && !close ? 1 : 0} />;
    })}
  </box>;
}

const isMarked = (line: Line) => line.kind === "roll" || line.kind === "info";

function Entry({ line, live, gap }: { line: Line; live?: boolean; gap: number }) {
  const cursor = live ? <span fg={C.title}>▍</span> : null;
  switch (line.kind) {
    case "player":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.player}>{line.text}</text>;
    case "dialogue":
      return <text marginTop={gap} wrapMode="word" flexShrink={0}><span fg={personColor(line.speaker) ?? C.name} attributes={BOLD}>{`${line.name ?? line.speaker}: `}</span><span fg={C.gm}>{line.text}</span>{cursor}</text>;
    case "roll": case "info": {
      // The mark in its own margin, so a long line wraps under its words, not under the mark.
      const color = line.kind === "roll" ? C.dice : INFO;
      return <box marginTop={gap} flexDirection="row" flexShrink={0}>
        <text width={3} flexShrink={0} fg={color}>{MARK[line.kind]}</text>
        <text flexGrow={1} flexShrink={1} wrapMode="word" fg={color}>{line.text}</text>
      </box>;
    }
    case "error":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.danger}>{line.text}</text>;
    case "system":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
    default:
      return <text marginTop={gap} wrapMode="word" flexShrink={0}><span fg={C.gm}>{line.text}</span>{cursor}</text>;
  }
}

/** Something to pick above the box: one of the core's choices (a line to say, or walking on), or a command being typed. */
interface Pick { key: string; label: string; color: string; run: () => void }

/** A choice that ends a talk (its goodbye, walking on): always listed, however short the screen. */
const wayOut = (a: Action) => a.kind !== "say" || a.id === "say_goodbye";

/**
 * The core's choices that fit in `room` rows, in its order (a talk's lines, then its goodbye, then
 * walking on): the lines to say first give way, never the ways out; nine at most, one a number key.
 */
export function fitChoices(all: Action[], room: number): Action[] {
  const ways = all.filter(wayOut);
  const keep = new Set([...all.filter(a => !wayOut(a)).slice(0, Math.max(0, room - ways.length)), ...ways]);
  return all.filter(a => keep.has(a)).slice(0, 9);
}

function Picks({ picks, width }: { picks: Pick[]; width: number }) {
  return <box flexDirection="column" paddingX={1} flexShrink={0}>
    {picks.map((p, i) => <Clickable key={i} height={1} flexShrink={0} onClick={p.run}>
      <text flexShrink={0}>
        <span fg={C.title}>{`${p.key} `}</span>
        <span fg={p.color}>{truncate(p.label, Math.max(8, width - p.key.length - 4))}</span>
      </text>
    </Clickable>)}
  </box>;
}

/** Where Continue goes from a scene that's over, in words, and whether it can go yet. */
function onward(game: Game, over: Over): { title: string; go: string; ready: boolean; fight?: boolean } {
  const core = game.core;
  const mode = core?.state.mode;
  const title = over.ending ?? "The scene is over";
  // A summons's next scene can be watched coming in before the story has quite finished with the last.
  if (mode === "scene" && core && core.session.sceneId !== game.shownScene) return { title, go: `On to ${sceneById(core.session.sceneId).title}`, ready: true };
  if (!over.ready) return { title, go: over.queued ? "Going on as soon as the story's ready" : "Continue, once the story has moved on", ready: false };
  if (mode === "scene" && core?.session.ended) return { title, go: "The story got stuck on the way: try again", ready: true };
  if (mode === "combat") return { title: "Roll for initiative!", go: "To the fight", ready: true, fight: true };
  if (mode === "end") return { title, go: "The End", ready: true };
  const friend = game.card?.talk?.find(l => l.kind === "dialogue")?.name;
  return { title, go: friend ? `On, with ${friend}` : "Back to the map", ready: true };
}

/** In place of the box once the scene is over: the way on, to press or click when the player has finished reading. */
function Continue({ game, over, onGo }: { game: Game; over: Over; onGo: () => void }) {
  const { title, go, ready, fight } = onward(game, over);
  return <Clickable height={3} flexShrink={0} border borderColor={!ready ? C.border : fight ? C.danger : C.borderHot}
    title={` ${title} `} titleAlignment="left" titleColor={fight ? C.danger : C.title} paddingX={1} onClick={onGo}>
    <text>
      <span fg={ready ? C.lead : C.faint}>{"▶ "}</span>
      <span fg={!ready ? C.dim : fight ? C.danger : C.lead} attributes={ready ? BOLD : 0}>{go}</span>
      <span fg={C.faint}>{ready ? "   Enter, or click here" : "   (take your time: the last word stays put)"}</span>
    </text>
  </Clickable>;
}

export function SceneScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [draft, setDraft] = useState("");
  const scroll = useRef<ScrollBoxRenderable>(null);
  const input = useRef<InputRenderable>(null);
  /** The scene that's over whose keys have been looked at (to see what was in the box as it ended). */
  const seen = useRef<Over | undefined>(undefined);
  const session = game.session;
  const shown = game.shownScene;
  const over = game.over;
  /**
   * What's in the box now. The draft is as of the last render: keys that came in the same read as
   * this one (a paste, a fast typist, a browser's terminal) are in the input but not the draft yet.
   */
  const typed = () => input.current?.value ?? draft;
  // Emptied directly too: a draft that went "#exits" and back to "" between two renders never changes the prop.
  const clear = () => { setDraft(""); if (input.current) input.current.value = ""; };
  const send = (value: string) => {
    if (!value.trim()) return;
    // The sheet, the map, the notebook and the help open any time; the rest waits for the GM.
    if (game.peek(value)) { clear(); return; }
    if (game.busy || game.over) return;
    clear();
    void game.input(value);
  };
  // What to pick above the box: a command being typed, or the core's choices (a talk's lines, its goodbye, walking on).
  const typing = /^[/#]/.test(draft) ? draft.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const commands = typing === undefined || draft.includes(" ") ? [] : COMMANDS.filter(c => c.name.startsWith(typing) || commandNamed(typing) === c.name);
  // As many as leave the conversation room to be read (a short terminal shows fewer).
  const room = Math.min(9, Math.max(3, height - 18));
  const choices = fitChoices(game.choices, room);
  const say = (i: number) => { const choice = choices[i]; if (choice) { clear(); game.choose(choice); } };
  const picks: Pick[] = typing !== undefined ? commands.slice(0, room).map(c => ({ key: `/${c.name}`, label: c.what, color: c.testing ? C.faint : C.dim, run: () => send(`/${c.name}`) }))
    : over || game.busy ? []
    : choices.map((a, i) => ({ key: String(i + 1), label: a.label, color: a.kind === "say" ? C.player : C.dim, run: () => say(i) }));
  useKeyboard(key => {
    if (game.overlay || game.screen !== "scene" || key.defaultPrevented) return;
    if (key.name === "pageup" || key.name === "pagedown") {
      scroll.current?.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(3, height - 12));
    } else if (key.name === "escape") { key.preventDefault(); game.overlay = { kind: "menu", index: 0 }; game.emit(); }
    else if (game.over) {
      // Over: an Enter of its own goes on (or a click). A line was in the box as it ended? Its Enter only ends it.
      if (seen.current !== game.over) { seen.current = game.over; if (typed().trim()) game.typing = true; }
      const what = wayOnKey(game, key);
      if (!what) return;
      key.preventDefault();
      if (what === "go") { clear(); game.continueScene(); }
      else if (what === "line") { clear(); game.status = "The scene was over, so that went unsaid. Enter goes on."; game.emit(); }
    } else if (!typed() && !game.busy && /^[1-9]$/.test(key.sequence ?? "") && choices[Number(key.sequence) - 1]) {
      // A number picks one of the choices, while nothing's been typed.
      key.preventDefault();
      say(Number(key.sequence) - 1);
    }
  });
  if (!session || !shown) return null;
  const scene = sceneById(shown);
  // The place needs room to be drawn: a wide panel beside the transcript on a wide terminal.
  const side = width >= 100 ? Math.min(62, Math.floor(width * 0.42)) : 0;
  const inner = side - 4;
  const moved = session.sceneId !== shown;
  const here = moved ? [] : presentCast(scene, session);
  const world = game.shownWorld;
  const busy = game.busy;
  const live = game.live?.scene === undefined || game.live.scene === shown ? game.live : undefined;
  const status = session.rules?.status ?? "";
  // How to talk: plain words are speech; asterisks and brackets are deeds.
  const talk = [
    ...wrap("Plain words are what you say:", inner).map(text => ({ text, color: C.faint })),
    { text: "  Who paid you, then?", color: C.player },
    ...wrap("*Asterisks* or (brackets) are what you do:", inner).map(text => ({ text, color: C.faint })),
    { text: "  *looks over my shoulder*", color: C.player },
    { text: "  (I cast Fireball)", color: C.player },
  ];
  const placeH = Math.max(8, height - 13 - wrap(status, inner).length - talk.length - picks.length);
  const keys: KeyHint[] = [
    ...(over ? [["Enter", "go on", () => { clear(); game.continueScene(); }] as KeyHint] : choices.length && !busy ? [[`1–${choices.length}`, "choose one"] as KeyHint] : []),
    ...(["sheet", "map", "journal", "help"] as const).map((name): KeyHint => [`/${name}`, "", () => { game.peek(`/${name}`); }]),
    ["PgUp/PgDn", "scroll"], ["Esc", "menu"],
  ];
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexGrow={1} border borderColor={C.border} title={` ${scene.title} · ${TIME_WORDS[scene.time ?? game.story.time].split(",")[0]} `} titleAlignment="left" flexDirection="column" paddingX={1}>
        {/* The scrollbar is laid over a column kept for it (see SCROLLBAR): the talk never loses a character under it. */}
        <scrollbox ref={scroll} flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" viewportCulling={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
          <Transcript lines={game.lines} live={live} />
        </scrollbox>
      </box>
      {side ? <box width={side} border borderColor={C.border} title=" At the scene " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.player} attributes={BOLD} flexShrink={0}>{truncate(session.player.name, inner)}</text>
        <text fg={C.dim} flexShrink={0}>{wrap(status, inner).join("\n")}</text>
        {world ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title} flexShrink={0}>{truncate(world.entities[world.root]?.name ?? "The place", inner)}</text>
          <Place game={game} width={inner} height={placeH} />
        </box> : <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>Here</text>
          {here.map(c => <text key={c.id} fg={personColor(c.id) ?? C.text}>{truncate(c.name, inner)}</text>)}
        </box>}
        <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title} flexShrink={0}>How to talk</text>
          {talk.map((l, i) => <text key={i} flexShrink={0} fg={l.color}>{truncate(l.text, inner)}</text>)}
        </box>
      </box> : null}
    </box>
    <box height={1} paddingX={1} flexShrink={0}>
      {busy ? <Spinner label={busy} /> : <text fg={game.status ? C.warn : C.faint}>{game.status ?? " "}</text>}
    </box>
    {picks.length ? <Picks picks={picks} width={width - 2} /> : null}
    {over ? <Continue game={game} over={over} onGo={() => { clear(); game.continueScene(); }} /> : <box height={3} flexShrink={0} border borderColor={busy ? C.border : C.borderHot} title=" What do you say? " titleAlignment="left" paddingX={1}>
      {/* Talking is the default: plain words are said out loud; asterisks and brackets are things done. */}
      {/* What's submitted is what the input holds as Enter comes: the letters before it in the same read are in it, and not yet in the draft. */}
      <input ref={input} value={draft} onInput={setDraft} onSubmit={(value: unknown) => send(typeof value === "string" ? value : typed())} focused={!game.overlay && game.screen === "scene"}
        placeholder={busy ? "The GM has the floor…" : width >= 100
          ? "Say it out loud. Do things in *asterisks* or (brackets): *looks over my shoulder*, (I cast Fireball)"
          : "Say it out loud; *asterisks* or (brackets) to do things"} />
    </box>}
    <box height={1} paddingX={1} flexShrink={0}>
      <Keys items={keys} gap={width < 100 ? " · " : "  ·  "} />
    </box>
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

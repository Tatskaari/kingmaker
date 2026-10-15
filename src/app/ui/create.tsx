import type { KeyEvent, MouseEvent, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { locate, type LoreIssue } from "../../lore/backstory.ts";
import type { BuildOption, Choice } from "../../rules/builds.ts";
import type { Creation, Game } from "../game.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, LEVEL } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, fit, isEnter, ITALIC, Keys, Spinner, useGame, wrap, type KeyHint } from "./common.tsx";
import { cardRows, ownRows, storyRowOf, storyRows } from "./creation-layout.ts";
import { sheetHeight, type Row, type Run } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/**
 * Making a character: a name and a concept (CreateScreen); three builds that fit, as cards, or one of
 * the player's own making (ChooseScreen, CustomScreen); their backstory, written, drafted or worked
 * in from notes, then checked against the world's lore (BackstoryScreen); and the sheet the rules
 * engine made (CreatedScreen). The flow is the Game's (creation in game.ts); these draw it and take
 * the keys and the mouse.
 */

const ROLLING = [
  "Consulting the Standard Array…",
  "Negotiating with a background…",
  "Issuing a weapon. No, a better one. No, that one…",
  "Explaining proficiency bonuses to the character, who is not listening…",
  "Assigning hit points with the solemnity they deserve…",
  "Choosing spells the character will forget they have…",
];

const MEASURING = [
  "Three tailors take your measurements…",
  "Holding three sets of robes up against you…",
  "Asking the rules engine whether that's legal. It usually is…",
  "Comparing hit dice, which is a sentence nobody should have to say…",
];

const WRITING = [
  "Writing you into the story…",
  "Telling the GM who you are, in confidence…",
  "Finding you a place in Caerwyn, between the grain and the bunting…",
];

const EXAMPLES = [
  "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier",
  "Brother Odo: a large, gentle hedge-priest who settles arguments by sitting on them",
  "Pell Marrow: a Nine Furrows weather-witch who is never wrong about rain and rarely right about people",
];

const attributesOf = (r: Run) => (r.bold ? BOLD : 0) | (r.italic ? ITALIC : 0);

/** Styled rows, one <text> a row. */
function Rows({ rows }: { rows: Row[] }) {
  return <box flexDirection="column" flexShrink={0}>
    {rows.map((row, i) => <text key={i} height={1} flexShrink={0}>{row.length
      ? row.map((r, j) => <span key={j} fg={r.fg ?? C.text} {...(r.bg ? { bg: r.bg } : {})} {...(attributesOf(r) ? { attributes: attributesOf(r) } : {})}>{r.text}</span>)
      : " "}</text>)}
  </box>;
}

/** A button: lit under the pointer, picked out (`on`) when the keys are on it; dim when there's no doing it now (it still says why, when pressed). */
function Button({ label, onClick, on, dim }: { label: string; onClick: () => void; on?: boolean; dim?: boolean }) {
  return <Clickable height={1} flexShrink={0} onClick={onClick} backgroundColor={on ? C.pickBg : C.panel}>
    <text height={1} flexShrink={0}><span fg={dim ? C.faint : on ? C.lead : C.title} attributes={BOLD}>{` ${label} `}</span></text>
  </Clickable>;
}

// ---------------------------------------------------------------------------------------------
// The name and the concept.

/** Name and concept; then three builds that fit (or one of their own), and their backstory. */
export function CreateScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  // Back from the builds: as they were typed.
  const [name, setName] = useState(() => (game.creation && game.creation.name !== DEFAULT_NAME ? game.creation.name : ""));
  const [concept, setConcept] = useState(() => (game.creation && game.creation.concept !== DEFAULT_CONCEPT ? game.creation.concept : ""));
  const [field, setField] = useState<"name" | "concept">(() => (game.creation ? "concept" : "name"));
  // What the box holds when Enter comes (a pasted line arrives with its Enter, before the state catches up).
  const submit = (typed = concept) => void game.offerBuilds(name || DEFAULT_NAME, typed || DEFAULT_CONCEPT);
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented || game.screen !== "create") return;
    if (key.name === "tab" || (key.name === "up" && field === "concept") || (key.name === "down" && field === "name")) setField(f => (f === "name" ? "concept" : "name"));
    else if (key.name === "escape") game.toTitle();
  });
  const w = Math.min(width - 4, 100);
  const tall = height >= 30;
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>Who are you?</text>
    <text fg={C.dim} attributes={ITALIC}>The King has lent you to a small matter of a hanged clerk. He didn't say who you were. You'd better.</text>
    <box width={w} marginTop={1} border borderColor={field === "name" ? C.borderHot : C.border} title=" Name " titleAlignment="left" height={3}>
      <input value={name} onInput={setName} onSubmit={(value: unknown) => { if (typeof value === "string") setName(value); setField("concept"); }} focused={field === "name"} placeholder={`${DEFAULT_NAME} (Enter for the default)`} />
    </box>
    <box width={w} border borderColor={field === "concept" ? C.borderHot : C.border} title=" Who they are, in a sentence " titleAlignment="left" height={3}>
      <input value={concept} onInput={setConcept} onSubmit={(value: unknown) => submit(typeof value === "string" ? value : concept)} focused={field === "concept"} placeholder={DEFAULT_CONCEPT} />
    </box>
    <box width={w} flexDirection="column" marginTop={1}>
      <text fg={C.dim}>{`Next: three level ${LEVEL} D&D builds that fit (SRD 5.2.1), or one of your own, then your backstory. For example:`}</text>
      {EXAMPLES.map((e, i) => <text key={i} fg={C.faint}>{`  · ${e}`}</text>)}
    </box>
    <box width={w} height={1} marginTop={1} flexShrink={0} alignItems="center"><text fg={C.danger}>{game.error ?? ""}</text></box>
    <box marginTop={tall ? 1 : 0}><Keys items={[["Tab", "switch field"], ["Enter", field === "name" ? "next" : "see three builds"], ["Esc", "back"]]} /></box>
  </box>;
}

/** While the model and the engine work: who's being made, and a line at a time of what's happening. */
export function CreatingScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLine(l => l + 1), 1800);
    return () => clearInterval(timer);
  }, []);
  const lines = game.creation?.busy === "builds" ? MEASURING : game.creation?.busy === "making" ? WRITING : ROLLING;
  const concept = wrap(game.creating?.concept || DEFAULT_CONCEPT, Math.min(width - 4, 100)).slice(0, 3);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>{game.creating?.name || DEFAULT_NAME}</text>
    {concept.map((l, i) => <text key={i} fg={C.dim} attributes={ITALIC}>{l}</text>)}
    <box marginTop={2}><Spinner label={lines[line % lines.length]!} /></box>
  </box>;
}

// ---------------------------------------------------------------------------------------------
// Three builds.

/** A build's card: a click chooses it, the pointer moving over it picks it out. */
function Card({ option, n, on, w, h, onPick, onChoose }: { option: BuildOption; n: number; on: boolean; w: number; h: number; onPick: () => void; onChoose: () => void }) {
  return <Clickable width={w} height={h} flexShrink={0} border borderStyle="rounded" borderColor={on ? C.borderHot : C.border} title={` ${n} `} titleAlignment="left"
    titleColor={on ? C.title : C.dim} paddingX={1} flexDirection="column" onClick={onChoose} onMouseMove={onPick}>
    <Rows rows={cardRows(option, w - 4, h - 2)} />
  </Clickable>;
}

/** The cards' size for a screen: their width, and the height the tallest needs (no more than there's room for). */
export function cardSize(c: Creation, width: number, height: number): { w: number; h: number; gap: number } {
  const gap = width >= 100 ? 2 : 1;
  const w = Math.min(46, Math.floor((width - 2 - gap * 2) / 3));
  const fixed = 6 + conceptLines(c, width).length + (c.offer?.note ? 1 : 0);
  const room = Math.max(8, Math.min(26, height - fixed));
  const tallest = Math.max(...(c.offer?.options ?? []).map(o => cardRows(o, w - 4, room - 2).length));
  return { w, h: Math.min(room, tallest + 2), gap };
}

const conceptLines = (c: Creation, width: number) => wrap(`${c.name}: ${c.concept}`, Math.min(width - 4, 120)).slice(0, 2);

/** Three builds that fit the concept, as cards: click one (or ←→ and Enter, or 1-3); or make their own; or back to the concept. */
export function ChooseScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const c = game.creation;
  const options = c?.offer?.options ?? [];
  const at = c?.index ?? 0;
  const take = (i: number) => (i < 3 ? game.chooseBuild(i) : void game.makeOwn());
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented || game.screen !== "choose" || !c) return;
    if (key.name === "left" || (key.name === "tab" && key.shift) || key.name === "up") game.pickCard((at + 3) % 4);
    else if (key.name === "right" || key.name === "tab" || key.name === "down") game.pickCard((at + 1) % 4);
    else if (isEnter(key) || key.name === "space") take(at);
    else if (/^[1-3]$/.test(key.sequence ?? "") && Number(key.sequence) <= options.length) game.chooseBuild(Number(key.sequence) - 1);
    else if (key.name === "m") void game.makeOwn();
    else if (key.name === "escape" || key.name === "backspace" || key.name === "b") game.backToConcept();
    else return;
    key.preventDefault();
  });
  if (!c) return <box width={width} height={height} backgroundColor={C.bg} />;
  const size = cardSize(c, width, height);
  const keys: KeyHint[] = [["←→", "choose"], ["Enter", at < 3 ? "take this one" : "make my own", () => take(at)], ["1-3", "take one"], ["m", "make my own", () => void game.makeOwn()], ["Esc", "back", () => game.backToConcept()]];
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>{`Three ways to be ${c.name}`}</text>
    {conceptLines(c, width).map((l, i) => <text key={i} fg={C.dim} attributes={ITALIC}>{l}</text>)}
    {c.offer?.note ? <text fg={C.faint}>{wrap(c.offer.note, width - 4)[0]}</text> : null}
    <box flexDirection="row" marginTop={1} gap={size.gap} height={size.h} flexShrink={0}>
      {options.map((o, i) => <Card key={i} option={o} n={i + 1} on={i === at} w={size.w} h={size.h} onPick={() => game.pickCard(i)} onChoose={() => game.chooseBuild(i)} />)}
    </box>
    <box flexDirection="row" marginTop={1} gap={2} flexShrink={0}>
      <Button label="Make my own" on={at === 3} onClick={() => void game.makeOwn()} />
      <Button label="Back" onClick={() => game.backToConcept()} />
    </box>
    <box marginTop={height >= 30 ? 1 : 0}><Keys items={fit(keys, width - 2)} /></box>
  </box>;
}

// ---------------------------------------------------------------------------------------------
// A build of their own.

interface Column { title: string; items: Choice[]; picked: string | undefined; set: (id: string) => void; none?: string }

/** One list to pick from: the picked one marked, a click picks one; it scrolls to keep the picked one in view. */
function List({ col, on, w, h, onFocus }: { col: Column; on: boolean; w: number; h: number; onFocus: () => void }) {
  const rows = h - 2;
  const at = Math.max(0, col.items.findIndex(i => i.id === col.picked));
  const top = Math.max(0, Math.min(col.items.length - rows, at - Math.floor(rows / 2)));
  const shown = col.items.slice(top, top + rows);
  return <box width={w} height={h} flexShrink={0} border borderStyle="rounded" borderColor={on ? C.borderHot : C.border} title={` ${col.title} `} titleAlignment="left" titleColor={on ? C.title : C.dim} flexDirection="column">
    {shown.length ? shown.map(item => {
      const picked = item.id === col.picked;
      return <Clickable key={item.id} height={1} flexShrink={0} onClick={() => { onFocus(); col.set(item.id); }}>
        <text height={1} flexShrink={0}><span fg={picked ? C.lead : C.dim}>{picked ? "▶ " : "  "}</span><span fg={picked ? C.title : C.text} {...(picked ? { attributes: BOLD } : {})}>{item.name.slice(0, w - 4)}</span></text>
      </Clickable>;
    }) : <text fg={C.faint} attributes={ITALIC}>{wrap(col.none ?? "", w - 2)[0] ?? ""}</text>}
    {col.items.length > rows ? <text fg={C.faint} height={1} position="absolute" right={1} bottom={0}>{top + rows < col.items.length ? "▼" : "▲"}</text> : null}
  </box>;
}

/** Make their own: a species, a class, its subclass (where the level has one) and a background, the card it comes to as they pick. */
export function CustomScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const c = game.creation, own = c?.own;
  const picks = own?.picks;
  const lists = own?.lists;
  const cols: Column[] = own && picks && lists ? [
    { title: "Species", items: lists.species, picked: picks.speciesId, set: id => void game.pickOwn({ ...picks, speciesId: id }) },
    { title: "Class", items: lists.classes, picked: picks.classId, set: id => void game.pickOwn({ ...picks, classId: id }) },
    { title: "Subclass", items: LEVEL >= (lists.subclassLevel[picks.classId] ?? 3) ? lists.subclasses[picks.classId] ?? [] : [], picked: picks.subclassId, set: id => void game.pickOwn({ ...picks, subclassId: id }), none: `None until level ${lists.subclassLevel[picks.classId] ?? 3}` },
    { title: "Background", items: lists.backgrounds, picked: picks.backgroundId, set: id => void game.pickOwn({ ...picks, backgroundId: id }) },
  ] : [];
  const column = own?.column ?? 0;
  const step = (by: number) => {
    const col = cols[column];
    if (!col?.items.length) return;
    const i = Math.max(0, col.items.findIndex(x => x.id === col.picked));
    col.set(col.items[(i + by + col.items.length) % col.items.length]!.id);
  };
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented || game.screen !== "custom" || !own) return;
    if (key.name === "left" || (key.name === "tab" && key.shift)) game.ownColumn(column - 1);
    else if (key.name === "right" || key.name === "tab") game.ownColumn(column + 1);
    else if (key.name === "up") step(-1);
    else if (key.name === "down") step(1);
    else if (isEnter(key)) game.takeOwn();
    else if (key.name === "escape" || key.name === "backspace") game.backToBuilds();
    else return;
    key.preventDefault();
  });
  if (!own || !lists || !picks) return <box width={width} height={height} backgroundColor={C.bg} />;
  const total = Math.min(width - 2, 120);
  const gap = 1;
  // The subclass's names are the long ones; the rest fit their titles (" Background ").
  const narrow = Math.max(16, Math.floor((total - gap * 3) * 0.21));
  const widths = [narrow, narrow, total - gap * 3 - narrow * 3, narrow];
  const tall = height >= 30;
  const previewH = tall ? 7 : 5;
  const listH = Math.max(6, Math.min(14, height - (tall ? 15 : 12) - previewH + 5));
  const focused = cols[column];
  const about = focused?.items.find(i => i.id === focused.picked)?.about ?? focused?.none ?? "";
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD} height={1} flexShrink={0}>{`Make ${c!.name} your own way`}</text>
    {wrap(total >= 110 ? "A species, a class, its subclass and a background (SRD 5.2.1). The rest (abilities, skills, spells and kit) is the class's, made legal by the rules engine."
      : "A species, a class, its subclass and a background: the rest is the class's, made legal.", total).slice(0, 2).map((l, i) =>
      <text key={i} fg={C.dim} height={1} flexShrink={0}>{l}</text>)}
    <box flexDirection="row" gap={gap} marginTop={1} height={listH} flexShrink={0}>
      {cols.map((col, i) => <List key={col.title} col={col} on={i === column} w={widths[i]!} h={listH} onFocus={() => game.ownColumn(i)} />)}
    </box>
    <box width={total} height={1} flexShrink={0}><text fg={C.faint}>{`${focused?.title ?? ""}: ${about}`.slice(0, total)}</text></box>
    <box width={total} height={previewH} flexShrink={0} border borderStyle="rounded" borderColor={C.border} title={own.making ? " The rules engine is making it… " : " What it comes to "} titleAlignment="left" paddingX={1} flexDirection="column">
      {own.option ? <Rows rows={ownRows(own.option, total - 4, previewH - 2)} /> : <text fg={C.faint}>{c!.note ?? "…"}</text>}
    </box>
    <box flexDirection="row" marginTop={tall ? 1 : 0} gap={2} flexShrink={0}>
      <Button label="Take this one" on onClick={() => game.takeOwn()} dim={!own.option || own.making} />
      <Button label="Back" onClick={() => game.backToBuilds()} />
    </box>
    <box marginTop={tall ? 1 : 0}><Keys items={fit([["←→", "list"], ["↑↓", "pick"], ["Enter", "take this one", () => game.takeOwn()], ["Esc", "back", () => game.backToBuilds()]], width - 2)} /></box>
  </box>;
}

// ---------------------------------------------------------------------------------------------
// Their backstory.

const PROMPTS = "Where you're from · what you owe · who you've lost · why you took this case";
const PLACEHOLDER = "Where you're from, what you owe and to whom, who you've lost, why you took this case. A few rough notes will do: Work it in makes a story of them, in your voice, keeping everything you wrote.";

/** A view of text that doesn't edit (a draft, a story with a quote marked): it scrolls with the keys and the wheel. */
function Reader({ rows, h, top, onScroll }: { rows: Row[]; h: number; top: number; onScroll: (by: number) => void }) {
  const max = Math.max(0, rows.length - h);
  const shown = Math.min(top, max);
  const onWheel = (e: MouseEvent) => { if (e.scroll) onScroll(e.scroll.direction === "up" ? -2 : e.scroll.direction === "down" ? 2 : 0); };
  return <box height={h} flexShrink={0} flexDirection="row" onMouseScroll={onWheel}>
    <box flexGrow={1} flexDirection="column"><Rows rows={rows.slice(shown, shown + h)} /></box>
    {max ? <box width={1} flexDirection="column">{Array.from({ length: h }, (_, i) => {
      const thumb = Math.max(1, Math.round((h * h) / rows.length)), at = Math.round(((h - thumb) * shown) / max);
      return <text key={i} height={1} fg={i >= at && i < at + thumb ? C.title : C.faint}>{i >= at && i < at + thumb ? "┃" : "│"}</text>;
    })}</box> : null}
  </box>;
}

/**
 * Their backstory: a box to write it in (it scrolls; a click puts the cursor where the box allows),
 * Draft one and Work it in (shown first, to take or leave), Skip and Done; then what the lore check
 * found, a fix at a time, to accept or rewrite. Offline the model's buttons say the GM is.
 */
export function BackstoryScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const c = game.creation;
  const [focus, setFocus] = useState<"box" | "buttons">("box");
  const [button, setButton] = useState(3);
  const [choice, setChoice] = useState(0);
  const [top, setTop] = useState(0);
  const box = useRef<TextareaRenderable | null>(null);
  const issue: LoreIssue | undefined = c?.issues?.[c.issue];
  const mode = !c ? "write" : c.busy && c.busy !== "making" ? "busy" : c.proposal ? "proposal" : issue ? "issue" : "write";
  // A new view starts at its top, with its first choice picked out.
  useEffect(() => { setTop(0); setChoice(0); }, [mode, c?.issue, c?.proposal?.text]);
  // The box back (or its text put in from outside: a draft taken, a fix accepted): the cursor at its end, ready to go on.
  useEffect(() => { if (mode === "write" && !c?.rewriting) box.current?.gotoBufferEnd(); }, [mode, c?.version]);
  // Back to the box after a rewrite: the cursor at the words to rewrite.
  useEffect(() => {
    const r = c?.rewriting, b = box.current;
    if (!r?.quote || !b || !c) return;
    const span = locate(c.story, r.quote);
    if (span) b.cursorOffset = [...c.story.slice(0, span.start)].length;
    setFocus("box");
  }, [c?.rewriting]);
  /** What's in the box (it keeps its own text; the game keeps a copy). */
  const read = (): string => {
    const t = box.current?.plainText;
    if (typeof t === "string") game.storyTyped(t);
    return game.creation?.story ?? "";
  };
  const offline = game.aiOffline;
  const actions: Array<{ label: string; run: () => void; dim?: boolean }> = [
    { label: offline ? "Draft one (GM offline)" : "Draft one", run: () => { read(); void game.draftStory(); }, dim: offline },
    { label: offline ? "Work it in (GM offline)" : "Work it in", run: () => void game.workInStory(read()), dim: offline },
    { label: "Skip", run: () => void game.skipStory() },
    { label: "Done", run: () => void game.finishStory(read()) },
  ];
  const choices: Array<{ label: string; run: () => void }> = mode === "proposal"
    ? [{ label: "Use this", run: () => game.takeProposal() }, { label: "Keep mine", run: () => game.leaveProposal() }]
    : mode === "issue" ? [{ label: "Accept the fix", run: () => void game.acceptFix() }, { label: "Rewrite it myself", run: () => game.rewriteIssue() }] : [];
  const back = () => { read(); game.backToBuilds(); };
  useKeyboard((key: KeyEvent) => {
    if (game.overlay || key.defaultPrevented || game.screen !== "backstory" || !c) return;
    if (mode === "busy") { key.preventDefault(); return; }
    if (mode === "proposal" || mode === "issue") {
      if (key.name === "left" || key.name === "right" || key.name === "tab") setChoice(i => (i + 1) % 2);
      else if (isEnter(key) || key.name === "space") choices[choice]?.run();
      else if (key.name === "escape") choices[1]?.run();
      else if (key.name === "up") setTop(t => Math.max(0, t - 1));
      else if (key.name === "down") setTop(t => t + 1);
      else if (key.name === "pageup") setTop(t => Math.max(0, t - 6));
      else if (key.name === "pagedown") setTop(t => t + 6);
      else return;
      key.preventDefault();
      return;
    }
    // Writing: Tab between the box and the buttons; Esc back to the builds (what's written stays).
    if (key.name === "tab") { key.preventDefault(); read(); setFocus(f => (f === "box" ? "buttons" : "box")); return; }
    if (key.name === "escape") { key.preventDefault(); back(); return; }
    if (focus !== "buttons") return;
    if (key.name === "left") setButton(i => (i + actions.length - 1) % actions.length);
    else if (key.name === "right") setButton(i => (i + 1) % actions.length);
    else if (isEnter(key) || key.name === "space") actions[button]?.run();
    else if (key.name === "up") setFocus("box");
    else return;
    key.preventDefault();
  });
  if (!c) return <box width={width} height={height} backgroundColor={C.bg} />;
  const w = Math.min(width - 2, 110);
  const tall = height >= 30;
  const sub = c.chosen ? `${c.name} · ${c.chosen.line}` : c.name;
  // A rewrite's reason, or a word from the GM's part: the note row, one line.
  const rewriting = mode === "write" && c.rewriting ? `Rewrite this so it fits: ${c.rewriting.problem}${c.rewriting.quote ? ` ("${c.rewriting.quote}")` : ""}` : undefined;
  const note = rewriting ?? c.note;
  const noteLine = note ? (note.length > w - 2 ? `${note.slice(0, w - 3)}…` : note) : "";
  // Every row is always there (only what's in it changes), and the main box is the same height whatever
  // it shows: OpenTUI leaves a box where it was when a row comes or goes and the screen re-centres.
  // Besides the main box: the title and who, the prompts, the buttons, the note, the keys, and on a tall screen a row between each part.
  const fixed = 6 + (tall ? 3 : 0);
  const mainH = Math.max(6, Math.min(26, height - fixed - (tall ? 2 : 0)));
  const keys: KeyHint[] = mode === "proposal" || mode === "issue"
    ? [["Enter", choices[choice]!.label.toLowerCase(), choices[choice]!.run], ["Esc", choices[1]!.label.toLowerCase(), choices[1]!.run], ["↑↓", "scroll"]]
    : [["Tab", focus === "box" ? "to the buttons" : "back to writing"], ["Alt+Enter", "done", actions[3]!.run], ["Esc", "back to the builds", back]];

  // Boxes of a set height, in containers of the same height: a container left to measure itself comes up a row short, and what follows it lands on its last row.
  let main;
  if (mode === "proposal") {
    const rows = storyRows(c.proposal!.text, w - 5);
    main = <box width={w} height={mainH} flexShrink={0} border borderStyle="rounded" borderColor={C.borderHot} title={c.proposal!.kind === "draft" ? " A draft: not in your box until you take it " : " Your notes, worked in: not in your box until you take it "} titleAlignment="left" paddingX={1} flexDirection="column">
      <Reader rows={rows} h={mainH - 2} top={top} onScroll={by => setTop(t => Math.max(0, t + by))} />
    </box>;
  } else if (mode === "issue") {
    const span = issue!.quote ? locate(c.story, issue!.quote) : undefined;
    const said: Row[] = [
      ...wrapRun(`Your story says: "${issue!.quote ?? "(the GM couldn't point at the words)"}"`, w - 4, C.text),
      ...wrapRun(`The world says: ${issue!.problem}`, w - 4, C.warn),
      ...wrapRun(`A fix that keeps its spirit: "${issue!.fix}"`, w - 4, C.good),
    ];
    const panelH = Math.min(said.length + 2, Math.max(5, Math.floor(mainH / 2)));
    const storyH = Math.max(3, mainH - panelH);
    const rows = storyRows(c.story, w - 5, span);
    const quoteRow = span ? storyRowOf(c.story, w - 5, span.start) : 0;
    const shownTop = top || Math.max(0, quoteRow - 1);
    main = <box flexDirection="column" flexShrink={0} height={storyH + panelH}>
      <box width={w} height={storyH} flexShrink={0} border borderStyle="rounded" borderColor={C.border} title=" Your backstory " titleAlignment="left" paddingX={1} flexDirection="column">
        <Reader rows={rows} h={storyH - 2} top={shownTop} onScroll={by => setTop(Math.max(0, shownTop + by))} />
      </box>
      <box width={w} height={panelH} flexShrink={0} border borderStyle="rounded" borderColor={C.borderHot} title={` The lore check: ${c.issue + 1} of ${c.issues!.length} `} titleAlignment="left" paddingX={1} flexDirection="column">
        <Rows rows={said.slice(0, panelH - 2)} />
      </box>
    </box>;
  } else {
    main = <box width={w} height={mainH} flexShrink={0} border borderStyle="rounded" borderColor={focus === "box" && mode === "write" ? C.borderHot : C.border} title=" Your backstory " titleAlignment="left" paddingX={1}>
      <textarea key={c.version} ref={box} initialValue={c.story} placeholder={PLACEHOLDER} placeholderColor={C.faint} textColor={C.text} wrapMode="word"
        focused={focus === "box" && mode === "write" && !game.overlay && game.screen === "backstory"}
        onContentChange={() => { const t = box.current?.plainText; if (typeof t === "string") game.storyTyped(t); }}
        onSubmit={() => actions[3]!.run()} onMouseDown={() => setFocus("box")} />
    </box>;
  }
  const gap = tall ? <box height={1} flexShrink={0} /> : null;
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <box width={w} height={1} flexShrink={0} alignItems="center"><text fg={C.title} attributes={BOLD}>Who were you, before the King sent for you?</text></box>
    <box width={w} height={1} flexShrink={0} alignItems="center"><text fg={C.dim}>{wrap(sub, w)[0]}</text></box>
    {gap}
    <box width={w} height={mainH} flexShrink={0} flexDirection="column">{main}</box>
    <box width={w} height={1} flexShrink={0} alignItems="center"><text fg={C.faint}>{mode === "write" ? wrap(PROMPTS, w)[0] : ""}</text></box>
    {gap}
    <box width={w} height={1} flexShrink={0} flexDirection="row" justifyContent="center" gap={2}>
      {mode === "busy" ? <Spinner label={c.busy === "draft" ? "The GM drafts one…" : c.busy === "work" ? "The GM works your notes in, keeping every word that matters…" : "The GM checks your story against the world…"} />
        : mode === "write" ? actions.map((a, i) => <Button key={a.label} label={a.label} dim={a.dim} on={focus === "buttons" && i === button} onClick={() => { setButton(i); a.run(); }} />)
        : choices.map((a, i) => <Button key={a.label} label={a.label} on={i === choice} onClick={a.run} />)}
    </box>
    <box width={w} height={1} flexShrink={0} alignItems="center"><text fg={rewriting ? C.warn : C.dim} attributes={ITALIC}>{noteLine}</text></box>
    {gap}
    <box width={w} height={1} flexShrink={0} alignItems="center"><Keys items={fit(keys, width - 2)} /></box>
  </box>;
}

/** Words in one colour, wrapped to w, as rows. */
const wrapRun = (text: string, w: number, fg: string): Row[] => wrap(text, w).map(l => [{ text: l, fg }]);

// ---------------------------------------------------------------------------------------------
// The sheet the engine made.

/** The sheet the rules engine made (the portrait, the lot, their backstory), then on to the map. */
export function CreatedScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  // Not who you meant: back to the builds (the backstory comes too), or, from before character creation offered them, made again.
  const remake = () => { if (game.creation?.offer) game.backToBuilds(); else if (game.creating) void game.create(game.creating.name, game.creating.concept); };
  const sheet = useRef<SheetHandle>(null);
  useKeyboard(key => {
    // A spell picked on the sheet takes Enter, and one open takes every key.
    if (game.overlay || key.defaultPrevented || game.screen !== "created" || sheet.current?.wants(key)) return;
    if (key.name === "return" || key.name === "space") { key.preventDefault(); game.begin(); }
    else if (key.name === "r") { key.preventDefault(); remake(); }
  });
  const session = game.session;
  const w = Math.min(width - 2, 160);
  // Where the story starts, over the sheet (the map's "What happens" has all of it). Centred columns
  // don't measure wrapped text reliably: wrap it here and size the boxes to fit.
  const said = wrap(game.messages.at(-1) ?? "", w - 2);
  const most = height > 30 ? 5 : 3;
  const intro = said.length > most ? [...said.slice(0, most - 1), `${said[most - 1]!.slice(0, w - 3)}…`] : said;
  const who = session?.player ?? { name: game.creating?.name ?? "", concept: game.creating?.concept ?? "" };
  const sheetH = sheetHeight(game.sheet, who, w - 4, Math.max(8, Math.min(height - intro.length - (height > 30 ? 2 : 0), 58)) - 2) + 2;
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <box width={w} height={intro.length} flexDirection="column" flexShrink={0} paddingX={1} {...(height > 30 ? { marginBottom: 1 } : {})}>
      {intro.map((l, i) => <text key={i} fg={C.text} flexShrink={0}>{l}</text>)}
    </box>
    <box width={w} height={sheetH} border borderColor={C.border} title=" Character sheet " titleAlignment="left" paddingX={1} flexDirection="column" flexShrink={0}>
      {/* A new character (made again) starts on the first page. */}
      <SheetView ref={sheet} key={game.core?.state.id} data={game.sheet} who={who} width={w - 4} height={sheetH - 2}
        active={!game.overlay && game.screen === "created"} keys={[["Enter", "Set off", () => game.begin()], ["r", game.creation?.offer ? "Choose again" : "Make them again", remake]]} />
    </box>
  </box>;
}

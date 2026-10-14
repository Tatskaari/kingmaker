import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import type { Game } from "../game.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, LEVEL } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, Spinner, useGame, wrap } from "./common.tsx";

const ROLLING = [
  "Consulting the Standard Array…",
  "Negotiating with a background…",
  "Issuing a weapon. No, a better one. No, that one…",
  "Explaining proficiency bonuses to the character, who is not listening…",
  "Assigning hit points with the solemnity they deserve…",
  "Choosing spells the character will forget they have…",
];

const EXAMPLES = [
  "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier",
  "Brother Odo: a large, gentle hedge-priest who settles arguments by sitting on them",
  "Pell Marrow: a Nine Furrows weather-witch who is never wrong about rain and rarely right about people",
];

/** Name and concept; the rules engine turns them into a level 3 D&D character. */
export function CreateScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [field, setField] = useState<"name" | "concept">("name");
  const submit = () => void game.create(name || DEFAULT_NAME, concept || DEFAULT_CONCEPT);
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented || game.screen !== "create") return;
    if (key.name === "tab" || (key.name === "up" && field === "concept") || (key.name === "down" && field === "name")) setField(f => (f === "name" ? "concept" : "name"));
    else if (key.name === "escape") game.toTitle();
  });
  const w = Math.min(width - 4, 100);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>Who are you?</text>
    <text fg={C.dim} attributes={ITALIC}>The King has lent you to a small matter of a hanged clerk. He didn't say who you were. You'd better.</text>
    <box width={w} marginTop={1} border borderColor={field === "name" ? C.borderHot : C.border} title=" Name " titleAlignment="left" height={3}>
      <input value={name} onInput={setName} onSubmit={() => setField("concept")} focused={field === "name"} placeholder={`${DEFAULT_NAME} (Enter for the default)`} />
    </box>
    <box width={w} border borderColor={field === "concept" ? C.borderHot : C.border} title=" Who they are, in a sentence " titleAlignment="left" height={3}>
      <input value={concept} onInput={setConcept} onSubmit={submit} focused={field === "concept"} placeholder={DEFAULT_CONCEPT} />
    </box>
    <box width={w} flexDirection="column" marginTop={1}>
      <text fg={C.dim}>{`A class, a species, a background and a level ${LEVEL} D&D sheet are made to fit (SRD 5.2.1). For example:`}</text>
      {EXAMPLES.map((e, i) => <text key={i} fg={C.faint}>{`  · ${e}`}</text>)}
    </box>
    {game.error ? <text fg={C.danger} marginTop={1}>{game.error}</text> : null}
    <box marginTop={1}><Keys items={[["Tab", "switch field"], ["Enter", field === "name" ? "next" : "make the character"], ["Esc", "back"]]} /></box>
  </box>;
}

export function CreatingScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLine(l => l + 1), 1800);
    return () => clearInterval(timer);
  }, []);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>{game.creating?.name || DEFAULT_NAME}</text>
    <text fg={C.dim} attributes={ITALIC}>{game.creating?.concept || DEFAULT_CONCEPT}</text>
    <box marginTop={2}><Spinner label={ROLLING[line % ROLLING.length]!} /></box>
  </box>;
}

/** The sheet the rules engine made, then on to the map. */
export function CreatedScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented || game.screen !== "created") return;
    if (key.name === "return" || key.name === "space") { key.preventDefault(); game.begin(); }
  });
  const session = game.session;
  const w = Math.min(width - 4, 110);
  // Centred columns don't measure wrapped text reliably: wrap it here and size the boxes to fit.
  const sheet = (game.sheet ?? "").split("\n").flatMap(l => wrap(l, w - 4));
  const intro = wrap(game.messages.at(-1) ?? "", w);
  const room = Math.max(4, height - intro.length - 9);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD} flexShrink={0}>{`${session?.player.name ?? "You"}, ${session?.player.build ?? "adventurer"}`}</text>
    <text fg={C.dim} attributes={ITALIC} flexShrink={0}>{wrap(session?.player.concept ?? "", w)[0] ?? ""}</text>
    <box width={w} height={Math.min(room, sheet.length) + 2} marginTop={1} border borderColor={C.border} title=" Character sheet " paddingX={1} flexDirection="column" flexShrink={0}>
      {sheet.slice(0, room).map((l, i) => <text key={i} fg={C.text} flexShrink={0}>{l}</text>)}
    </box>
    <box width={w} height={intro.length} marginTop={1} flexDirection="column" flexShrink={0}>
      {intro.map((l, i) => <text key={i} fg={C.text} flexShrink={0}>{l}</text>)}
    </box>
    <box height={1} marginTop={1} flexShrink={0}><Keys items={[["Enter", "set off for the granary"], ["", "(c on the map or #sheet in a scene shows this again)"]]} /></box>
  </box>;
}

import { readDoc, writeDoc } from "./docs.ts";

/**
 * Fronts: the GM-only doc of what's in motion in a scene's world (lore/World/Fronts.md). Each front
 * is a "## " section with a clock of steps, one per line ("- [ ] **If Prout goes into the Captain's
 * book as a murder** ..."). At a scene boundary the steps that play, or the time passing, has made
 * true are ticked in the session's copy, steps play has made meaningless are struck out, and new
 * bills are added under "Bills still to come due". Every later boundary reads the doc as it stands.
 */

export interface FrontStep { front: string; step: string }
export interface FrontChanges { ticked: FrontStep[]; struck: Array<FrontStep & { why: string }>; bills: string[] }

const BILLS = /^##\s+Bills still to come due/i;
const STEP = /^- \[( |x)\] \*\*(.+?)\*\*/;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const same = (a: string, b: string) => { const x = key(a), y = key(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };

/** The doc's body as it stands in this session, if there is one. */
export function frontsText(sessionId: string, path: string): string | undefined {
  return readDoc(sessionId, path)?.body;
}

/** Apply a boundary's changes to the session's copy. Returns a line for each change made. */
export function moveFronts(sessionId: string, path: string, changes: FrontChanges, after: string): string[] {
  const doc = readDoc(sessionId, path);
  if (!doc) return [];
  const lines = doc.body.split("\n");
  const done: string[] = [];
  let front = "";
  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.+)$/.exec(lines[i]!);
    if (heading) { front = heading[1]!.trim(); continue; }
    const step = STEP.exec(lines[i]!);
    if (!step || step[1] === "x") continue;
    const matches = (c: FrontStep) => same(c.front, front) && same(c.step, step[2]!);
    const struck = changes.struck.find(matches);
    if (struck) {
      lines[i] = `- ~~${lines[i]!.slice(2)}~~ *(Struck after ${after}: ${struck.why.trim().replace(/\.$/, "")}.)*`;
      done.push(`struck: ${front}: ${step[2]} (${struck.why.trim()})`);
    } else if (changes.ticked.some(matches)) {
      lines[i] = `${lines[i]!.replace("- [ ]", "- [x]")} *(Ticked after ${after}.)*`;
      done.push(`ticked: ${front}: ${step[2]}`);
    }
  }
  // A bill already on its way isn't added twice (the same "If ..." as one listed).
  const listed = lines.filter(l => /^- \*\*If /i.test(l)).map(l => /^- \*\*(.+?)\*\*/.exec(l)![1]!);
  const ifPart = (b: string) => /^(?:\*\*)?(If [^:*(]+)/i.exec(b)?.[1] ?? b;
  const bills = changes.bills.map(b => b.trim()).filter(b => b && !listed.some(l => same(ifPart(l), ifPart(b)))).slice(0, 2);
  if (bills.length) {
    const at = lines.findIndex(l => BILLS.test(l));
    const added = bills.map(b => `- ${/^\*\*/.test(b) ? b : b.replace(/^(If [^:]+):/i, "**$1**:")} *(After ${after}.)*`);
    if (at < 0) lines.push("", "## Bills still to come due", ...added);
    else {
      // At the end of the section: before the next heading, after its last bullet.
      let end = lines.findIndex((l, j) => j > at && /^##\s/.test(l));
      if (end < 0) end = lines.length;
      while (end > at + 1 && !lines[end - 1]!.trim()) end--;
      lines.splice(end, 0, ...added);
    }
    done.push(...bills.map(b => `bill: ${b}`));
  }
  if (done.length) writeDoc(sessionId, { ...doc, body: lines.join("\n") });
  return done;
}

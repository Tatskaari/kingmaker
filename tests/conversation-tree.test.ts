import assert from "node:assert/strict";
import test from "node:test";
import { parseConversationTree } from "../packages/lore/src/conversation-tree.js";

const source = `---
id: test-tree
title: Test
character: aldren
initial: ask
visibility: gm
---
# Test
## Node: ask
### Guidance
Ask for help.
### When: accepted -> done
The player agreed.
#### Run: hello-world.ts
### When: declined -> done
The player refused.
## Node: done
### Guidance
Respond to their decision.
`;
test("compiles multiple outgoing conditions and optional scripts into a quest graph", () => {
  const tree = parseConversationTree(source);
  assert.equal(tree.characterId, "aldren");
  assert.deepEqual(tree.quest.transitions.map(edge => [edge.id, edge.fromStageId, edge.toStageId]),
    [["accepted", "ask", "done"], ["declined", "ask", "done"]]);
  assert.deepEqual(tree.scripts, { accepted: "hello-world.ts" });
  assert.equal(tree.quest.stages[0]!.description, "Ask for help.");
});
test("rejects invalid graphs and malformed reserved headings", () => {
  for (const invalid of [source.replace("initial: ask", "initial: missing"),
    source.replace("declined -> done", "accepted -> done"), source.replace("accepted -> done", "accepted -> missing"),
    source.replace("Ask for help.", ""), source.replace("The player agreed.", ""),
    source.replace("hello-world.ts", "../outside.ts"), source.replace("visibility: gm", "visibility: public"),
    source.replace("### Guidance", "### Guidnce")]) assert.throws(() => parseConversationTree(invalid));
});

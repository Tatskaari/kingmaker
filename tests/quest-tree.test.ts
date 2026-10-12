import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestTree } from "../packages/lore/src/quest-tree.js";
import { parseConversationTree } from "../packages/lore/src/conversation-tree.js";

const source = `---
id: delivery
title: Delivery
initial: cart_blocked
active: true
visibility: gm
---
# Delivery
Clear the entrance.

## Node: cart_blocked | Cart blocked
### Guidance
Find a remedy. Agreement is not clearance.
### Quest Log
Find a way to clear the cart.
### When: clear_cart -> cart_unblocked
The host has cleared the obstruction.
#### Trigger: none
#### Run: clear-cart.ts
### When: ask_aldren -> cart_unblocked
A successful exchange with Aldren.
#### Trigger: player_talked_to aldren

## Node: cart_unblocked | Cart unblocked
### Guidance
The entrance is clear.
### Quest Log
The entrance is clear.
### Completed
`;

test("quest graph shares conversation nodes, conditions and script metadata with explicit host triggers", () => {
  const tree = parseQuestTree(source);
  assert.equal(tree.active, true);
  assert.equal(tree.quest.initialStageId, "cart_blocked");
  assert.equal(tree.quest.description, "# Delivery\nClear the entrance.");
  assert.deepEqual(tree.quest.stages.map(stage => [stage.id, stage.title, stage.completed]),
    [["cart_blocked", "Cart blocked", false], ["cart_unblocked", "Cart unblocked", true]]);
  assert.equal(tree.quest.stages[0]!.questLog, "Find a way to clear the cart.");
  assert.deepEqual(tree.quest.transitions.map(edge => [edge.id, edge.toStageId, edge.playerTalkedTo]),
    [["clear_cart", "cart_unblocked", ""], ["ask_aldren", "cart_unblocked", "aldren"]]);
  assert.deepEqual(tree.scripts, { clear_cart: "clear-cart.ts" });
  assert.equal(parseQuestTree(source.replace("active: true\n", "")).active, false);
  assert.equal(parseQuestTree(source.replace("Trigger: none", "Trigger: discretionary")).quest.transitions[0]!.playerTalkedTo, "");
});

test("quest graphs reject missing, malformed or duplicate directives and invalid references", () => {
  for (const invalid of [source.replace("initial: cart_blocked", "initial: missing"),
    source.replace("active: true", "active: yes"), source.replace("#### Trigger: none\n", ""),
    source.replace("Trigger: none", "Trigger: automatic"), source.replace("Trigger: player_talked_to aldren", "Trigger: player_talked_to"),
    source.replace("#### Trigger: none", "#### Trigger: none\nUnexpected body"),
    source.replace("#### Trigger: none", "#### Trigger: none\n#### Trigger: discretionary"),
    source.replace("### Completed", "### Completed\nUnexpected body"), source.replace("### Completed", "### Completed\n### Completed"),
    source.replace("clear_cart -> cart_unblocked", "clear_cart -> absent"), source.replace("clear-cart.ts", "../outside.ts"),
    source.replace("visibility: gm", "visibility: public"), source.replace("Find a remedy. Agreement is not clearance.", ""),
    source.replace("### Quest Log\nFind a way to clear the cart.\n", "")]) {
    assert.throws(() => parseQuestTree(invalid));
  }
});

test("quest-only directives cannot silently alter conversation behavior", () => {
  assert.throws(() => parseConversationTree(source.replace("initial: cart_blocked", "character: aldren\ninitial: cart_blocked")), /Invalid graph heading/);
});

# Return-beat wording: GM evidence

Final responses and committed document diffs; no provider reasoning or frozen prompt fixtures.

## game, repeat 1

Updated Aldren’s private memory to record his commitment to order Holt to find the cushions and resolve the delay, while preserving that the order has not been delivered.

No Assembly Programme stage advances: Holt has not been approached, and the cause and location of the cushions remain unknown. The introductory conversation’s completion condition is met, but no runtime quest-transition operation was available in this review.

### Scenarios/Centennial Assembly/Characters/aldren/memories/index.md

```diff
--- 
+++ 
@@ -9,3 +9,5 @@
 
 - [[Scenarios/Centennial Assembly/Characters/aldren/memories/delegation|The envoy urges a direct order to Holt]]
 
+- [I will give Holt a direct order](e6c1415d-01c4-4947-999a-7b1665c83893.md) — After the envoy reminded me that I am king and asked whether I could simply order Holt, I accepted the advice and resolved to approach Holt myself.
+
```

### Scenarios/Centennial Assembly/Characters/aldren/memories/e6c1415d-01c4-4947-999a-7b1665c83893.md

```diff
--- 
+++ 
@@ -1,2 +1,11 @@
-{}
+{
+  "context": "After the envoy reminded me that I am king and asked whether I could simply order Holt, I accepted the advice and resolved to approach Holt myself.",
+  "readers": [
+    "character:aldren"
+  ],
+  "summary": "I will give Holt a direct order: After the envoy reminded me that I am king and asked whether I could simply order Holt, I accepted the advice and resolved to approach Holt myself.",
+  "title": "I will give Holt a direct order",
+  "visibility": "private"
+}
+The envoy was right: I can give Holt an order. I thanked them and said I would speak to Holt directly, ordering him to find the assembly cushions and resolve the delay. I have not delivered that order yet; Holt has not complied, and I still do not know the cause of the delay or where the cushions are.
 
```

## sql, repeat 1

No documents changed. The binding success settles that Aldren intends to approach Holt and issue the order, but the order has not been delivered. The missing-cushions investigation remains unresolved; the cause and location of the cushions are still unknown.

## prompt, repeat 1

**Updated:** Aldren’s conversation tree now supports the successful persuasion branch: he agrees to approach Holt, but the promise is not treated as a delivered order. It guides Aldren to report what Holt actually tells him and return the next decision to the player.

The quest notes and investigation transition now allow the player to learn Holt’s lead either directly from Holt or through Aldren’s accurate report after an actual conversation. **The quest has not advanced:** the order remains undelivered, and Aldren and the player still lack the cause and location of the delay.

**Follow-through:** Aldren must reach Holt, deliver the order, and report back. The Aldren-report route will also need an explicit transition invocation if it is not already wired.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -47,6 +47,18 @@
 ## Node: helping
 ### Guidance
 Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+### When: direct-order-chosen -> order-pending
+The player reminds Aldren that he is king and can order Holt, and the GM-adjudicated persuasion succeeds; Aldren agrees to approach Holt himself. Agreement is not yet an approach or a delivered order.
+
+## Node: order-pending
+### Guidance
+Thank the player and confirm that you intend to find Holt and order him to find the cushions and resolve the delay. Do not imply that you have reached Holt, delivered the order, learned the cause or secured the cushions.
+### When: order-delivered -> awaiting-report
+Aldren has actually located Holt and communicated the order. This alone does not establish Holt's compliance or that the cushions have arrived.
+
+## Node: awaiting-report
+### Guidance
+When you have actually spoken with Holt, report only what he told you. If he explains the obstruction, tell the player and invite them to help decide what to do next; do not claim the order cleared the entrance or delivered the cushions. If no explanation was given, report only Holt's actual response and leave the next choice to the player.
 
 ## Node: declined
 ### Guidance
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- 
+++ 
@@ -1,7 +1,7 @@
 {
   "id": "investigate_missing_pillows",
   "initial": true,
-  "summary": "The pillows are missing from the hall; ask Holt about the delivery.",
+  "summary": "The pillows are missing; learn the lead from Holt or Aldren's report.",
   "title": "Investigate the missing pillows",
   "transitions": [
     "[[./transitions/learn_cart_blocked]]"
@@ -10,9 +10,9 @@
 }
 # Investigate the missing pillows
 
-Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
+Aldren wants his pillows. The player can ask Holt where the delivery is; Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too. Alternatively, Aldren may approach Holt himself and later report Holt's explanation to the player.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Advance only once the player has actually heard that the delivery is probably held up by Rowan's cart—directly from Holt or in Aldren's truthful report after their actual conversation. A meeting, question, private disclosure to Aldren, or Aldren's promise/order alone is insufficient. Invoke the transition explicitly when the player learns the lead.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -53,7 +53,7 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself:** play their exchange only when he actually reaches Holt or communicates with him. Holt explains the obstruction to Aldren; the order does not clear it. Aldren must return to the player and report what Holt actually said before the player gains that knowledge or the investigation advances. Let the player choose what to pursue next.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes
@@ -65,13 +65,17 @@
   - Rowan can explain his interest in moving food with too few workers if asked about the machine's purpose; this does not disclose other people's agricultural secrets.
   - Leave room for refusal, partial success and player proposals. Exact repair mechanics, access routes, damage and later consequences remain to be authored or adjudicated.
 
+## Current adjudicated path (this run)
+
+A binding critical-success ruling established that, after agreeing to help with the cushions, the envoy persuaded Aldren to approach Holt himself and issue the order. Aldren has agreed and intends to do so; the order has not been delivered. Holt has not complied and the cushions have not arrived. Aldren and the envoy still do not know the cause of the delay or where the cushions are. Keep the investigation active. After Aldren actually speaks with Holt, bring him back to the player with an accurate report and a choice of what to do next; neither a private meeting nor a royal order resolves the problem offscreen.
+
 ## Stages
 
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows|Investigate the missing pillows]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked|Cart blocked]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/030_stage_cart_unblocked|Cart unblocked — unwritten]]
 
-Holt’s disclosed lead advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
+The investigation advances to the blocked cart only when the player learns Holt's lead, either directly from him or through Aldren's accurate report after their actual conversation. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
 
 ## Conversation branch direction
 
@@ -87,7 +91,7 @@
 
 ## Runtime and follow-up boundaries
 
-Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s disclosure advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
+Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; the player learning Holt’s lead—directly or through Aldren's report—advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
 
 `cart_unblocked` is a literal stub for iteration after the opening conversations. Later delivery, Aldren’s reaction and Holt’s wider programme are deferred.
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index.md

```diff
--- 
+++ 
@@ -4,7 +4,7 @@
 }
 # Transitions
 
-- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked by Holt’s disclosure.
+- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked when the player hears the lead from Holt or Aldren's accurate report of their actual conversation.
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|Clear the cart]] — material effects shared by repair, backing out and smashing.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

```diff
--- 
+++ 
@@ -1,14 +1,14 @@
 {
-  "condition": "Holt has told the player that the pillow delivery is probably blocked by Rowan\u2019s cart.",
+  "condition": "The player has learned from Holt directly, or from Aldren's accurate report after an actual conversation with Holt, that the pillow delivery is probably blocked by Rowan\u2019s cart.",
   "id": "learn_cart_blocked",
-  "summary": "Holt reveals that the pillow delivery is probably held up by the cart; his conversation edge advances the investigation.",
+  "summary": "The player learns that the pillow delivery is probably held up by the cart, from Holt or Aldren's report.",
   "to": "cart_blocked",
   "trigger": "none",
   "visibility": "gm"
 }
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the lead only after it has reached the player, directly from Holt or through Aldren's accurate report of an actual conversation. This does not move the cart or reveal private conversations to other characters. Invoke the transition from the conversation edge after the player hears the explanation; Aldren's promise to approach Holt, the private exchange by itself, or an order not yet delivered is insufficient. The existing `pillow-lead.ts` helper covers Holt's direct disclosure; the Aldren-report branch needs an equivalent explicit invocation if not already wired.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].
 
```

## game, repeat 2

No quest documents changed. Aldren’s successful persuasion means he is willing and intends to order Holt to find the cushions and resolve the delay, but the order has not been delivered. The Assembly Programme remains at its current investigation stage: it advances only when Holt discloses the cart lead, which has not happened. The introductory “Talk to King Aldren” conversation predicate is satisfied, but I can’t execute a runtime quest transition with the available tools.

**Still pending:** Aldren must reach Holt and give the order; the cause and location of the delayed cushions remain unknown.

## sql-and-prompt, repeat 1

Updated Aldren’s conversation tree with the successful royal-authority branch: he is willing to issue the order, but the order is not treated as delivered. Added a later report-back beat that brings Holt’s actual response—and the player’s next choice—back into the story.

Clarified the quest guidance so Aldren must report back if he speaks to Holt while the player is absent. The cart lead can advance the investigation only once the player receives Holt’s explanation, directly or accurately relayed by Aldren. **The active quest remains at “Investigate the missing pillows”; no order has been delivered and no stage has advanced.**

Follow-through remains: Aldren’s approach to Holt is still pending, and `pillow-lead.ts` needs scoped support for the Aldren-report route; it currently covers direct disclosure by Holt.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -2,7 +2,7 @@
   "character": "aldren",
   "id": "conversation-aldren-cushions",
   "initial": "greeting",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script.",
+  "summary": "Cushion conversation includes acceptance and refusal, Aldren's direct-order success, and a player-facing report after he contacts Holt.",
   "title": "Aldren and the cushions",
   "visibility": "gm"
 }
@@ -47,6 +47,18 @@
 ## Node: helping
 ### Guidance
 Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+### When: royal-authority-persuaded -> willing-to-order
+The player reminds Aldren that he is king and can order Holt; the GM-adjudicated persuasion succeeds, and Aldren agrees to approach Holt himself and issue the order. A suggestion without Aldren's agreement or an unsuccessful check does not meet this condition.
+
+## Node: willing-to-order
+### Guidance
+Aldren has accepted the player's argument and will approach Holt himself, order him to find the cushions and resolve the delay, and thank the player. This records willingness and intention only: do not claim Aldren has reached Holt, delivered the order, learned the cause, or made Holt comply. His next action requires actual follow-through.
+### When: returned-with-holt-report -> report-back
+Aldren has actually spoken with Holt and has returned to communicate Holt's response or disclosure to the player. The intention to approach Holt alone is insufficient.
+
+## Node: report-back
+### Guidance
+Tell the player only what Holt actually said to Aldren, distinguish Holt's account from confirmed outcomes, and invite the player into the next decision. If Holt disclosed that the cushions are probably held up by Rowan's cart, relay that lead accurately; invoke the quest's learn-cart-blocked transition only after the player receives it. If Holt did not disclose the cause, do not invent it or advance the investigation. An order and a report do not themselves find or deliver the cushions or clear the cart.
 
 ## Node: declined
 ### Guidance
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- 
+++ 
@@ -10,9 +10,9 @@
 }
 # Investigate the missing pillows
 
-Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
+Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too. If Aldren reaches Holt first, he may relay Holt's actual explanation to the player.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Only Holt disclosing that lead to the player—directly or through Aldren's accurate report of what Holt told him—advances this stage; an order, an intention to approach, a greeting or a question is insufficient. Invoke the transition only once the player has received the lead.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -34,7 +34,7 @@
   - **They suggest using the existing seats or substitutes:** he presses for the cushions he ordered; he genuinely cares about these cushions and keeps pressing unless you adjudicate a particularly high persuasion result. The precise threshold remains to be set; do not turn this into automatic refusal or automatic success.
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
-  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically. If he goes while the player is absent, he must return with an accurate account of what Holt actually said and bring the player back into the next choice; no obstruction or delivery is resolved offscreen.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**
@@ -53,7 +53,7 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself:** only after he actually reaches Holt does he convey the order. Play their exchange; Holt's response and any disclosure to Aldren are limited to what he actually says. A royal order neither clears the obstruction nor delivers the cushions. If the player is absent, Aldren must return promptly, relay only what Holt told him, and bring the player into the next decision; neither man silently resolves the obstruction or delivery. If Holt's lead is accurately relayed to the player, it can advance the investigation.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes
@@ -71,7 +71,7 @@
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked|Cart blocked]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/030_stage_cart_unblocked|Cart unblocked — unwritten]]
 
-Holt’s disclosed lead advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
+Holt’s disclosed lead advances the investigation to the blocked cart once the player receives it. That may be Holt's direct explanation or Aldren accurately relaying what Holt told him; neither an order nor Aldren's intention to approach is enough. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
 
 ## Conversation branch direction
 
@@ -87,7 +87,7 @@
 
 ## Runtime and follow-up boundaries
 
-Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s disclosure advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
+Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; the player's receipt of Holt's cart lead, directly or through Aldren's accurate report, advances it to `cart_blocked`. The existing `pillow-lead.ts` helper covers direct Holt disclosure; the Aldren-report route needs a scoped helper implementation. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
 
 `cart_unblocked` is a literal stub for iteration after the opening conversations. Later delivery, Aldren’s reaction and Holt’s wider programme are deferred.
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index.md

```diff
--- 
+++ 
@@ -4,7 +4,7 @@
 }
 # Transitions
 
-- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked by Holt’s disclosure.
+- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked once Holt's lead reaches the player directly or through Aldren's accurate report.
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|Clear the cart]] — material effects shared by repair, backing out and smashing.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

```diff
--- 
+++ 
@@ -1,14 +1,14 @@
 {
-  "condition": "Holt has told the player that the pillow delivery is probably blocked by Rowan\u2019s cart.",
+  "condition": "Holt has told the player directly, or Aldren has accurately relayed Holt\u2019s explanation to the player, that the pillow delivery is probably blocked by Rowan\u2019s cart.",
   "id": "learn_cart_blocked",
-  "summary": "Holt reveals that the pillow delivery is probably held up by the cart; his conversation edge advances the investigation.",
+  "summary": "The player learns from Holt, directly or through Aldren's accurate report, that Rowan's cart probably holds up the cushion delivery.",
   "to": "cart_blocked",
   "trigger": "none",
   "visibility": "gm"
 }
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the disclosed lead and direct the investigation to the cart only after the player has received Holt's actual explanation, either directly from Holt or in Aldren's accurate report. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` helper currently records the direct Holt-disclosure path; an Aldren-report path needs a scoped implementation before it can invoke this transition. Do not advance on Aldren's willingness to approach, the order being delivered, or an unverified report.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].
 
```

## sql, repeat 2

Recorded the successful Aldren conversation in the Assembly Programme quest notes. The introductory “Talk to King Aldren” predicate is fulfilled; Aldren accepted that he should approach Holt and issue an order. His private memory now distinguishes that commitment from an order already delivered.

**Still unresolved:** Aldren must deliver the order; Holt has not complied; the cushions’ whereabouts and the cause of the delay remain unknown. The missing-pillows investigation has not advanced. No runtime quest-stage or activity changes were made.

### Scenarios/Centennial Assembly/Characters/aldren/memories/index.md

```diff
--- 
+++ 
@@ -9,3 +9,5 @@
 
 - [[Scenarios/Centennial Assembly/Characters/aldren/memories/delegation|The envoy urges a direct order to Holt]]
 
+- [I accept the duty to order Holt](9f75e94d-d21b-4baa-bd02-673f0b0df109.md) — After the envoy reminded me of my authority, a GM-adjudicated critical success persuaded me to take responsibility for the late cushions myself.
+
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -35,6 +35,8 @@
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
   - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+
+  - **Recorded outcome this turn:** The player's successful exchange fulfills the introductory [[Scenarios/Centennial Assembly/Quests/Talk to King Aldren/index|Talk to King Aldren]] conversation predicate. The GM-adjudicated persuasion was a critical success (natural 20 + 17 = 37 vs. DC 15). Aldren thanked the envoy and accepted that he should approach Holt himself, saying he would make it an order to find the cushions and resolve the delay. This is willingness and a commitment, not a delivered order: Aldren has not reached or spoken to Holt; Holt has not complied; the cushions have not arrived, and their whereabouts and the cause of the delay remain unknown. The missing-pillows investigation remains unresolved; only Holt disclosing the lead advances it.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**
```

### Scenarios/Centennial Assembly/Characters/aldren/memories/9f75e94d-d21b-4baa-bd02-673f0b0df109.md

```diff
--- 
+++ 
@@ -1,2 +1,11 @@
-{}
+{
+  "context": "After the envoy reminded me of my authority, a GM-adjudicated critical success persuaded me to take responsibility for the late cushions myself.",
+  "readers": [
+    "character:aldren"
+  ],
+  "summary": "I accept the duty to order Holt: After the envoy reminded me of my authority, a GM-adjudicated critical success persuaded me to take responsibility for the late cushions myself.",
+  "title": "I accept the duty to order Holt",
+  "visibility": "private"
+}
+The envoy was right that I should approach Marshal Holt directly. I thanked them and said I would make it an order: find the cushions and resolve the delay. This is my commitment, not an order already delivered—Holt has not complied, the cushions have not arrived, and I still do not know where they are or why they are late.
 
```

## prompt, repeat 2

Updated the quest guidance and Aldren’s and Holt’s conversation trees to support Aldren’s direct-order approach. Aldren’s tree now distinguishes accepting the task from actually delivering the order, and brings him back to report Holt’s real response and involve the player. Holt’s tree covers the response only after the king has actually delivered the order. The investigation can now advance when Holt tells the player the lead directly, or Aldren accurately relays what Holt told him.

**The live quest remains at “Investigate the missing pillows.”** The critical success stands, with no reroll; Aldren has agreed to approach Holt, but has not yet delivered the order. The cause and whereabouts remain unresolved in the live scene, and no delivery or compliance has occurred.

**Follow-through:** Aldren still needs to reach Holt, deliver the order, then report back to the player. The existing `pillow-lead.ts` helper is documented for Holt’s direct disclosure; its support for Aldren’s report path still needs verification or implementation.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -46,7 +46,26 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If the GM has adjudicated that Aldren will approach Holt himself, acknowledge that this is his next intended step; do not imply he has already gone, delivered the order, learned why the cushions are late, or obtained compliance.
+### When: direct-order-accepted -> order-pending
+The GM-adjudicated persuasion success has made Aldren willing to locate Holt and issue the order himself. This records willingness and intent only; the order has not yet been delivered.
+
+## Node: order-pending
+### Guidance
+Aldren intends to find Holt and directly order him to find the cushions and resolve the delay. The actual approach and order are still outstanding until they occur. Do not report Holt's response, the cause of the delay, or delivery as fact before an actual exchange. After speaking with Holt, Aldren must return or recontact the player, report what Holt actually said, and invite the player to choose or join the next step; do not silently resolve the obstruction or finish the investigation offscreen.
+### When: returned-after-order -> report-back
+Aldren has actually spoken with Holt and returned or recontacted the player with an account of that exchange.
+
+## Node: report-back
+### Guidance
+Report only what Holt actually told Aldren, distinguishing Holt's account from Aldren's own observations or inferences. Do not claim the order succeeded merely because it was delivered; a royal order does not clear the entrance or deliver the cushions. Ask whether the player will join or how they want to proceed. If Holt told Aldren that Rowan's cart is blocking the cushion delivery, relay that specific lead with its source and invite the player into the investigation.
+### When: cart-lead-relayed -> player-involved
+Aldren has accurately told the player that Holt said the cushion delivery is probably blocked by Rowan's cart.
+#### Run: pillow-lead.ts
+
+## Node: player-involved
+### Guidance
+The player now has Holt's reported lead. Keep Aldren's knowledge scoped to what Holt told him, and let the player choose whether to investigate the cart, speak with Holt, or pursue another established approach. The cart remains obstructing the entrance until an actual remedy succeeds.
 
 ## Node: declined
 ### Guidance
```

### Conversations/holt.md

```diff
--- 
+++ 
@@ -15,6 +15,12 @@
 The player has asked Holt where the pillows or cushions are.
 ### When: calmed-first -> explaining
 Holt has actually calmed enough to hear the player out, rather than the player merely claiming he has.
+### When: royal-order-delivered -> royal-order
+Aldren has actually reached Holt and directly delivered the order to find the cushions and resolve the delay. Aldren's willingness or intention alone does not trigger this edge.
+
+## Node: royal-order
+### Guidance
+This is Holt responding to an order actually delivered by the king, not to the player merely repeating Aldren's demand. Treat the order as authoritative, but explain the practical obstruction he knows about: Rowan's cart blocks the service entrance and the cushions are caught in the delivery queue behind it. The order does not move the cart or deliver the cushions by itself. Do not claim either result, or any further action by Holt, unless it actually happens. Aldren learns only what Holt tells him in this exchange; the player learns it only if Aldren later reports it or Holt tells them directly. If the player speaks with you afterward, respond using what has actually occurred and keep the physical obstruction unresolved until a successful remedy.
 
 ## Node: interrupted
 ### Guidance
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- 
+++ 
@@ -1,7 +1,7 @@
 {
   "id": "investigate_missing_pillows",
   "initial": true,
-  "summary": "The pillows are missing from the hall; ask Holt about the delivery.",
+  "summary": "Find out why the assembly cushions are late, directly from Holt or through Aldren's report.",
   "title": "Investigate the missing pillows",
   "transitions": [
     "[[./transitions/learn_cart_blocked]]"
@@ -12,7 +12,7 @@
 
 Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Advance this stage only after the player actually receives the lead that the cushion delivery is probably blocked by Rowan's cart. Holt may disclose it directly, or Aldren may relay it after Holt told Aldren during their actual exchange. A mere order, meeting, promise, or unsourced report is insufficient. Invoke the transition explicitly after the disclosure to the player.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -34,7 +34,7 @@
   - **They suggest using the existing seats or substitutes:** he presses for the cushions he ordered; he genuinely cares about these cushions and keeps pressing unless you adjudicate a particularly high persuasion result. The precise threshold remains to be set; do not turn this into automatic refusal or automatic success.
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
-  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically. If Aldren accepts this route, he must actually locate Holt and convey the order before it counts as delivered. After their exchange, have Aldren return or recontact the player with Holt’s actual response and invite the player to choose or join the next step; do not let him clear the obstruction or finish the investigation privately.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**
@@ -53,7 +53,7 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself:** play their exchange only when Aldren actually reaches or communicates with Holt. Holt explains the obstruction; a royal order does not clear it. Aldren learns these details in that exchange, not earlier. Have him return or recontact the player with his attributed account and invite the player to choose or join the investigation. Advance to `cart_blocked` only after Aldren relays Holt's actual lead to the player; do not let Aldren clear the cart, deliver the cushions or finish the investigation privately.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes
@@ -71,7 +71,7 @@
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked|Cart blocked]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/030_stage_cart_unblocked|Cart unblocked — unwritten]]
 
-Holt’s disclosed lead advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
+The player learning Holt’s lead—directly from him, or through Aldren accurately reporting their actual exchange—advances the investigation to the blocked cart. The order alone does not. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
 
 ## Conversation branch direction
 
@@ -87,7 +87,7 @@
 
 ## Runtime and follow-up boundaries
 
-Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s disclosure advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
+Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s direct disclosure advances it to `cart_blocked`, and an accurate report from Aldren after his actual exchange is also a valid authored route. The existing `pillow-lead.ts` helper is documented for Holt’s direct disclosure; verify or add its use for Aldren’s report before treating that alternative as executable. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
 
 `cart_unblocked` is a literal stub for iteration after the opening conversations. Later delivery, Aldren’s reaction and Holt’s wider programme are deferred.
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index.md

```diff
--- 
+++ 
@@ -4,7 +4,7 @@
 }
 # Transitions
 
-- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked by Holt’s disclosure.
+- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked after Holt tells the player, or Aldren accurately relays Holt’s explanation to the player.
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|Clear the cart]] — material effects shared by repair, backing out and smashing.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

```diff
--- 
+++ 
@@ -1,14 +1,14 @@
 {
-  "condition": "Holt has told the player that the pillow delivery is probably blocked by Rowan\u2019s cart.",
+  "condition": "The player has learned from Holt directly, or from Aldren accurately relaying Holt\u2019s actual explanation, that the pillow delivery is probably blocked by Rowan\u2019s cart.",
   "id": "learn_cart_blocked",
-  "summary": "Holt reveals that the pillow delivery is probably held up by the cart; his conversation edge advances the investigation.",
+  "summary": "Holt\u2019s explanation, whether direct or accurately relayed by Aldren, reveals the likely cart blockage and advances the investigation.",
   "to": "cart_blocked",
   "trigger": "none",
   "visibility": "gm"
 }
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` helper currently handles Holt’s direct disclosure; its use for Aldren’s later, accurate report must be wired or verified before that route is executable. Invoke this transition only after the player has actually received the qualifying information.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].
 
```

## sql-and-prompt, repeat 2

Updated Aldren’s conversation tree with a **pending direct order** path and a later **report-to-the-player** path. The report invites the player to help choose or pursue what comes next; it does not assume their response or let Aldren resolve the blockage offscreen.

Updated the Assembly Programme guidance and `learn_cart_blocked` transition so the investigation can advance when Aldren actually reports Holt’s explanation, as well as when Holt tells the player directly. An accepted order, a meeting not yet reported, or a promise of compliance is not enough.

The quest remains at **Investigate the missing pillows**: Aldren has not delivered the order, Holt has not complied, and the cushions’ whereabouts and the delay’s cause remain unknown.

**Follow-through:** the Aldren-report branch calls `pillow-lead.ts`; confirm that helper supports a report from Aldren as well as Holt’s direct disclosure.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -2,7 +2,7 @@
   "character": "aldren",
   "id": "conversation-aldren-cushions",
   "initial": "greeting",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script.",
+  "summary": "Aldren's cushion enquiry, refusal, direct order to Holt and a report path that returns the investigation to the player.",
   "title": "Aldren and the cushions",
   "visibility": "gm"
 }
@@ -46,7 +46,20 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If the player points out that you are king and can order Holt, and the GM-adjudicated persuasion succeeds, accept that you should approach him yourself. Your promise is not yet a delivered order or a resolved delay.
+### When: order-yourself -> order-pending
+The player persuaded Aldren to approach Holt and issue the order himself. This records willingness and intent only; Aldren has not necessarily reached Holt or delivered the order.
+
+## Node: order-pending
+### Guidance
+Follow through by locating and speaking directly to Holt, and communicate the order to find the cushions and resolve the delay. Do not claim the order has been delivered before the conversation occurs, or that Holt complied or the cushions arrived. In the established Assembly Programme, Holt explains the cart obstruction when Aldren actually approaches him. Return to the player with what Holt actually said, explain that the order has not cleared the obstruction, and invite the player to join you in deciding or pursuing a remedy; do not settle the obstruction offscreen.
+### When: report-cart-lead -> cart-lead-reported
+Aldren has actually reached Holt, delivered the order, heard Holt explain that Rowan's cart blocks the cushion delivery, and returned to tell the player that explanation. A promise to go, travel, or a private conversation not yet reported to the player is insufficient.
+#### Run: pillow-lead.ts
+
+## Node: cart-lead-reported
+### Guidance
+Report Holt's actual explanation to the player: the cushions are held up by Rowan's cart at the service entrance. State only what Aldren learned in that conversation, and make clear that the order has not itself cleared the obstruction or delivered the cushions. Ask whether the player will accompany you to investigate the cart or what approach they propose, then leave the choice to them.
 
 ## Node: declined
 ### Guidance
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- 
+++ 
@@ -12,7 +12,7 @@
 
 Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. The player may learn it directly from Holt, or through Aldren's actual report after Aldren has spoken to Holt and heard the explanation. Aldren's willingness to approach, a delivered order without the explanation being reported to the player, or a promise of compliance is insufficient. Invoke the same transition when the player receives the disclosed lead.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -53,7 +53,7 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself:** play their exchange only when he actually reaches Holt. Holt explains the obstruction; a royal order is not compliance and does not clear it. Aldren then returns to the player with what Holt actually told him and invites the player to help decide or pursue the next step, rather than resolving the blockage offscreen.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes
@@ -71,7 +71,7 @@
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked|Cart blocked]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/030_stage_cart_unblocked|Cart unblocked — unwritten]]
 
-Holt’s disclosed lead advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
+Holt’s disclosed lead, told directly to the player or actually reported by Aldren, advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
 
 ## Conversation branch direction
 
@@ -87,7 +87,7 @@
 
 ## Runtime and follow-up boundaries
 
-Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s disclosure advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
+Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; the player’s receipt of Holt’s disclosure, directly or through Aldren’s report, advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
 
 `cart_unblocked` is a literal stub for iteration after the opening conversations. Later delivery, Aldren’s reaction and Holt’s wider programme are deferred.
 
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index.md

```diff
--- 
+++ 
@@ -4,7 +4,7 @@
 }
 # Transitions
 
-- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked by Holt’s disclosure.
+- [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked|Learn about the blockage]] — explicitly invoked after Holt's disclosure reaches the player directly or through Aldren's actual report.
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|Clear the cart]] — material effects shared by repair, backing out and smashing.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].
```

### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

```diff
--- 
+++ 
@@ -1,14 +1,14 @@
 {
-  "condition": "Holt has told the player that the pillow delivery is probably blocked by Rowan\u2019s cart.",
+  "condition": "The player has learned from Holt, directly or through Aldren's actual report after speaking with Holt, that the pillow delivery is probably blocked by Rowan\u2019s cart.",
   "id": "learn_cart_blocked",
-  "summary": "Holt reveals that the pillow delivery is probably held up by the cart; his conversation edge advances the investigation.",
+  "summary": "The player learns from Holt or Aldren's report that the pillow delivery is probably held up by Rowan's cart.",
   "to": "cart_blocked",
   "trigger": "none",
   "visibility": "gm"
 }
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the disclosed lead and direct the investigation to the cart. The existing `pillow-lead.ts` call handles Holt's direct disclosure; invoke this same transition after Aldren actually reports to the player the explanation he heard from Holt. A report transfers only that information—it does not move the cart or establish Holt's compliance.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].
 
```

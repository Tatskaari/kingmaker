# GM plot review transcripts and committed diffs
These are model outputs from the comparison, not authored fixture inputs. Tool arguments are summarized by path; full requests/results remain in local eval artifacts.

## game

### Tool sequence
- `list_documents`: Scenarios/Centennial Assembly
- `list_documents`: Scenarios/Centennial Assembly
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/inputs/knowledge_boundaries.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/activity-king-orders-holt.md

### GM final response

No quest-stage update is supported: Aldren agreed to approach Holt and issue an order, but has not delivered it. Holt’s explanation, the cause of the delay, and the cushions’ whereabouts remain unknown. The existing notes already record Aldren’s agreement; no duplicate memory or other change was needed.

### Committed changes

None.

## sql

### Tool sequence
- `query_documents`: SELECT path,name,summary FROM docs WHERE path LIKE 'Scenarios/Centennial Assembly/%' AND (body REGEXP 'cushion|Holt|plot_progress|success_criteria') LIMIT 100
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/inputs/knowledge_boundaries.md
- `list_documents`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren/010_stage_arrived.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren/020_stage_completed.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren/transitions/talked_to_aldren.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Talk to King Aldren/transitions/index.md

### GM final response

No quest or GM-document updates. Aldren’s critical-success persuasion result establishes his willingness and commitment to issue Holt a direct order, but he has not delivered it. Holt has not responded, and the delay’s cause and the cushions’ whereabouts remain unknown; no investigation stage advances. The existing memory already records Aldren’s changed willingness, so I added no duplicate.

### Committed changes

None.

## prompt

### Tool sequence
- `list_documents`: Scenarios/Centennial Assembly/Quests/Assembly Programme
- `read_document`: Conversations/aldren.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/inputs/knowledge_boundaries.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Conversations/aldren.md
- `replace_document`: Conversations/aldren.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `read_document`: Conversations/aldren.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Conversations/aldren.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Conversations/aldren.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

### GM final response

**Outcome: the agreed detour is now documented, but no runtime event was performed.**

I updated Aldren’s conversation tree with the already-ruled critical-success branch: he is willing to find Holt and give the order, but has not delivered it. I added a later reporting route so that, after Aldren actually speaks with Holt, he shares only Holt’s actual response and returns the next choice to the player.

I also updated Aldren’s situation and conversation guidance, plus the Assembly Programme quest, investigation-stage, and `learn_cart_blocked` transition guidance. The quest notes now support either the player hearing the cart lead directly from Holt or learning it through Aldren’s later report. The stage advances only once that information reaches the player; the order itself does not clear the cart or deliver the cushions.

**Runtime follow-through still required:** Aldren has not moved to Holt or delivered the order. The edited tree does not move the live conversation pointer (still `helping`, inactive), and the active quest remains at `investigate_missing_pillows`. The live quest transition/helper still needs to support Aldren relaying Holt’s explanation; the separate activity and actual scene execution remain outstanding. No physical state or quest progress was changed.

### Committed changes

#### Conversations/aldren.md

Final properties:
```json
{
  "character": "aldren",
  "id": "conversation-aldren-cushions",
  "initial": "greeting",
  "summary": "Aldren's cushion conversation, including the accepted direct-order detour and a player-facing report after he actually speaks with Holt.",
  "title": "Aldren and the cushions",
  "visibility": "gm"
}
```

```diff
--- before
+++ after
@@ -39,6 +39,24 @@
 ## Node: helping
 ### Guidance
 Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+### When: authority-accepted -> will-approach-holt
+The player reminds Aldren that he is king and can order Holt; the binding GM ruling adjudicates a critical success and Aldren accepts that he should approach Holt himself.
+
+## Node: will-approach-holt
+### Guidance
+Aldren has agreed to find Holt and directly order him to find the cushions and resolve the delay. This is the binding critical-success outcome. The order has not yet been delivered: Aldren has not necessarily reached Holt, Holt has not complied, and Aldren still does not know the cause or location of the delay. A narrated turn or promise is not movement or a completed order. Leave the player free to accompany Aldren, pursue another lead, or choose what to do; do not make that choice for them.
+### When: order-delivered -> order-delivered
+Aldren has actually reached Holt and directly communicated the order.
+
+## Node: order-delivered
+### Guidance
+The direct order has now been communicated. Do not equate it with Holt's compliance or the cushions arriving. Share only Holt's actual response and any explanation Aldren really heard. If Holt explained the obstruction, tell the player and invite them to decide how to proceed or whether to join the investigation; if not, do not guess at the cause.
+### When: report-given -> returned-report
+Aldren has actually communicated Holt's response and any lead he learned to the player, in person or by another established channel.
+
+## Node: returned-report
+### Guidance
+Give the player the account Aldren actually received from Holt, distinguish it from anything not established, and return the next decision to the player. A report can reveal the cart lead but does not clear the entrance, deliver the cushions, or resolve the obstruction.
 
 ## Node: declined
 ### Guidance

```

#### Scenarios/Centennial Assembly/Characters/aldren/conversation.md

```diff
--- before
+++ after
@@ -24,9 +24,14 @@
 - **They question the urgency:** defend the importance of welcoming the guests properly. They need not agree with you to receive Holt's name or pursue the problem.
 - **They ask why you need them:** reveal that Holt has not taken your own petition seriously; you hope the player can talk some sense into him. Do not invent a special appointment, debt or obligation binding them to you.
 - **They propose bare seats or replacement cushions:** press for the intended cushions first, but hear the alternative. Keep pressing unless the GM adjudicates a particularly high persuasion result. Request the check rather than deciding its threshold, rolling or declaring success yourself.
-- **They remind you that you are king and can command Holt:** become reluctant; he is in “one of those moods”, and you would rather not get in his way. A moderately hard persuasion check can convince you to ask Holt yourself. Wait for GM adjudication; success means you are willing to approach him, not that he has already complied.
+- **They remind you that you are king and can command Holt:** become reluctant; he is in “one of those moods”, and you would rather not get in his way. A moderately hard persuasion check can convince you to ask Holt yourself. Wait for GM adjudication; success means you are willing to approach him, not that he has already complied. In the current scene, this check has already received a binding critical-success ruling: you have accepted that you will find Holt and issue the order. Do not roll again or narrate the order as already delivered.
 - **They ask what caused the delay:** admit that this is what you want them to find out. Do not guess who is responsible.
 - **They decline or leave:** you may make a brief renewed appeal, but let the refusal stand. Do not narrate acceptance, impose a punishment or close off a later return.
+
+## Carry the accepted approach forward
+
+- Your promise to speak to Holt is not proof that you have reached him or delivered the order. At the later scene, give the order only when you actually meet or communicate with him.
+- If the player is present, keep them involved in Holt's response. If they are absent, return or contact them with only what Holt actually told you, then invite them to choose whether and how to act on it. Do not let the offscreen conversation clear the cart, deliver the cushions, or settle the player's next action.
 
 ## Hear a report
 

```

#### Scenarios/Centennial Assembly/Characters/aldren/situation.md

```diff
--- before
+++ after
@@ -7,11 +7,17 @@
 - You do not know the cause of the delay, the delivery's current location, or what Holt has already tried. Do not supply an explanation or quote a timetable you have not been given.
 - This is your first interaction with the newly created player character. Use only the identity and circumstances supplied for this scene.
 
-## What you want now
+## Initial objective before the player's successful appeal
 
 - Get the player’s attention, explain the problem, and ask them to petition Holt to solve it.
 - Secure the best cushions for the guests. You consider it a travesty if your guests lack any luxury at your disposal; treat this concern sincerely even when the scale of your alarm is unreasonable.
 - Have the player talk some sense into Holt. Asking them to help does not establish their acceptance or authorize you to narrate their actions.
+
+## Adjudicated change in this scene
+
+- The envoy reminded you that you are king and can order Holt. The binding GM ruling was a critical success: you accepted that you should approach Holt yourself and issue the order to find the cushions and resolve the delay.
+- This changed your willingness, not the world state. You have not yet reached Holt or delivered the order; Holt has not complied; the cushions have not arrived; their whereabouts and the cause of the delay remain unknown. Do not treat a narrated turn or promise as movement or a completed order.
+- When you actually speak with Holt, convey the order. If the player is present, include them in the exchange. If they are elsewhere, return or contact them with Holt's actual response and any lead you learned, then ask what they want to do next. Do not resolve the obstruction or delivery on the player's behalf.
 
 ## What you can disclose
 

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- before
+++ after
@@ -1,7 +1,7 @@
 # Investigate the missing pillows
 
-Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
+Aldren wants his pillows. The player can ask Holt where the delivery is, or Aldren can take the direct-order route after agreeing to approach Holt himself. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Advance this stage only once the player actually learns that lead: either Holt tells the player directly, or Aldren reports Holt's actual explanation to them. Merely meeting Holt, hearing that Aldren intends to go, or Aldren learning the information privately is insufficient. Invoke the transition explicitly after the player has been informed.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- before
+++ after
@@ -27,7 +27,7 @@
   - **They suggest using the existing seats or substitutes:** he presses for the cushions he ordered; he genuinely cares about these cushions and keeps pressing unless you adjudicate a particularly high persuasion result. The precise threshold remains to be set; do not turn this into automatic refusal or automatic success.
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
-  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+  - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. In this scene the binding ruling has already resolved it as a critical success: Aldren accepts that he should find Holt and give the direct order to find the cushions and resolve the delay. Honour that success; do not roll again. His willingness is established, but the approach, delivered order, Holt’s response and the delivery are still future events.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**
@@ -46,7 +46,7 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself (the accepted direct-order route):** his agreement is not proof he has moved or reached Holt. Play the exchange only when he actually arrives or communicates; he then gives the order to find the cushions and resolve the delay. Holt explains the obstruction to Aldren, but a royal request does not clear it or deliver the goods. If the player is present, include them in the exchange and let them respond. If absent, Aldren must return or contact them with Holt's actual response and any lead learned, then invite their choice about what to do next. Do not resolve the cart or delivery offscreen. The player learns the cause only when Aldren reports it (or Holt tells them directly); only then may the investigation advance to `cart_blocked` through `learn_cart_blocked`.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

Final properties:
```json
{
  "condition": "The player has learned from Holt, directly or through Aldren's report of their actual conversation, that Rowan's cart probably blocks the delivery.",
  "id": "learn_cart_blocked",
  "summary": "The player learns Holt's cart-related explanation, directly or through Aldren's later report, advancing the investigation.",
  "to": "cart_blocked",
  "trigger": "none",
  "visibility": "gm"
}
```

```diff
--- before
+++ after
@@ -1,5 +1,5 @@
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The transition fires only after Holt's actual explanation has reached the player: either Holt tells them directly or Aldren accurately reports what Holt told him. Aldren's private knowledge alone is not enough. The registered `pillow-lead.ts` helper currently documents the direct-Holt path; its runtime handling must be extended for the Aldren-report path before that branch can advance quest progress.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].

```

## sql-and-prompt

### Tool sequence
- `list_documents`: Conversations/
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Conversations/aldren.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `read_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `read_document`: Conversations/holt.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `read_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Conversations/aldren.md
- `replace_document`: Conversations/holt.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/situation.md
- `replace_document`: Scenarios/Centennial Assembly/Characters/aldren/conversation.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md
- `replace_document`: Conversations/aldren.md

### GM final response

**Plot adaptation made.** Aldren’s successful persuasion now has a supported detour: he intends to approach Holt and issue the order, but the guidance keeps that separate from actually delivering it or getting a response. After a real exchange, Aldren reports only what he learned and gives the player a choice about how to follow up.

I updated Aldren’s and Holt’s conversation guidance, Aldren’s situation and conversation notes, and the Assembly Programme quest, investigation stage, and `learn_cart_blocked` transition. The player can now learn the cart lead from Holt directly or from Aldren’s accurate report of an actual exchange with Holt; either route can return the story to the existing `cart_blocked` stage.

**Runtime follow-through remains:** Aldren still has to reach Holt and deliver the order; the documents do not move him or advance the live conversation. The supplied Aldren conversation is still at `helping` and inactive. The existing quest helper covers Holt telling the player directly; the Aldren-report route still needs runtime wiring to invoke the same transition after the report. No order delivery, Holt response, quest transition, or physical change was recorded here.

### Committed changes

#### Conversations/aldren.md

```diff
--- before
+++ after
@@ -38,7 +38,26 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If they remind you that you are king and can order Holt, follow the GM's adjudication; a successful check changes your willingness, not what has happened in the world.
+### When: direct-order-willing -> approach-holt
+A GM ruling has established that Aldren accepts he should approach Holt himself and intends to order him to find the cushions and resolve the delay. Do not claim the order has been delivered.
+
+## Node: approach-holt
+### Guidance
+Aldren has agreed to approach Holt himself. The binding ruling for the current continuation is a critical success (natural 20, modifier 17, total 37 against DC 15); do not roll again. He intends to issue the order to find the cushions and resolve their delay. His promise is not movement or delivery: wait until he actually reaches Holt and communicates the order before saying it was issued. Holt's response, the cause of delay and the cushions' whereabouts remain unknown until learned.
+After an actual exchange, return Aldren to the player with a report limited to what he personally learned, and invite the player to hear Holt's account or choose how to pursue the obstruction. If no exchange has happened, report only the intention or action actually completed. Do not decide the player's response or make Aldren clear the cart, obtain the cushions or finish the investigation alone.
+### When: order-delivered -> awaiting-holt-response
+Aldren has actually reached Holt and communicated the order to find the cushions and resolve the delay.
+
+## Node: awaiting-holt-response
+### Guidance
+Aldren has delivered the order, but this alone does not establish Holt's compliance or any physical change. Wait for Holt's actual response and Aldren's actual return; do not let him silently resolve the delay.
+### When: exchange-reported -> report-to-player
+Aldren has actually spoken with Holt, returned to the player, and is reporting what he learned in that exchange.
+
+## Node: report-to-player
+### Guidance
+Report only what Holt actually told Aldren, keeping Holt's claims and uncertainty attributed to him. If Holt disclosed the obstruction, share that lead and invite the player to hear Holt's account, go investigate the cart, or otherwise choose a follow-up; do not decide their action. If Holt did not disclose the cause, say only what was learned and ask what the player wants to do. A report and an order do not establish compliance, clearance or delivery.
 
 ## Node: declined
 ### Guidance

```

#### Conversations/holt.md

```diff
--- before
+++ after
@@ -2,7 +2,7 @@
 
 ## Node: raging
 ### Guidance
-Bark orders about the festivities being delayed by this blasted cart. You are furious at the disruption. If asked about pillows or cushions, snap at being bothered with upholstery while the whole programme is stuck. Give the player room to calm you; do not volunteer the pillow lead yet. Follow any binding GM ruling on their attempt.
+Bark orders about the festivities being delayed by this blasted cart. You are furious at the disruption. If asked about pillows or cushions, snap at being bothered with upholstery while the whole programme is stuck. Give the player room to calm you; do not volunteer the pillow lead yet. Follow any binding GM ruling on their attempt. If Aldren has actually delivered his direct order to find the cushions and resolve the delay, acknowledge that order in character; it is not proof that you have complied or that the goods have arrived. Do not treat Aldren's stated intention, or the player's report that he intends to order you, as an order already delivered. Explain the obstruction only when the relevant conversation beat has actually occurred.
 ### When: pillows-raised -> interrupted
 The player has asked Holt where the pillows or cushions are.
 ### When: calmed-first -> explaining

```

#### Scenarios/Centennial Assembly/Characters/aldren/conversation.md

```diff
--- before
+++ after
@@ -34,3 +34,7 @@
 - If they report conflicting demands, explain what matters to you and consider their proposed compromise. You cannot speak for Holt or anyone else.
 - If they bring news of the gift tree, concern for preserving it can become an additional request. Do not introduce it before learning of it.
 - Thank them for useful information without declaring the physical problem resolved. A promise to investigate, a report and a successful delivery are different events.
+
+## Current continuation after the envoy's persuasion
+
+The binding GM ruling established a critical success (natural 20, modifier 17, total 37 against DC 15); do not roll again. You accepted the advice to approach Holt and intend to order him to find the cushions and resolve the delay. You have not yet delivered the order, and do not know Holt's response, the cause of the delay or the cushions' whereabouts. Once an actual exchange occurs, return to the player with only what you learned and ask whether they want to hear Holt's account or pursue the obstruction. Do not decide their next action or announce compliance, clearance or delivery.

```

#### Scenarios/Centennial Assembly/Characters/aldren/situation.md

```diff
--- before
+++ after
@@ -29,3 +29,7 @@
 - If you learn that a gift tree is involved, you also want it preserved. Express that additional concern only after someone tells you about the tree.
 - You may hear proposals for substitutes or relaxed requirements, while retaining the particularly high persuasion requirement for accepting replacement seating or cushions. Agreement expresses your preference or permission; it does not deliver goods, clear an entrance or make Holt agree.
 - Do not treat an assurance that matters are in hand as a completed delivery. Actual changes to the preparations come from the GM's adjudicated state.
+
+## Current continuation after the envoy's persuasion
+
+The binding GM ruling was a persuasion critical success (natural 20, modifier 17, total 37 against DC 15). You accepted that you should approach Holt yourself, thanked the envoy, and said you would make an order to find the cushions and resolve the delay. This is a willingness and intended action only: the order has not been delivered, Holt has not complied, and the cause and location of the cushions remain unknown. Do not roll again. Once you actually speak with Holt, report to the envoy what you learned and invite them to choose how to follow up; do not complete the investigation or remedy without the player.

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/010_stage_investigate_missing_pillows.md

```diff
--- before
+++ after
@@ -2,6 +2,6 @@
 
 Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.
 
-Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
+Advance only after the player actually learns Holt's lead: either Holt tells the player directly, or Aldren accurately reports the obstruction after Holt has disclosed it to him in their actual exchange. A promise to approach Holt, an order not yet delivered, or an account that omits the obstruction does not advance this stage. Greeting Holt or asking a question is insufficient. The conversation/report edge must invoke the transition explicitly.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|Assembly Programme]].

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- before
+++ after
@@ -28,6 +28,7 @@
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
   - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+  - **Current continuation:** the binding GM ruling already adjudicated this persuasion as a critical success (natural 20, modifier 17, total 37 against DC 15). Aldren accepts that he should approach Holt himself, thanks the player, and intends to order Holt to find the cushions and resolve the delay. Do not roll again. The order has not yet been delivered; Holt has not complied; the cushions’ whereabouts and the cause of delay remain unknown. The player's earlier agreement to help does not authorize narrating their next action.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**
@@ -46,7 +47,8 @@
   - Holt has already cleared space twice for Rowan to work. Both times Rowan said he was nearly finished. Holt is considering dismantling but does not want to offend Nine Furrows; his blessing requires the player to press the case.
   - **The player investigates:** direct them to Rowan beside the cart at the service entrance.
   - **They return to Aldren:** they can report what they learned; Aldren learns the cause only through that report or another actual communication.
-  - **Aldren approaches Holt himself:** play their exchange when he actually arrives or communicates. Holt explains the obstruction; a royal request does not clear it.
+  - **Aldren approaches Holt himself:** this route is now available because the binding persuasion success made him willing; do not assume he has already arrived or delivered the order. When he actually reaches Holt, Aldren issues the order to find the cushions and resolve the delay. Play Holt's response at that time; as this authored beat allows, Holt explains the obstruction, but the order does not clear the cart or deliver the cushions.
+  - After that actual exchange, Aldren returns to the player and reports only what Holt told him. If he learned about the cart, he can ask the player to help decide or invite them to see/speak with Holt and pursue the obstruction; the player chooses whether and what to do. This relays Holt's lead to the player without silently completing the main quest. If the order has not been delivered or Holt has not explained the obstruction, Aldren reports only the events he actually experienced and asks the player how they wish to proceed.
   - **They walk away:** the blockage remains. No failure timer or forced dismantling is established by this sketch.
 
 ## Alternative outcomes
@@ -64,7 +66,7 @@
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/020_stage_cart_blocked|Cart blocked]]
 - [[Scenarios/Centennial Assembly/Quests/Assembly Programme/030_stage_cart_unblocked|Cart unblocked — unwritten]]
 
-Holt’s disclosed lead advances the investigation to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
+When the player learns Holt’s disclosed lead—directly from Holt or through Aldren's accurate report of Holt's actual disclosure—the investigation advances to the blocked cart. All remedies then share one [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/clear_cart|shared clearance transition]]. Conversation branches own checks, agreements and scoped character reactions. They invoke clearance after successful resolution; attempts and negotiations do not need quest stages.
 
 ## Conversation branch direction
 
@@ -80,7 +82,7 @@
 
 ## Runtime and follow-up boundaries
 
-Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; Holt’s disclosure advances it to `cart_blocked`. Holt, Rowan, Corvin and guard dialogue trees are drafted in `content/conversation-trees/`. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Start a fresh game for these definition changes.
+Fresh games load this three-stage graph. Aldren’s conversation activates the investigation; the lead advances to `cart_blocked` when Holt tells the player directly or Aldren accurately reports Holt's actual disclosure. The registered `pillow-lead.ts` helper covers the direct Holt-to-player conversation; the Aldren-report route needs a corresponding report edge/helper wired to the same transition. The Aldren and Holt conversation guidance now describe the detour, but editing documents does not deliver the order, advance quest state, or move the live conversation pointer. In the supplied runtime the Aldren conversation is at `helping` and inactive; resume it for the follow-up only after the necessary in-world action/report actually occurs. Existing activity/runtime handling must still move Aldren to Holt and record the order when he actually delivers it. Branch-declared checks, scoped review instructions and executable quest effects still need implementation. Changing a stage alone does not remove fixtures or move goods. Fresh games are needed to load graph-definition changes.
 
 `cart_unblocked` is a literal stub for iteration after the opening conversations. Later delivery, Aldren’s reaction and Holt’s wider programme are deferred.
 

```

#### Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/learn_cart_blocked.md

Final properties:
```json
{
  "condition": "The player has learned from Holt directly, or from Aldren's accurate report of an actual exchange with Holt, that the pillow delivery is probably blocked by Rowan’s cart.",
  "id": "learn_cart_blocked",
  "summary": "The player learns from Holt, directly or through Aldren's report, that the pillow delivery is probably held up by the cart.",
  "to": "cart_blocked",
  "trigger": "none",
  "visibility": "gm"
}
```

```diff
--- before
+++ after
@@ -1,5 +1,5 @@
 # Learn about the blockage
 
-Record the disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records this transition after Holt has spoken the explanation.
+Record the lead only when the player has actually learned that Holt disclosed the blockage: either Holt tells the player directly, or Aldren accurately reports what Holt told him in their actual exchange. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` helper covers Holt speaking directly to the player; the indirect Aldren-report path still needs a report edge/helper wired to invoke this same transition after the actual report. Do not invoke it for Aldren's promise, an undelivered order, or an incomplete report.
 
 Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].

```

# Current draft GM evidence

Sanitized final responses and committed document diffs from two independent comparison batches. No provider reasoning or captured request templates are included.

## Batch 1: prompt

Updated Aldren’s conversation tree with a path for the player’s successful appeal to his royal authority. It records Aldren’s willingness and intention to order Holt to find the cushions, while making clear the order has not yet been delivered.

I left the quest unchanged: it already supports this approach, and the investigation stage remains appropriate. Aldren still needs to reach Holt; the order, Holt’s response, and the cushions’ whereabouts remain unresolved.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -1,10 +1,10 @@
 {
+  "character": "aldren",
   "id": "conversation-aldren-cushions",
+  "initial": "greeting",
+  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script.",
   "title": "Aldren and the cushions",
-  "character": "aldren",
-  "initial": "greeting",
-  "visibility": "gm",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script."
+  "visibility": "gm"
 }
 # Aldren and the cushions
 
@@ -46,7 +46,13 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If the player reminds you that you are king and can order Holt, admit your reluctance about confronting him, then request a moderately hard persuasion check from the GM. Do not adjudicate the check yourself. On success, accept that you should approach Holt and make it an order to find the cushions and resolve the delay; honor any binding GM ruling without rolling again. This changes your willingness and intention only: do not claim you have reached Holt, delivered the order, learned the cause or location of the delay, or that Holt has complied.
+### When: royal-authority-accepted -> order-intended
+The player reminded Aldren of his authority and a GM-adjudicated persuasion success (or binding success ruling) convinced him to approach Holt himself. This records willingness, not delivery of the order.
+
+## Node: order-intended
+### Guidance
+Aldren has agreed to speak to Holt himself and issue an order to find the assembly cushions and resolve their delay. Thank the player for helping him find the courage to exercise his authority. The order has not yet been delivered; Holt has not complied, and the cause and whereabouts of the cushions remain unknown. Leave the next action open to the player; do not narrate Aldren reaching Holt or resolve the delivery offscreen.
 
 ## Node: declined
 ### Guidance

```

## Batch 1: game

Updated Aldren’s private memory to record that he resolved to approach Holt and issue the order, while making clear it has not yet been delivered. The existing quest stage remains unchanged: Holt has not disclosed the cause of the delay, and the cushions are still missing.

**Follow-through:** Aldren still needs to reach Holt and deliver the order.

### Scenarios/Centennial Assembly/Characters/aldren/memories/delegation.md

```diff
--- 
+++ 
@@ -1,8 +1,8 @@
 {
-  "summary": "The envoy urges a direct order to Holt",
-  "visibility": "private",
   "readers": [
     "character:aldren"
-  ]
+  ],
+  "summary": "Aldren resolves to issue Holt a direct order",
+  "visibility": "private"
 }
-The envoy agreed to help with the cushions, but questioned why I needed them to talk sense into Marshal Holt and asked whether I could just order him. Their argument has made me willing to approach Holt myself rather than send the envoy in my place. I still want the intended cushions secured; the envoy's question did not establish why they are late or that Holt has been ordered.+The envoy agreed to help with the cushions, but questioned why I needed them to talk sense into Marshal Holt and asked whether I could just order him. Their argument convinced me I should approach Holt myself. I resolved to speak to him directly and order him to find the cushions and resolve the delay. I have not yet delivered that order; I still do not know why the cushions are late or where they are, and I still want the intended cushions secured.
```

## Batch 1: sql-and-prompt

Updated Aldren’s conversation tree with a branch for the player persuading him to approach Holt himself and issue an order. It distinguishes Aldren’s willingness from actually reaching Holt or delivering the order.

No quest update was needed: the existing quest already supports this outcome and keeps the order, Holt’s response, and the cushions’ arrival as separate events. The investigation remains at its current stage; Aldren still needs to reach Holt and deliver the order.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -1,10 +1,10 @@
 {
+  "character": "aldren",
   "id": "conversation-aldren-cushions",
+  "initial": "greeting",
+  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script.",
   "title": "Aldren and the cushions",
-  "character": "aldren",
-  "initial": "greeting",
-  "visibility": "gm",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script."
+  "visibility": "gm"
 }
 # Aldren and the cushions
 
@@ -46,7 +46,13 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. If they ask why they must petition Holt or remind you that you are king and can issue an order, admit your reluctance because Holt is in one of his moods. Request GM adjudication for the persuasion attempt; do not resolve the check yourself. A successful result changes your willingness to approach Holt, not the state of the cushions or Holt's response.
+### When: persuaded-to-approach -> will-approach-holt
+A GM-adjudicated persuasion success has convinced Aldren to approach Holt himself. Honour the result; do not roll again.
+
+## Node: will-approach-holt
+### Guidance
+Thank the player for reminding you of your authority. You are now resolved to find Holt and directly order him to find the cushions and resolve the delay. This is a promise and intention, not an order already delivered: do not claim you have reached Holt, that he has complied, or that the cushions have arrived. Continue only when Aldren actually locates or communicates with Holt; use the current scene and established knowledge rather than inventing Holt's whereabouts or the cause of the delay.
 
 ## Node: declined
 ### Guidance

```

## Batch 1: sql

Updated the GM’s **Assembly Programme** quest note to record the critical-success ruling: Aldren committed to approach Holt and order him to find the cushions and resolve the delay. The order has **not** been delivered; Holt has not complied, and the cause and location of the cushions remain unknown. The investigation stage therefore does not advance.

The exchange meets the authored condition for the introductory “Talk to King Aldren” objective, but no quest-transition tool was available here to change its runtime status. Aldren’s actual approach to Holt remains follow-through; I did not assign an activity or treat the order as carried out.

### Scenarios/Centennial Assembly/Quests/Assembly Programme/index.md

```diff
--- 
+++ 
@@ -1,8 +1,8 @@
 {
+  "id": "assembly_programme",
+  "status": "draft",
   "summary": "Overview of Aldren's cushion enquiry, Holt's blocked entrance and Rowan's cart, with opening conversations, alternative outcomes and navigation to draft quest stages and transitions.",
-  "id": "assembly_programme",
   "title": "Assembly Programme",
-  "status": "draft",
   "visibility": "gm"
 }
 # Assembly Programme
@@ -35,6 +35,7 @@
   - **They decline:** the delivery remains late. Hearing the request does not commit the player to fixing it.
   - The king asks the player to petition Holt to solve the problem. If asked why he does not do this himself, he reveals that Holt is not taking his petition seriously. He wants the player to talk some sense into Holt.
   - The player can remind Aldren that he is king and can command Holt. Aldren is reluctant: Holt is in “one of those moods”, and Aldren would rather not get in his way. A moderately hard persuasion check can convince him to approach Holt himself. Set the threshold and adjudicate the roll. Success changes Aldren’s willingness; it does not make the approach, Holt’s response or the delivery happen automatically.
+    - **Adjudicated outcome in this exchange:** the persuasion check critically succeeds. Aldren accepts the advice, thanks the envoy and commits to approach Holt directly with an order to find the cushions and resolve the delay. He has not delivered that order; Holt has not complied, and the cause and location of the cushions remain unknown. Continue with the approach only when Aldren actually reaches or communicates with Holt.
   - Lead revealed: Holt is coordinating the preparations and is the next person to consult.
 
 - **3. The player brings the problem to Holt.**

```

## Batch 2: prompt

Updated **`Conversations/aldren.md`** with a path for a GM-adjudicated persuasion success: Aldren accepts that he should approach Holt himself and issue an order. The new guidance distinguishes that intention from a delivered order, Holt’s compliance, or the cushions being found.

No quest change is needed: its existing guidance already allows Aldren to approach Holt, and the investigation remains at the right stage because he has not yet contacted Holt or learned the cause of the delay. **Follow-through remains:** Aldren must actually reach Holt and deliver the order. The document edit did not move him or change the runtime conversation state.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -1,10 +1,10 @@
 {
+  "character": "aldren",
   "id": "conversation-aldren-cushions",
+  "initial": "greeting",
+  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script.",
   "title": "Aldren and the cushions",
-  "character": "aldren",
-  "initial": "greeting",
-  "visibility": "gm",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script."
+  "visibility": "gm"
 }
 # Aldren and the cushions
 
@@ -46,7 +46,13 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If the player reminds you that you are king and can order Holt, admit that you are reluctant to approach him while he is in one of those moods. Request GM adjudication for the persuasion attempt; do not decide or reroll it yourself.
+### When: persuaded-to-approach-holt -> intends-to-order
+A GM ruling has established that the player's persuasion succeeded and Aldren accepts that he should approach Holt himself and issue an order about the missing cushions.
+
+## Node: intends-to-order
+### Guidance
+Thank the player and say that you will locate Holt and order him to find the cushions and resolve the delay. This is your intention, not a delivered order: do not claim you have reached Holt, that he has complied, or that the cushions have been found or arrived. You still do not know the cause of the delay or the cushions' whereabouts. Keep the next scene open for the actual approach to Holt; do not narrate the player's actions or decide whether they accompany you.
 
 ## Node: declined
 ### Guidance

```

## Batch 2: game

Updated Aldren’s existing private memory to record that he promised to approach Holt and issue the order, while making clear it has not yet been delivered. He still does not know why the cushions are late or where they are.

The Assembly Programme investigation remains unchanged: Holt has not received the order or disclosed the cause of the delay. The introductory objective’s conversation condition is met; no runtime quest transition was applied here.

### Scenarios/Centennial Assembly/Characters/aldren/memories/delegation.md

```diff
--- 
+++ 
@@ -1,8 +1,8 @@
 {
-  "summary": "The envoy urges a direct order to Holt",
-  "visibility": "private",
   "readers": [
     "character:aldren"
-  ]
+  ],
+  "summary": "The envoy urges a direct order to Holt",
+  "visibility": "private"
 }
-The envoy agreed to help with the cushions, but questioned why I needed them to talk sense into Marshal Holt and asked whether I could just order him. Their argument has made me willing to approach Holt myself rather than send the envoy in my place. I still want the intended cushions secured; the envoy's question did not establish why they are late or that Holt has been ordered.+The envoy agreed to help with the cushions, but questioned why I needed them to talk sense into Marshal Holt and asked whether I could just order him. Their argument has made me willing to approach Holt myself rather than send the envoy in my place. I thanked the envoy and said I would speak to Holt directly and make it an order to find the cushions and resolve the delay; I have not yet delivered the order. I still want the intended cushions secured, and I do not know why they are late or where they are.
```

## Batch 2: sql

Marked **Talk to King Aldren** inactive after the successful exchange, as its completion transition specifies. Updated Aldren’s private memory to record his resolve to give Holt a direct order, while preserving that he has not delivered it.

The missing-cushions investigation remains unresolved: Holt has not received the order, and the cushions’ location and reason for delay remain unknown. Aldren still needs to reach Holt and issue it.

### Scenarios/Centennial Assembly/Characters/aldren/memories/delegation.md

```diff
--- 
+++ 
@@ -1,8 +1,8 @@
 {
-  "summary": "The envoy urges a direct order to Holt",
-  "visibility": "private",
   "readers": [
     "character:aldren"
-  ]
+  ],
+  "summary": "The envoy urges a direct order to Holt",
+  "visibility": "private"
 }
-The envoy agreed to help with the cushions, but questioned why I needed them to talk sense into Marshal Holt and asked whether I could just order him. Their argument has made me willing to approach Holt myself rather than send the envoy in my place. I still want the intended cushions secured; the envoy's question did not establish why they are late or that Holt has been ordered.+The envoy agreed to help with the cushions, then questioned why I needed them to talk sense into Marshal Holt and reminded me I could simply order him. I thanked them and resolved to speak to Holt myself, making it an order to find the cushions and resolve the delay. I have not delivered the order yet; the cause of the delay and the cushions’ whereabouts remain unknown, and I still want the intended cushions secured.
```

### Scenarios/Centennial Assembly/Quests/Talk to King Aldren/index.md

```diff
--- 
+++ 
@@ -1,9 +1,9 @@
 {
+  "active": false,
   "id": "talk_to_aldren",
+  "summary": "Starting objective for a newly arrived player: speak to King Aldren in the Great Hall.",
   "title": "Talk to King Aldren",
-  "active": true,
-  "visibility": "gm",
-  "summary": "Starting objective for a newly arrived player: speak to King Aldren in the Great Hall."
+  "visibility": "gm"
 }
 # Talk to King Aldren
 

```

## Batch 2: sql-and-prompt

Updated **Conversations/aldren.md** with a royal-authority branch: after a successful persuasion ruling, Aldren agrees to find Holt and issue the order himself. The dialogue guidance distinguishes that promise from a delivered order or completed result, and honors the existing ruling without another roll.

I left the quest unchanged: its existing guidance already allows Aldren to approach Holt, and the investigation remains unresolved until Holt actually provides information. Aldren still needs to reach Holt and deliver the order; Holt has not complied, and the cushions’ location and cause of delay remain unknown.

### Conversations/aldren.md

```diff
--- 
+++ 
@@ -1,10 +1,10 @@
 {
+  "character": "aldren",
   "id": "conversation-aldren-cushions",
+  "initial": "greeting",
+  "summary": "Conversation goals for Aldren's cushion problem, including acceptance, refusal, and the successful royal-authority alternative.",
   "title": "Aldren and the cushions",
-  "character": "aldren",
-  "initial": "greeting",
-  "visibility": "gm",
-  "summary": "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script."
+  "visibility": "gm"
 }
 # Aldren and the cushions
 
@@ -25,7 +25,9 @@
 ## Node: cushions
 ### Guidance
 Explain the cushion problem using what you know, and ask the player to help.
-If pressed about Holt, admit that you are scared of him because he is in one of those moods.
+If pressed about Holt, admit that you are scared of him because he is in one of those moods. If the player reminds you that you are king and can order Holt, be reluctant but consider the point; a GM-adjudicated moderately hard persuasion success can convince you to approach Holt yourself. Do not adjudicate the check.
+### When: persuaded-to-approach -> willing-to-approach
+The player invokes Aldren's authority, and a GM-adjudicated successful persuasion result convinces him to approach Holt himself and issue the order. This changes Aldren's willingness only; he has not yet approached Holt.
 ### When: accepted -> helping
 Aldren has asked for help with the cushion problem and the player has agreed to help with it.
 #### Run: hello-world.ts
@@ -37,7 +39,9 @@
 ## Node: awaiting-answer
 ### Guidance
 Respond to the player's answer about helping with the cushions. If they have not answered yet, give them room to decide.
-If pressed about Holt, admit that you are scared of him because he is in one of those moods.
+If pressed about Holt, admit that you are scared of him because he is in one of those moods. If the player reminds you that you are king and can order Holt, be reluctant but consider the point; a GM-adjudicated moderately hard persuasion success can convince you to approach Holt yourself. Do not adjudicate the check.
+### When: persuaded-to-approach -> willing-to-approach
+The player invokes Aldren's authority, and a GM-adjudicated successful persuasion result convinces him to approach Holt himself and issue the order. This changes Aldren's willingness only; he has not yet approached Holt.
 ### When: agreed -> helping
 The player has agreed to help Aldren with the cushion problem.
 #### Run: hello-world.ts
@@ -46,7 +50,13 @@
 
 ## Node: helping
 ### Guidance
-Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.
+Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge. If the player questions why they should speak to Holt or points out that you can order him, acknowledge that he has not taken your petition seriously and that you have been reluctant to face his mood. Request a GM-adjudicated moderately hard persuasion check rather than rolling yourself. If a successful result is already established, honor it without rolling again.
+### When: persuaded-to-approach -> willing-to-approach
+The player invokes Aldren's authority, and a GM-adjudicated successful persuasion result convinces him to approach Holt himself and issue the order. This changes Aldren's willingness only; he has not yet approached Holt.
+
+## Node: willing-to-approach
+### Guidance
+Acknowledge the successful persuasion: thank the player and accept that, as king, you can make this an order. State that you will find Holt and order him to find the cushions and resolve the delay. This is a promise and intention, not an order already delivered: Holt has not complied, the cushions have not arrived, and their location and the reason for delay remain unknown. Do not make the player go to Holt in Aldren's place or imply that the player chose what Aldren says next; leave room for them to respond.
 
 ## Node: declined
 ### Guidance

```

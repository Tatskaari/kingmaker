import assert from "node:assert/strict";
import test from "node:test";
import { classifyConversationExpression, portraitExpressions } from "../packages/providers/src/conversation-expression.js";
import { JevClient } from "../packages/providers/src/jev.js";


const input = { characterId: "corvin", history: [{ speakerId: "player", text: "A joke." }, { speakerId: "corvin", text: "Ha!" }] };
test("Jev selects each supported expression using the conversation and portrait subject", async () => {
  for (const expression of Object.keys(portraitExpressions)) {
    const client = new JevClient("test-key", async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request.state, input);
      assert.deepEqual(request.questions.next.criteria, portraitExpressions);
      return Response.json({ answers: { next: { type: "choice", choice: expression,
        probabilities: Object.fromEntries(Object.keys(portraitExpressions).map(key => [key, key === expression ? 1 : 0])) } } });
    });
    assert.equal((await classifyConversationExpression(client, input, new AbortController().signal)).expression, expression);
  }
  const invalid = new JevClient("test-key", async () => Response.json({ answers: {} }));
  await assert.rejects(classifyConversationExpression(invalid, input, new AbortController().signal), /invalid or unavailable/);
  await assert.rejects(classifyConversationExpression(invalid, input, AbortSignal.abort()), { name: "AbortError" });
});

test("recent displayed portraits reach Jev with guidance to reconsider repeated expressions", async () => {
  const recentPortraits = ["amused", "amused", "amused"] as const;
  const client = new JevClient("test-key", async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.state.recentPortraits, recentPortraits);
    assert.match(request.questions.next.instructions, /last three or more are identical/);
    assert.match(request.questions.next.instructions, /Do not invent an emotion solely for variety/);
    return Response.json({ answers: { next: { type: "choice", choice: "neutral", probabilities: Object.fromEntries(Object.keys(portraitExpressions).map(key => [key, key === "neutral" ? 1 : 0])) } } });
  });
  assert.equal((await classifyConversationExpression(client, { ...input, recentPortraits }, new AbortController().signal)).expression, "neutral");
});

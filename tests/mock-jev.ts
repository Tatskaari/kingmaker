import type { TestContext } from "node:test";
import { JevClient } from "../packages/providers/src/jev.js";

/** Stub the Decisions transport boundary while keeping individual criteria assertions. */
export function mockJevChoice(t: TestContext, choose: JevClient["choose"]) {
  return t.mock.method(JevClient.prototype, "evaluate", async (...[state, questions, signal]: Parameters<JevClient["evaluate"]>) =>
    Object.fromEntries(await Promise.all(Object.entries(questions).map(async ([id, question]) =>
      [id, await choose(state, question.instructions, question.criteria, signal)]))));
}

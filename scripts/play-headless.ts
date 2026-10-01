import { jevWorldEvalScenarios } from "../evals/jev/scenarios.js";
import { HeadlessSession } from "../packages/headless/src/index.js";

// Edit this TypeScript program to choose actions from each returned observation.
const session = new HeadlessSession(jevWorldEvalScenarios[0]!, { level: 1, includeRecentResults: true });
console.log(session.observe());
console.log(session.act("open_treasury_door_0"));
console.log(session.act("enter_treasury"));
const closeDoor = Object.keys(session.observe().choices).find(id => id.startsWith("close_treasury_door"));
if (!closeDoor) throw new Error("Expected to be able to close the Treasury door from inside.");
console.log(session.act(closeDoor));
console.log(session.act("wait"));
console.log(session.result());

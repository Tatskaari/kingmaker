/**
 * Places generated from a description (README.md): the model writes a semantic plan (tersely, and
 * streamed), a deterministic compiler lays it out on 5-ft tiles, validators check it as the game
 * will draw it, and what's wrong goes back to the model, at most twice.
 *
 *   const { ok, place, problems } = await generatePlace("a chandler's shop on the wharves...", { id: "chandler", sceneId: "chandler", cast });
 *   installPlace(place!, { present: ["kell"], time: "evening" });     // the game uses it like a hand-made place
 *
 * Offline: compilePlan(plan, { id }) and validate(place) need no model; sketch(place) is a plain
 * top-down view; picture(stageCompiled(place), "scene", "night") draws it with render.ts.
 */

export { generatePlace, type Generated, type GenerateOptions, type Round } from "./generate.ts";
export { compilePlan, compileShell, feetOf, type CompiledPlace, type CompileOptions, type Shell } from "./compile.ts";
export { validate, errorsOf, sceneCamera } from "./validate.ts";
export { liftOf, rowsOf, type Camera } from "./camera.ts";
export { installPlace, uninstallPlace, type InstallOptions } from "./install.ts";
export { modelPlanner, castMember, PLAN_SCHEMA, PLAN_INSTRUCTIONS, type CastMember, type PlacePlan, type Planner, type PlanRequest, type RoomPlan, type ThingPlan, type DoorPlan, type OutsidePlan, type PersonPlan } from "./plan.ts";
export { COMPACT_SCHEMA, COMPACT_INSTRUCTIONS, readPlace, writePlace, partialPlan, type CompactPlan, type Stage } from "./compact.ts";
export { normalizePlan, type Problem } from "./normalize.ts";
export { peopleLooks, registerPeople, unregisterPeople, type PersonLook } from "./people.ts";
export { inventLooks, inventThings, unknownNames, type LookSpend } from "./looks.ts";
export { sketch } from "./sketch.ts";
export { picture, stageCompiled, stageHandMade, fitView, writePicture, type Staged, type View } from "./pictures.ts";
export { dressingOf, stagePicture } from "./dressing.ts";

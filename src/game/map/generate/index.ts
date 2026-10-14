/**
 * Places generated from a description (README.md): the model writes a semantic plan, a
 * deterministic compiler lays it out on 5-ft tiles, validators check it as the game will use it,
 * and what's wrong goes back to the model, at most twice.
 *
 *   const { ok, place, problems } = await generatePlace("a chandler's shop on the wharves...", { id: "chandler", sceneId: "chandler" });
 *   installPlace(place!, { present: ["kell"], time: "evening" });     // the game uses it like a hand-made place
 *
 * Offline: compilePlan(plan, { id }) and validate(place) need no model; sketch(place) is a plain
 * top-down view; picture(stageCompiled(place), "scene", "night") draws it with render.ts.
 */

export { generatePlace, type Generated, type GenerateOptions, type Round } from "./generate.ts";
export { compilePlan, feetOf, type CompiledPlace, type CompileOptions } from "./compile.ts";
export { validate, errorsOf, sceneCamera } from "./validate.ts";
export { installPlace, uninstallPlace, type InstallOptions } from "./install.ts";
export { modelPlanner, PLAN_SCHEMA, PLAN_INSTRUCTIONS, type PlacePlan, type Planner, type RoomPlan, type ThingPlan, type DoorPlan, type OutsidePlan, type PersonPlan } from "./plan.ts";
export { normalizePlan, type Problem } from "./normalize.ts";
export { sketch } from "./sketch.ts";
export { picture, stageCompiled, stageHandMade, fitView, writePicture, type Staged, type View } from "./pictures.ts";
export { dressingOf, stagePicture } from "./dressing.ts";

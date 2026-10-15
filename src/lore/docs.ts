import { join } from "node:path";
import { configureDocs } from "../../v2/ai/docs/config.ts";
import { sessionDir } from "../runtime/session.ts";

/**
 * The docs service's store lives in v2/ai/docs/docs.ts, one copy shared by the prototype and v2.
 * This re-exports it, so the prototype's imports stay as they were, and tells it that a game's own
 * copy of the lore is in the game's session folder, wherever the runtime keeps those (v2's default
 * is that same place).
 */

export * from "../../v2/ai/docs/docs.ts";

configureDocs({ overlay: id => join(sessionDir(id), "docs") });

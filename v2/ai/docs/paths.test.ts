import { test } from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { basename, dirname, isAbsolute, join, normalize } from "./paths.ts";

/**
 * The posix paths (paths.ts) answer as Node's path.posix does, for the paths the AI service names
 * files by: docs and the links between them, campaign files, prompts and folders on disk, and the odd
 * ones a link or a PUT might bring (climbing out, doubled slashes, a trailing slash, nothing at all).
 */

const PATHS = [
  "Cast/Sergeant Agnes Kell/private.md", "Cast/Kell/memories/index.md", "story/scenes/hanged-clerk.md", "World/Fronts.md", "a.md",
  "Cast/Kell/../../World/Secret.md", "./Places/Yard.md", "../World/Secret.md", "../../x.md", "a/../../b.md", "a//b///c.md", "a/b/", "a/../",
  "/home/jon/v2/campaigns/caerwyn/lore", "/home/jon/v2/ai/docs/../../../lore", "/..", "/", "./", ".", "..", "",
];

test("normalize, dirname, basename and isAbsolute answer as Node's posix paths do", () => {
  for (const path of PATHS) {
    assert.equal(normalize(path), posix.normalize(path), `normalize(${JSON.stringify(path)})`);
    assert.equal(dirname(path), posix.dirname(path), `dirname(${JSON.stringify(path)})`);
    assert.equal(basename(path), posix.basename(path), `basename(${JSON.stringify(path)})`);
    assert.equal(basename(path, ".md"), posix.basename(path, ".md"), `basename(${JSON.stringify(path)}, ".md")`);
    assert.equal(isAbsolute(path), posix.isAbsolute(path), `isAbsolute(${JSON.stringify(path)})`);
  }
});

test("join answers as Node's posix join does: a link from a doc's folder, a folder and a doc, nothing", () => {
  const joins = [["Cast/Kell", "knowledge/Cob.md"], ["Cast/Kell", "../../World/Secret.md"], ["/store/games", "g1", "docs"], ["", "a.md"], ["/repo/v2/ai/docs", "..", "..", "..", "lore"], ["a", ""], [""], []];
  for (const parts of joins) assert.equal(join(...parts), posix.join(...parts), `join(${parts.map(p => JSON.stringify(p)).join(", ")})`);
});

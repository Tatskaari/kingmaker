import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

/**
 * qa/ is handed its config (the README's rule for everything but the hosts): it reads no environment
 * and no arguments, and it plays the game as a client does, so it imports the client, the AI
 * service (its campaign loader) and shared code, never the hosts, the simulation's module or the
 * page's platform. hosts/loop.ts is its composition root.
 */

const QA = import.meta.dirname;
const REPO = resolve(QA, "..");
const files = readdirSync(QA, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(".ts") && join(QA, f) !== import.meta.filename);

test("qa/ reads no environment and no arguments: hosts/loop.ts hands it what it needs", () => {
  assert.ok(files.length >= 10, `only ${files.length} files found`);
  for (const file of files) assert.doesNotMatch(readFileSync(join(QA, file), "utf8"), /process\.(env|argv)/, file);
});

test("qa/ imports node:, itself, client/, ai/ and shared/, never hosts/, simulation/ or web/", () => {
  for (const file of files) {
    for (const [, name] of readFileSync(join(QA, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      if (name!.startsWith("node:")) continue;
      assert.ok(name!.startsWith("."), `${file}: ${name} isn't a file of the repo's`);
      const top = relative(REPO, resolve(dirname(join(QA, file)), name!)).split("/")[0];
      assert.ok(["qa", "client", "ai", "shared"].includes(top!), `${file} imports ${name}`);
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as node from "node:crypto";
import { shimProblems } from "../shims.ts";
import { createHash, HASHES } from "./crypto.ts";

// The static build's node:crypto (src/web/README.md): its hashes must be Node's, byte for byte, as
// the game keys things by them (the inventory's versions, a talk's judged lore).

const inputs: Array<[string, string | Uint8Array]> = [
  ["nothing", ""],
  ["abc", "abc"],
  // Either side of the padding's edges (55 and 56 bytes, 63, 64, 65) and a few blocks.
  ...[55, 56, 63, 64, 65, 119, 120, 128, 1000].map(n => [`${n} bytes`, "k".repeat(n)] as [string, string]),
  ["unicode", "Caerwyn's clerk — “hanged”, 🎲 at dawn"],
  ["bytes", Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 255)],
];

for (const algorithm of HASHES) {
  test(`createHash("${algorithm}") is Node's, in hex, base64 and bytes`, () => {
    for (const [what, data] of inputs) {
      const want = node.createHash(algorithm).update(data).digest();
      assert.equal(createHash(algorithm).update(data).digest("hex"), want.toString("hex"), `${what}, hex`);
      assert.equal(createHash(algorithm).update(data).digest("base64"), want.toString("base64"), `${what}, base64`);
      assert.deepEqual([...createHash(algorithm).update(data).digest()], [...want], `${what}, bytes`);
    }
    // Several updates are one message.
    assert.equal(createHash(algorithm).update("Hanged ").update("Clerk").digest("hex"), node.createHash(algorithm).update("Hanged Clerk").digest("hex"));
    // A megabyte, as a lore digest of a big game might be.
    const big = "the granary at night ".repeat(50000);
    assert.equal(createHash(algorithm).update(big).digest("hex"), node.createHash(algorithm).update(big).digest("hex"));
  });
}

test("a hash the browser build hasn't got says so", () => {
  assert.throws(() => createHash("md5"), /Hash md5 isn't available in the browser build \(only sha1 and sha256\)/);
});

test("the build finds a createHash the browser build can't do", () => {
  const ok = { path: "src/a.ts", source: `const v = createHash("sha256").update(x).digest("hex");\nconst w = node.createHash('sha1');` };
  assert.deepEqual(shimProblems([ok]), []);
  const problems = shimProblems([
    { path: "src/b.ts", source: `import { createHash } from "node:crypto";\nexport const key = createHash("md5").update(s).digest("hex");` },
    { path: "src/c.ts", source: "const h = crypto.createHash(\n  algorithm,\n);" },
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /^src\/b\.ts: createHash\("md5"\), and the browser build's node:crypto has only sha1 and sha256/);
  assert.match(problems[1]!, /^src\/c\.ts: createHash\(algorithm\): the browser build can only check/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { poolSizeIn, rowsOf, startArgs, withPoolSize } from "./spacetime.ts";

/** The part of the config.toml SpacetimeDB 2.12 writes at its first start that matters here. */
const DEFAULT = `[logs]
# level = "ERROR"

[wasm]
# Maximum number of WASM procedure instances per database.
# procedure-instance-pool-size = 8

[v8]
# Maximum number of JS procedure isolates per database. Omit to use the number
# of cores reported by the OS.
# procedure-instance-pool-size = 8

[v8-heap-policy]
# heap-check-request-interval = 65536
`;

test("the pool size goes under [v8], whatever the config holds, and [wasm]'s key of the same name is left alone", () => {
  const set = withPoolSize(DEFAULT, 16);

  assert.equal(poolSizeIn(DEFAULT), undefined);
  assert.equal(poolSizeIn(set), 16);
  assert.match(set, /\[v8\]\nprocedure-instance-pool-size = 16\n# Maximum number of JS/);
  assert.match(set, /\[wasm\]\n# Maximum number of WASM procedure instances per database\.\n# procedure-instance-pool-size = 8/);
  assert.equal(withPoolSize(set, 16), set);
  assert.equal(poolSizeIn(withPoolSize(set.replace("= 16", "= 4"), 16)), 16);
  assert.equal(withPoolSize("", 16), "[v8]\nprocedure-instance-pool-size = 16\n");
  assert.equal(poolSizeIn(withPoolSize("[logs]\nlevel = \"info\"", 16)), 16);
});

test("spacetime start keeps its data and keys in the stack's folders", () => {
  assert.deepEqual(startArgs({ bin: "/b/spacetime", config: "/r/cli.toml" }, { listen: "0.0.0.0:3300", dataDir: "/r/stdb", keysDir: "/r/keys" }), [
    "/b/spacetime", "--config-path", "/r/cli.toml", "start", "--listen-addr", "0.0.0.0:3300", "--data-dir", "/r/stdb",
    "--jwt-pub-key-path", "/r/keys/id_ecdsa.pub", "--jwt-priv-key-path", "/r/keys/id_ecdsa", "--non-interactive",
  ]);
});

test("SQL rows come back as objects: identities as hex, times as microseconds, options as a value or null", () => {
  const some = (name: string, type: unknown) => ({ name: { some: name }, algebraic_type: type });
  const option = (type: unknown) => ({ Sum: { variants: [some("some", type), some("none", { Product: { elements: [] } })] } });
  const result = {
    schema: {
      elements: [
        some("identity", { Product: { elements: [some("__identity__", { U256: [] })] } }),
        some("turn_id", option({ U64: [] })),
        some("note", option({ String: [] })),
        some("scheduled_at", { Sum: { variants: [some("Interval", { Product: { elements: [some("__time_duration_micros__", { I64: [] })] } }), some("Time", { Product: { elements: [some("__timestamp_micros_since_unix_epoch__", { I64: [] })] } })] } }),
        some("tags", { Array: { String: [] } }),
      ],
    },
    rows: [[["0xc200ab"], [0, 7], [1, []], [0, [2000000]], ["a", "b"]]],
  };

  assert.deepEqual(rowsOf(result as Parameters<typeof rowsOf>[0]), [{ identity: "0xc200ab", turn_id: 7, note: null, scheduled_at: { Interval: 2000000 }, tags: ["a", "b"] }]);
});

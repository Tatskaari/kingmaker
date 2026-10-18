import { test } from "node:test";
import assert from "node:assert/strict";
import { cliConfigProblem, poolSizeIn, publishedHow, rowsOf, startArgs, withPoolSize } from "./spacetime.ts";

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

/** A cli.toml as SpacetimeDB 2.12 writes it once the stack's server is added: Maincloud the default, as the CLI has it. */
const ADDED = `default_server = "maincloud"

[[server_configs]]
nickname = "maincloud"
host = "maincloud.spacetimedb.com"
protocol = "https"

[[server_configs]]
nickname = "local"
host = "127.0.0.1:3000"
protocol = "http"

[[server_configs]]
nickname = "kingmaker-dev"
host = "127.0.0.1:3300"
protocol = "http"
`;

test("the stack's cli.toml is fit for the owner's token only with its own server the default and nothing off this machine in it", () => {
  const maincloud = /\[\[server_configs\]\]\nnickname = "maincloud"\nhost = "maincloud.spacetimedb.com"\nprotocol = "https"\n\n/;
  const ours = ADDED.replace('default_server = "maincloud"', 'default_server = "kingmaker-dev"');

  assert.equal(cliConfigProblem(ADDED, "kingmaker-dev"), "has maincloud as its default, not kingmaker-dev");
  assert.equal(cliConfigProblem(ours, "kingmaker-dev"), "names maincloud.spacetimedb.com");
  assert.equal(cliConfigProblem(ours.replace(maincloud, ""), "kingmaker-dev"), undefined);
  assert.equal(cliConfigProblem(ours.replace(maincloud, "").replace(/^default_server.*\n/, ""), "kingmaker-dev"), "has no server as its default, not kingmaker-dev");
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

test("a publish that cleared the database says so, as the 2.12 CLI words it: a dev stack upgraded across a schema change that can't migrate", () => {
  const cleared = [
    "Checking for breaking changes...",
    "Changing the type of column game_id in table job from U64 to (some: U64 | none: ()) requires a manual migration",
    "Proceeding with database clear due to --delete-data=on-conflict.",
    "This will DESTROY the current kingmaker module, and ALL corresponding data.",
    "Skipping confirmation due to --yes",
    "Updated database with name: kingmaker, identity: c2006f2a",
  ].join("\n");

  assert.deepEqual(publishedHow(cleared), { created: false, wiped: true });
  assert.deepEqual(publishedHow("Uploading to kingmaker-dev\nUpdated database with name: kingmaker"), { created: false, wiped: false });
  assert.deepEqual(publishedHow("Created new database with name: kingmaker"), { created: true, wiped: false });
});

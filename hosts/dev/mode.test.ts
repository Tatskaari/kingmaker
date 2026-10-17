import { test } from "node:test";
import assert from "node:assert/strict";
import { aiListen, aiUrls, detectMode, modeProblem, pastaArgs, stdbListen } from "./mode.ts";

const LAN = ["127.0.0.1", "192.168.1.178", "172.17.0.1"];

test("host mode when 11.0.0.1 is on one of this machine's interfaces; namespace mode otherwise", () => {
  assert.equal(detectMode(LAN), "namespace");
  assert.equal(detectMode([...LAN, "11.0.0.1"]), "host");
  assert.equal(detectMode(["11.0.0.10", "111.0.0.1"]), "namespace");
});

test("pasta runs the command in its namespace: the network set up, the host's port forwarded in, 11.0.0.1 the host's loopback, through env", () => {
  assert.deepEqual(pastaArgs(3300, ["/home/u/.local/bin/spacetime", "start", "--listen-addr", "0.0.0.0:3300"]), [
    "--config-net", "--quiet", "--foreground", "--tcp-ports", "127.0.0.1/3300", "--map-host-loopback", "11.0.0.1", "--",
    "/usr/bin/env", "/home/u/.local/bin/spacetime", "start", "--listen-addr", "0.0.0.0:3300",
  ]);
});

test("where each listens, and the AI service's two addresses", () => {
  assert.equal(stdbListen("host", 3300), "127.0.0.1:3300");
  assert.equal(stdbListen("namespace", 3310), "0.0.0.0:3310");
  assert.equal(aiListen("host", 8787), "11.0.0.1:8787,127.0.0.1:8787");
  assert.equal(aiListen("namespace", 8797), "127.0.0.1:8797");
  assert.deepEqual(aiUrls(8850), { fromHost: "http://127.0.0.1:8850", fromSimulation: "http://11.0.0.1:8850" });
});

test("a mode that can't run here says how to fix it", () => {
  assert.match(modeProblem("host", LAN, true) ?? "", /sudo ip addr add 11\.0\.0\.1\/32 dev lo/);
  assert.match(modeProblem("namespace", LAN, false) ?? "", /pasta \(the passt package/);
  assert.equal(modeProblem("host", [...LAN, "11.0.0.1"], false), undefined);
  assert.equal(modeProblem("namespace", LAN, true), undefined);
});

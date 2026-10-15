import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { recordingWorld, type Asset, type Operation } from "./dsl.ts";

/**
 * Agent-written world scripts are TypeScript bodies of `function update(world: WorldApi): void`.
 * We typecheck them against the real DSL with tsc, then run them in a vm context that can only
 * see a recording world. Nothing touches real state; we get the operations and any warnings.
 */

export interface ScriptCheck {
  ok: boolean;
  typeErrors: string[];
  runtimeError?: string;
  operations: Operation[];
  warnings: string[];
}

const REPO = join(import.meta.dirname, "..", "..");
const TSC = join(REPO, "node_modules", ".bin", "tsc");

export function normaliseScript(code: string): string {
  let body = code.trim().replace(/^```(?:ts|typescript)?\s*\n([\s\S]*?)\n```$/i, "$1");
  body = body.replace(/^\s*import[^\n]*\n/gm, "").replace(/^\s*export\s+(default\s+)?/gm, "");
  if (!/function\s+update\s*\(/.test(body)) body = `function update(world: WorldApi): void {\n${body}\n}`;
  return body;
}

export function typecheck(body: string): string[] {
  const dir = mkdtempSync(join(REPO, "runs", "tmp-script-"));
  try {
    copyFileSync(join(REPO, "src", "world", "dsl.ts"), join(dir, "dsl.ts"));
    writeFileSync(join(dir, "script.ts"), `import type { WorldApi } from "./dsl.ts";\n${body}\nexport { update };\n`);
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "esnext", module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [] },
      files: ["script.ts"],
    }));
    const result = spawnSync(TSC, ["-p", dir], { encoding: "utf8", timeout: 60_000 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    return output.split("\n").filter(line => /error TS\d+/.test(line)).map(line => line.replace(/^.*script\.ts/, "script.ts").trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runScript(body: string, context: { assets: Asset[]; characters: string[]; anchors: string[] }): { operations: Operation[]; warnings: string[]; error?: string } {
  const { world, operations, warnings } = recordingWorld(context);
  try {
    const js = stripTypeScriptTypes(body);
    runInNewContext(`${js}\n;update(world);`, { world: Object.freeze(world) }, { timeout: 1000 });
    return { operations, warnings };
  } catch (error) {
    return { operations, warnings, error: error instanceof Error ? error.message : String(error) };
  }
}

export function checkScript(code: string, context: { assets: Asset[]; characters: string[]; anchors: string[] }): ScriptCheck & { body: string } {
  mkdirSync(join(REPO, "runs"), { recursive: true });
  const body = normaliseScript(code);
  const typeErrors = typecheck(body);
  const run = runScript(body, context);
  return {
    body, typeErrors, operations: run.operations, warnings: run.warnings,
    ...(run.error ? { runtimeError: run.error } : {}),
    ok: typeErrors.length === 0 && !run.error,
  };
}

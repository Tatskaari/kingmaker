import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

execFileSync("npx", ["--no-install", "tsc", "--outDir", "dist"], { stdio: "inherit" });
for (const directory of ["lore/gm_prompts", "evals/prompts"]) {
  const target = new URL(`../dist/${directory}/`, import.meta.url);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(new URL(`../${directory}/`, import.meta.url), target, { recursive: true });
}

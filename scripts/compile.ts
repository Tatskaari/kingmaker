import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

execFileSync("npx", ["--no-install", "tsc", "--outDir", "dist"], { stdio: "inherit" });
const target = new URL("../dist/lore/gm_prompts/", import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(new URL("../lore/gm_prompts/", import.meta.url), target, { recursive: true });

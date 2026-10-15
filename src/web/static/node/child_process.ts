/**
 * node:child_process for the browser build: there are no processes. The game's background jobs run
 * in the worker instead (src/runtime/background.ts's setBackgroundRunner, set by game.tsx), so
 * nothing on the game's path gets here; anything that does is told so.
 */

const none = (what: string) => () => { throw new Error(`${what}: there are no processes in the browser build`); };

export const spawn = none("spawn");
export const spawnSync = none("spawnSync");
export const exec = none("exec");
export const execSync = none("execSync");
export const execFile = none("execFile");
export const execFileSync = none("execFileSync");
export const fork = none("fork");

export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork };

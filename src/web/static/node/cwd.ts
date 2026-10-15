/** The game's working directory in the browser's file system: the repo, as the game sees it. */
export const ROOT = "/kingmaker";

let current = ROOT;
export const cwd = () => current;
export const chdir = (dir: string) => { current = dir; };

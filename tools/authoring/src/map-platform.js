// Lexically injected only into the bundle. Never replace Obsidian's global process,
// expose its environment/credentials, or let a terrain preview touch its real FS.
export const process={env:{KM_GLYPHS:'ascii'},platform:'browser',argv:[],cwd:()=>'/kingmaker'};

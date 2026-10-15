/** node:os for the browser build: a home with nothing in it (no ~/secrets, no installed fonts). */

export const homedir = () => "/home/player";
export const tmpdir = () => "/tmp";
export const hostname = () => "browser";
export const platform = () => "linux";
export const type = () => "Browser";
export const release = () => "";
export const arch = () => "wasm";
export const EOL = "\n";
export const cpus = () => [{ model: "browser", speed: 0 }];
export const networkInterfaces = () => ({});
export const userInfo = () => ({ username: "player", homedir: homedir(), shell: null, uid: -1, gid: -1 });

export default { homedir, tmpdir, hostname, platform, type, release, arch, EOL, cpus, networkInterfaces, userInfo };

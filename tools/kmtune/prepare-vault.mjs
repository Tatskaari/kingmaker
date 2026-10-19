/** Prepare local authoring copies without putting a second campaign in version control. */
import { copyFile, mkdir, readdir, constants } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: npm run prepare:music-vault -- /path/to/lore');
const vault = resolve(process.argv[2]);
const sources = [['campaigns/caerwyn', 'Game'], ['lore/Tunes', 'Tunes']];
let copied = 0, kept = 0;
for (const [source, folder] of sources) {
  const from = join(root, source), to = join(vault, folder);
  const entries = await readdir(from, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name), name = relative(from, file);
    if (name.split(/[\\/]/).some(part => part.startsWith('.'))) continue;
    const target = join(to, name);
    if (resolve(file) === resolve(target)) { kept++; continue; }
    await mkdir(dirname(target), { recursive: true });
    try { await copyFile(file, target, constants.COPYFILE_EXCL); copied++; }
    catch (error) { if (error.code !== 'EEXIST') throw error; kept++; }
  }
}
console.log(`Prepared ${vault}: ${copied} new files; ${kept} existing files preserved.`);
console.log('Game is a local authoring copy. Build with --tunes <vault>/Tunes to use its music assignments.');

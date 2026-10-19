import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const out = new URL('../../dist/kingmaker-tunes/', import.meta.url);
await mkdir(out, { recursive: true });
await build({ entryPoints: [new URL('./main.ts', import.meta.url).pathname], outfile: new URL('main.js', out).pathname, bundle: true, external: ['obsidian'], format: 'cjs', platform: 'browser', target: 'es2022' });
await build({ entryPoints: [new URL('../../web/page/sound-worklet.ts', import.meta.url).pathname], outfile: new URL('sound-worklet.js', out).pathname, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
for (const file of ['manifest.json', 'styles.css', 'README.md']) await copyFile(new URL(file, import.meta.url), new URL(file, out));
await copyFile(new URL('../../assets/music/lanterns.example.kmtune', import.meta.url), new URL('lanterns.example.kmtune', out));
console.log(`Plugin built in ${out.pathname}`);

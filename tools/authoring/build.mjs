import * as esbuild from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
await mkdir('dist/plugin',{recursive:true});
// The game's own browser stand-ins for Node (web/node, as its page's build takes them: each file is the
// module its name says), for whatever the terrain renderer's imports ask of Node. Today they ask nothing.
const nodeStandIns=path.resolve(root,'../../web/node');
const alias=Object.fromEntries((await readdir(nodeStandIns)).filter(file=>/^[a-z_]+(-[a-z_]+)*\.ts$/.test(file)&&!file.endsWith('.test.ts')).map(file=>[`node:${file.slice(0,-3).replaceAll('-','/')}`,path.join(nodeStandIns,file)]));
const options={bundle:true,jsx:'automatic',sourcemap:true,alias,define:{'process.env.NODE_ENV':'"production"'},inject:[path.resolve(root,'src/map-platform.js')]};
await esbuild.build({...options,entryPoints:['src/plugin.tsx'],outfile:'dist/plugin/main.js',format:'cjs',platform:'browser',external:['obsidian','electron'],logLevel:'info'});
await copyFile('dist/plugin/main.css','dist/plugin/styles.css');
await copyFile('manifest.json','dist/plugin/manifest.json');

// The browser test harness's fixtures: the game's campaign as the vault Obsidian opens (its scenario,
// scenes/, maps/, places/, looks and every file under lore/, at their paths in the campaign folder), beside
// the plugin's version 1 files (tests/fixtures/v1), which open read-only or, a map, to migrate. Never
// bundled into the installed plugin.
const campaignRoot=path.resolve(process.env.KINGMAKER_CAMPAIGN??path.join(root,'../../campaigns/caerwyn'));
async function walk(directory,prefix=''){
  const files=[];
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.'))continue;
    const relative=prefix+entry.name;
    if(entry.isDirectory())files.push(...await walk(path.join(directory,entry.name),relative+'/'));
    else files.push({path:relative,text:await readFile(path.join(directory,entry.name),'utf8')});
  }
  return files;
}
const campaign=await walk(campaignRoot);
const editable=file=>/^([^/]+\.kmscenario|scenes\/[^/]+\.kmscene|maps\/[^/]+\.kmmap|places\/[^/]+\.kmplace|looks\.json)$/.test(file.path);
const files=Object.fromEntries([...campaign.filter(editable),...(await walk(path.join(root,'tests/fixtures/v1')))].map(file=>[file.path,file.text]));
const notes=campaign.filter(file=>file.path.startsWith('lore/'));
await writeFile('dist/fixtures.json',JSON.stringify({files,notes}));
await copyFile('index.html','dist/index.html');
const browser={...options,entryPoints:['src/browser.tsx'],outfile:'dist/app.js',format:'esm',target:'es2022',logLevel:'info'};
if(process.argv.includes('--serve')){
  const port=Number(process.argv.find(argument=>argument.startsWith('--port='))?.slice(7)??4177);
  const context=await esbuild.context(browser);await context.watch();
  await context.serve({servedir:'dist',host:'127.0.0.1',port});
  console.log(`Kingmaker browser TEST HARNESS: http://127.0.0.1:${port} (installed plugin is dist/plugin)`);
}else await esbuild.build(browser);

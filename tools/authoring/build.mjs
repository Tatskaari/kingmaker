import * as esbuild from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,readdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
await mkdir('dist/plugin',{recursive:true});
const options={bundle:true,jsx:'automatic',sourcemap:true};
await esbuild.build({...options,entryPoints:['src/plugin.tsx'],outfile:'dist/plugin/main.js',format:'cjs',platform:'browser',external:['obsidian','electron'],logLevel:'info'});
await copyFile('dist/plugin/main.css','dist/plugin/styles.css');
await copyFile('manifest.json','dist/plugin/manifest.json');

// Separate browser fixtures exercise the same editor against a file-shaped test host.
// These fixtures are never bundled into the installed Obsidian plugin.
const loreRoot=path.resolve(process.env.KINGMAKER_LORE_ROOT??path.join(root,'../../lore'));
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
const sourceNotes=(await walk(loreRoot)).filter(file=>file.path.endsWith('.md'));
const examples=await walk(path.join(root,'examples'));
const noteFiles=new Map([...sourceNotes,...examples.filter(file=>file.path.endsWith('.md'))].map(file=>[file.path,file]));
const lore=[...noteFiles.values()].map(file=>{
  const name=file.text.match(/^name:\s*["']?(.*?)["']?\s*$/m)?.[1]
    ?? (file.path.startsWith('Cast/')?file.path.split('/')[1]:file.path.split('/').at(-1).replace(/\.md$/,''));
  const kind=file.path.startsWith('Cast/')?'character':file.path.startsWith('Objects/')?'object':file.path.startsWith('Places/')?'place':'note';
  return {id:file.path,name,kind,...file};
});
const files=Object.fromEntries(examples.filter(file=>/\.km(scene|scenario)$/.test(file.path)).map(file=>[file.path,file.text]));
await writeFile('dist/fixtures.json',JSON.stringify({files,lore}));
await cp('examples','dist/fixtures',{recursive:true});
await copyFile('index.html','dist/index.html');
const browser={...options,entryPoints:['src/browser.tsx'],outfile:'dist/app.js',format:'esm',target:'es2022',logLevel:'info'};
if(process.argv.includes('--serve')){
  const port=Number(process.argv.find(argument=>argument.startsWith('--port='))?.slice(7)??4177);
  const context=await esbuild.context(browser);await context.watch();
  await context.serve({servedir:'dist',host:'127.0.0.1',port});
  console.log(`Kingmaker browser TEST HARNESS: http://127.0.0.1:${port} (installed plugin is dist/plugin)`);
}else await esbuild.build(browser);

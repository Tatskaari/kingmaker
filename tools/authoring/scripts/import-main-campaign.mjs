#!/usr/bin/env node
/** Import the authored Caerwyn continuation, never runtime-generated/test scenes. */
import {readFile,readdir,mkdir,writeFile,realpath,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {convertScene} from './main-scene-conversion.mjs';
import {parseDocument,entryPorts,serializeDocument} from '../src/model.ts';

const [gameArgument,vaultArgument,...flags]=process.argv.slice(2);
if(!gameArgument||!vaultArgument||flags.some(flag=>flag!=='--write'))throw Error('Usage: node scripts/import-main-campaign.mjs <main-game-root> <lore-vault> [--write]');
const game=await realpath(gameArgument),vault=await realpath(vaultArgument),write=flags.includes('--write');
const inspect=async file=>{try{return await lstat(file)}catch(error){if(error.code==='ENOENT')return null;throw error}};
const sceneFolder=path.join(vault,'Scenes'),folderStat=await inspect(sceneFolder);
if(folderStat&&(folderStat.isSymbolicLink()||!folderStat.isDirectory()))throw Error('Scenes must be a real directory inside the vault, not a symlink or another file.');
const revision=execFileSync('git',['-C',game,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const specs=[
  ['scenes/interludes.ts','caerwynAfternoon'],
  ['scenes/drowned-rat.ts','drownedRat'],
  ['scenes/interludes.ts','wharfNight'],
  ['scenes/heron-warehouse.ts','heronWarehouse'],
  ['scenes/kings-morning.ts','kingsMorning'],
];
const common=['scenes/hanged-clerk.ts','scenes/worlds/hanged-clerk.ts'];
const snapshotFiles=async(sourcePath,scene)=>{
  const paths=[sourcePath,...common,...(scene.world?[`scenes/worlds/${scene.id}.ts`]:[])];
  return Object.fromEntries(await Promise.all([...new Set(paths)].map(async relative=>[relative,await readFile(path.join(game,relative),'utf8')])));
};
const paths=[];
async function walk(directory,prefix=''){
  for(const item of await readdir(directory,{withFileTypes:true})){
    if(item.name.startsWith('.'))continue;
    const relative=prefix+item.name;
    if(item.isDirectory())await walk(path.join(directory,item.name),relative+'/');
    else if(item.isFile())paths.push(relative);
  }
}
await walk(vault);
const existing=[];
for(const relative of paths.filter(name=>name.endsWith('.kmscene'))){
  try{existing.push({file:relative,document:parseDocument(await readFile(path.join(vault,relative),'utf8'),'scene')})}
  catch(error){throw Error(`Cannot safely resolve existing scenes: ${relative}: ${error.message}`)}
}
const authored=await Promise.all(specs.map(async([sourcePath,name])=>{
  // These modules contain authored data and function definitions only. Exit
  // scripts are preserved as source; the importer never calls them.
  const scene=(await import(pathToFileURL(path.join(game,sourcePath)).href))[name];
  if(!scene)throw Error(`Missing scene export ${name} in ${sourcePath}`);
  const matches=existing.filter(file=>file.document.id===scene.id);
  if(matches.length>1)throw Error(`Ambiguous existing scene id ${scene.id}; no files written.`);
  const filename=scene.title.replace(/[\\/:*?"<>|\x00-\x1F]/g,'-').trim();
  if(!filename||filename==='.'||filename==='..')throw Error(`Unsafe scene title: ${scene.title}`);
  const file=matches[0]?.file??`Scenes/${filename}.kmscene`;
  if(!matches.length&&await inspect(path.join(vault,file)))throw Error(`Filename already belongs to other content: ${file}`);
  return {scene,sourcePath,file,existing:matches[0],sourceFiles:await snapshotFiles(sourcePath,scene)};
}));
const destinations={};
for(const item of authored){
  if(item.existing&&!entryPorts(item.existing.document).some(port=>port.id===item.scene.start))throw Error(`Existing scene ${item.file} no longer exposes its authored start ${item.scene.start}. Choose its destination input explicitly; nothing was written.`);
  destinations[item.scene.id]={file:item.file,entry:item.scene.start};
}
const lorePaths=paths.filter(file=>file.endsWith('.md'));
const plans=authored.map(item=>{
  if(item.existing)return {...item,document:item.existing.document,status:'kept'};
  const document=convertScene(item.scene,{revision,sourcePath:item.sourcePath,sourceFiles:item.sourceFiles,lorePaths,destinations});
  document.source.fileHashes=Object.fromEntries(Object.entries(item.sourceFiles).map(([file,contents])=>[file,createHash('sha256').update(contents).digest('hex')]));
  document.source.checkout=game;
  document.source.note+=' File hashes describe the working-tree source actually read; the revision alone does not imply a clean checkout.';
  parseDocument(serializeDocument(document),'scene');
  return {...item,document,status:'new'};
});
// Validate the complete batch before creating its first file.
for(const item of plans)for(const exit of item.document.nodes.filter(node=>node.data.kind==='exit')){
  const target=plans.find(plan=>plan.file===exit.data.file);
  if(target&&!entryPorts(target.document).some(port=>port.id===exit.data.entry))throw Error(`Unresolved imported input: ${item.file}/${exit.id}`);
}
if(write){
  await mkdir(sceneFolder,{recursive:true});
  for(const item of plans){
    if(item.status==='kept')continue;
    // Exclusive creation: re-running the import never overwrites authored edits.
    await writeFile(path.join(vault,item.file),serializeDocument(item.document),{flag:'wx'});
  }
}
const linksToComplete=existing.flatMap(item=>item.document.nodes.filter(node=>node.data.kind==='exit'&&destinations[node.data.next]&&!node.data.file&&!node.data.entry).map(node=>({sourceFile:item.file,exit:node.id,next:node.data.next,...destinations[node.data.next]})));
console.log(JSON.stringify({mode:write?'created missing files only':'dry run',revision,scenes:plans.map(item=>({file:item.file,id:item.scene.id,status:item.status,nodes:item.document.nodes.length,transitions:item.document.edges.length,unresolvedLore:item.document.source?.unresolvedLore??[]})),linksToComplete,note:'Existing scenes, scenarios, lore notes and game source are never rewritten by this importer. Interludes remain scenes; map placement and engine integration are deferred.'},null,2));

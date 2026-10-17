#!/usr/bin/env node
// Installs the built plugin (dist/plugin) into an Obsidian vault: the game's campaign folder,
// campaigns/caerwyn, is the one it's made for. Only the plugin's own files are written, and the
// community plugins list gains it; nothing else in the vault is touched.
import {copyFile,cp,mkdir,readdir,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const target=process.argv[2];
if(!target)throw Error('Usage: npm run install:vault -- <vault> (the campaign folder: npm run install:vault -- ../../campaigns/caerwyn)');
const vault=await realpath(target);
const exists=async file=>{try{await stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}};
if(!await exists(path.join(vault,'.obsidian')))throw Error(`${vault} isn't an Obsidian vault (it has no .obsidian folder): open it as a vault in Obsidian first.`);
const plugin=path.join(vault,'.obsidian/plugins/kingmaker-authoring');
const backup=path.join(root,'dist/install-backups',new Date().toISOString().replaceAll(':','-'));
const enabledFile=path.join(vault,'.obsidian/community-plugins.json');
const enabled=await exists(enabledFile)?JSON.parse(await readFile(enabledFile,'utf8')):[];
if(!Array.isArray(enabled)||enabled.some(id=>typeof id!=='string'))throw Error('Invalid community-plugins.json; refusing to change it.');
// Validate all build inputs before touching the destination.
const assets=['main.js','styles.css','manifest.json'];
for(const name of assets)await stat(path.join(root,'dist/plugin',name));
if(await exists(plugin)){
  await mkdir(backup,{recursive:true});await cp(plugin,path.join(backup,'kingmaker-authoring'),{recursive:true});
  console.log(`Previous plugin backed up to ${backup}`);
}
await mkdir(plugin,{recursive:true});
for(const name of assets)await copyFile(path.join(root,'dist/plugin',name),path.join(plugin,name));
if(!enabled.includes('kingmaker-authoring')){
  if(await exists(enabledFile)){await mkdir(backup,{recursive:true});await copyFile(enabledFile,path.join(backup,'community-plugins.json'))}
  await writeFile(enabledFile,JSON.stringify([...enabled,'kingmaker-authoring'],null,2)+'\n');
}
console.log(`Installed Kingmaker Authoring in ${vault}`);
console.log('Reload Obsidian. If Restricted mode is on, allow community plugins and enable Kingmaker Authoring.');
console.log((await readdir(vault)).some(name=>name.endsWith('.kmscenario'))
  ?'Open a scene from scenes/ (scenes/hanged-clerk.kmscene is the worked example).'
  :'This vault has no scenario (<id>.kmscenario): the scene editor checks scenes against a campaign folder (campaigns/caerwyn), so open that as the vault.');

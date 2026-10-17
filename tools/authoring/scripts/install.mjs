#!/usr/bin/env node
import {copyFile,cp,mkdir,readFile,readdir,realpath,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const target=process.argv[2];
if(!target)throw Error('Usage: npm run install:vault -- /absolute/path/to/lore-vault');
const vault=await realpath(target);
if(!(await stat(path.join(vault,'.obsidian'))).isDirectory())throw Error('Target must already be an Obsidian vault.');
const exists=async file=>{try{await stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}};
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
async function installExamples(relative=''){
  const from=path.join(root,'examples',relative);
  for(const entry of await readdir(from,{withFileTypes:true})){
    const next=path.join(relative,entry.name),destination=path.join(vault,next);
    if(entry.isDirectory())await installExamples(next);
    else if(await exists(destination))console.log(`Kept existing: ${next}`);
    else{await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(from,entry.name),destination,1);console.log(`Created: ${next}`)}
  }
}
await installExamples();
console.log(`Installed Kingmaker Authoring in ${vault}`);
console.log('Reload Obsidian. If Restricted mode is on, allow community plugins and enable Kingmaker Authoring.');
console.log('Open Scenarios/Caerwyn.kmscenario or Scenes/The Hanged Clerk.kmscene from the vault file explorer.');

import {isTuneId} from '../../../../shared/music/assignments.ts';
import type {VaultFiles} from './files.ts';

export type TuneChoice={value:string;label:string;path:string};

/** Tunes can live in a campaign's lore, or at the root of a vault opened on the repo's lore folder. */
export async function readTuneChoices(root:string,files:VaultFiles):Promise<TuneChoice[]>{
  const folders=[...new Set([`${root}lore/Tunes/`,`${root}Tunes/`,'Tunes/','lore/Tunes/'])];
  const found=new Map<string,{value:string;path:string}>();
  for(const folder of folders){
    for(const path of files.list(folder).sort((a,b)=>a.localeCompare(b))){
      if(!path.startsWith(folder)||!path.toLowerCase().endsWith('.kmtune'))continue;
      const value=path.slice(folder.length,-'.kmtune'.length);
      if(isTuneId(value)&&!found.has(value))found.set(value,{value,path});
    }
  }
  return Promise.all([...found.values()].sort((a,b)=>a.value.localeCompare(b.value)).map(async tune=>{
    let title='';
    try{const raw=await files.read(tune.path);if(raw){const value=JSON.parse(raw);if(typeof value?.title==='string')title=value.title.trim()}}catch{}
    return {...tune,label:title&&title!==tune.value?`${title} (${tune.value})`:tune.value};
  }));
}

// The campaign around a scene file, as the editor needs it: the game's campaign folder (campaigns/<id>/,
// the vault), read through whatever host holds its files (Obsidian's vault, or the browser test harness).
import {openSceneFile} from './model.ts';
import type {SceneContext,SceneDocument} from './model.ts';
import type {CampaignFile,PlaceFile} from '../../../../shared/scene/files.ts';

/**
 * A scene lives at <campaign>/scenes/<id>.kmscene, beside campaign.json, places/ and lore/. Its lore
 * paths are the game's: relative to the campaign's lore/ ("Cast/Cob/public.md" is the vault's
 * lore/Cast/Cob/public.md when the campaign folder is the vault). The editor offers lore that way,
 * opens it that way, and holds the scene to the game's rules with the campaign's scenes, places,
 * quests and lore as the campaign check would.
 */

/** A note under the campaign's lore/ the editor offers: its path there, a name to show, and what it's about. */
export type LoreNote={path:string;name:string;kind:LoreKind};
export type LoreKind='character'|'place'|'world'|'note';

/** One of the campaign's scenes: its id and title, and its file as it is now (an open editor's draft, if one has it). */
export type CampaignScene={id:string;title:string;doc?:SceneDocument;error?:string};

/** The campaign as the editor sees it. */
export type Campaign={
  /** The campaign's folder in the vault: '' when the vault is the campaign folder, else "campaigns/caerwyn/". */
  root:string;
  /** Why campaign.json couldn't be read, if it couldn't: then nothing needing it is checked or offered. */
  error?:string;
  /** campaign.json's scenes, in story order, then its talk template. */
  scenes:CampaignScene[];
  /** The ids of the scene files in its scenes/ that campaign.json doesn't list yet (a scene being written), which an ending may name, and the problems say until it's listed. */
  unlisted:string[];
  talk?:string;
  places:PlaceFile[];
  quests:Record<string,string>;
  /** The notes the editor offers as lore: each person's public card, the places, the world, other notes. */
  lore:LoreNote[];
  /** Every file under lore/, by its path there: what the rules check a lore path against. */
  loreFiles:Set<string>;
};

/** What the editor needs of a host's files: the paths under a folder, and a file's text (undefined when it isn't there). */
export type VaultFiles={
  list:(folder:string)=>string[];
  read:(path:string)=>Promise<string|undefined>;
};

/** The campaign folder of a scene file at `path` in the vault: the folder its scenes/ folder is in. */
export function campaignRootOf(path:string):string{
  const parts=path.split('/');
  const at=parts.length>=2&&parts[parts.length-2]==='scenes'?parts.length-2:parts.length-1;
  return parts.slice(0,at).map(part=>`${part}/`).join('');
}

/** The scene's id its file's name gives it: scenes/<id>.kmscene. */
export const sceneKeyOf=(path:string):string=>(path.split('/').at(-1)??path).replace(/\.kmscene$/i,'');

/** Where a scene of the campaign is in the vault. */
export const scenePathOf=(root:string,id:string):string=>`${root}scenes/${id}.kmscene`;

/** Where a lore path (the game's, relative to lore/) is in the vault. */
export const lorePathOf=(root:string,path:string):string=>`${root}lore/${path}`;

/**
 * The campaign around the scene at `path`: campaign.json, each of its scenes (their drafts from
 * `drafts`, by vault path, where an editor has one), its places and quests, and its lore.
 */
export async function readCampaign(path:string,files:VaultFiles,drafts:(path:string)=>SceneDocument|undefined=()=>undefined):Promise<Campaign>{
  const root=campaignRootOf(path);
  const lore=readLore(root,files);
  const empty:Campaign={root,scenes:[],unlisted:[],places:[],quests:{},...lore};

  const campaign=await readJson<CampaignFile>(files,`${root}campaign.json`);
  if(typeof campaign==='string')return {...empty,error:campaign};

  const ids=[...(campaign.scenes??[]),...(campaign.talk?[campaign.talk]:[])];
  const scenes=await Promise.all(ids.map(id=>readScene(root,id,files,drafts)));
  const places=await readPlaces(root,campaign.places??[],files);
  const unlisted=files.list(`${root}scenes/`).filter(file=>file.slice(root.length+'scenes/'.length).match(/^[^/]+\.kmscene$/i)).map(sceneKeyOf).filter(id=>!ids.includes(id)).sort();
  return {...empty,scenes,unlisted,...(campaign.talk?{talk:campaign.talk}:{}),places,quests:campaign.quests??{}};
}

/** The rules' context for the scene `key` in this campaign: everything but the scene itself, whose draft is the editor's. */
export function contextOf(campaign:Campaign,key:string):SceneContext{
  return {
    hasLore:path=>campaign.loreFiles.has(path),
    scenes:campaign.scenes.filter(scene=>scene.id!==campaign.talk).map(scene=>scene.id),
    ...(campaign.talk?{talk:campaign.talk}:{}),
    places:campaign.places,
    quests:campaign.quests,
    others:campaign.scenes.filter(scene=>scene.id!==key&&scene.doc).map(scene=>scene.doc!),
  };
}

/** Is the scene `key` one the game installs (campaign.json's scenes, or its talk template)? */
export const isListed=(campaign:Campaign,key:string):boolean=>campaign.scenes.some(scene=>scene.id===key);

// ---------------------------------------------------------------------------------------------

async function readScene(root:string,id:string,files:VaultFiles,drafts:(path:string)=>SceneDocument|undefined):Promise<CampaignScene>{
  const path=scenePathOf(root,id);
  const draft=drafts(path);
  if(draft)return {id,title:draft.title,doc:draft};
  const text=await files.read(path);
  if(text===undefined)return {id,title:id,error:`${path} isn't there`};
  try{
    const file=openSceneFile(text);
    return file.kind==='scene'?{id,title:file.doc.title||id,doc:file.doc}:{id,title:file.title||id,error:`${path} is a version 1 file`};
  }catch(error){return {id,title:id,error:(error as Error).message}}
}

async function readPlaces(root:string,keys:string[],files:VaultFiles):Promise<PlaceFile[]>{
  const places=await Promise.all(keys.map(key=>readJson<PlaceFile>(files,`${root}places/${key}.json`)));
  return places.filter((place):place is PlaceFile=>typeof place!=='string'&&!!place&&typeof place==='object'&&Array.isArray(place.areas)&&Array.isArray(place.things));
}

/** The lore: every file under lore/ (for the rules), and the notes to offer, a person's public card once for their folder. */
function readLore(root:string,files:VaultFiles):{lore:LoreNote[];loreFiles:Set<string>}{
  const folder=`${root}lore/`;
  const paths=files.list(folder).filter(path=>path.startsWith(folder)).map(path=>path.slice(folder.length)).sort((a,b)=>a.localeCompare(b));
  const lore=paths.filter(offered).map(path=>({path,name:nameOf(path),kind:kindOf(path)}));
  return {lore,loreFiles:new Set(paths)};
}

/** A note worth offering: Markdown, and of a person's folder only their public card (their private notes, GM notes and memories are the game's). */
function offered(path:string):boolean{
  if(!path.endsWith('.md')||path.split('/').some(part=>part.startsWith('.')))return false;
  const parts=path.split('/');
  if(parts[0]!=='Cast')return true;
  return parts.length===3&&parts[2]==='public.md';
}

function nameOf(path:string):string{
  const parts=path.split('/');
  if(parts[0]==='Cast'&&parts.length===3)return parts[1];
  const base=parts.at(-1)!.replace(/\.md$/,'');
  return base==='index'&&parts.length>1?`${parts.at(-2)} (index)`:base;
}

function kindOf(path:string):LoreKind{
  const top=path.split('/')[0];
  return top==='Cast'?'character':top==='Places'?'place':top==='World'?'world':'note';
}

async function readJson<T>(files:VaultFiles,path:string):Promise<T|string>{
  const text=await files.read(path);
  if(text===undefined)return `${path} isn't there`;
  try{return JSON.parse(text) as T}catch(error){return `${path} isn't JSON (${(error as Error).message})`}
}

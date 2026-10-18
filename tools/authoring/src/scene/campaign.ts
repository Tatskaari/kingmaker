// The campaign around a scene file, as the editor needs it: the game's campaign folder (campaigns/<id>/,
// the vault), read through whatever host holds its files (Obsidian's vault, or the browser test harness).
import {openSceneFile} from './model.ts';
import type {SceneContext,SceneDocument} from './model.ts';
import type {PlaceFile} from '../../../../shared/scene/files.ts';
import {loadPlace,loadScenario,placePath,scenarioPathIn} from '../../../../shared/scene/scenario.ts';
import {campaignRootOf} from '../campaign/files.ts';

export {campaignRootOf};

/**
 * A scene lives at <campaign>/scenes/<id>.kmscene, beside the campaign's scenario (<id>.kmscenario),
 * its places/ (places/<key>.kmplace) and lore/ (docs/scenario-format.md). Its lore
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
  /** The scenario's path in the vault ("campaigns/caerwyn/caerwyn.kmscenario"), when the campaign has one. */
  scenario?:string;
  /** Why the scenario couldn't be read, if it couldn't: then nothing needing it is checked or offered. */
  error?:string;
  /** The scenario's scenes, in story order, then its talk template. */
  scenes:CampaignScene[];
  talk?:string;
  places:PlaceFile[];
  quests:Record<string,string>;
  /** The notes the editor offers as lore: each person's public card, the places, the world, other notes. */
  lore:LoreNote[];
  /** Every file under lore/, by its path there: what the rules check a lore path against. */
  loreFiles:Set<string>;
};

export type {VaultFiles} from '../campaign/files.ts';
import type {VaultFiles} from '../campaign/files.ts';

/** The scene's id its file's name gives it: scenes/<id>.kmscene. */
export const sceneKeyOf=(path:string):string=>(path.split('/').at(-1)??path).replace(/\.kmscene$/i,'');

/** Where a scene of the campaign is in the vault. */
export const scenePathOf=(root:string,id:string):string=>`${root}scenes/${id}.kmscene`;

/** Where a lore path (the game's, relative to lore/) is in the vault. */
export const lorePathOf=(root:string,path:string):string=>`${root}lore/${path}`;

/**
 * The campaign around the scene at `path`: its scenario (the game's shapes, as scenario.ts loads it),
 * each of its scenes (their drafts from `drafts`, by vault path, where an editor has one), its places
 * and quests, and its lore.
 */
export async function readCampaign(path:string,files:VaultFiles,drafts:(path:string)=>SceneDocument|undefined=()=>undefined):Promise<Campaign>{
  const root=campaignRootOf(path);
  const lore=readLore(root,files);
  const empty:Campaign={root,scenes:[],places:[],quests:{},...lore};

  const found=scenarioPathIn(files.list(root).filter(path=>path.startsWith(root)).map(path=>path.slice(root.length)));
  if(!found)return {...empty,error:`the campaign has no scenario beside scenes/ (${root}<id>.kmscenario)`};
  const scenario=`${root}${found}`;
  const text=await files.read(scenario);
  if(text===undefined)return {...empty,scenario,error:`${scenario} isn't there`};
  let campaign;
  try{campaign=loadScenario(text,scenario)}catch(error){return {...empty,scenario,error:(error as Error).message}}

  const ids=[...(campaign.scenes??[]),...(campaign.talk?[campaign.talk]:[])];
  const scenes=await Promise.all(ids.map(id=>readScene(root,id,files,drafts)));
  const places=await readPlaces(root,campaign.places??[],files);
  return {...empty,scenario,scenes,...(campaign.talk?{talk:campaign.talk}:{}),places,quests:campaign.quests??{}};
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

/** Is the scene `key` one the game installs (the scenario's scenes, or its talk template)? */
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

/** The scenario's places (places/<key>.kmplace) as the game keeps them: one that's missing or isn't a place is left out. */
async function readPlaces(root:string,keys:string[],files:VaultFiles):Promise<PlaceFile[]>{
  const places=await Promise.all(keys.map(async key=>{
    const text=await files.read(`${root}${placePath(key)}`);
    try{return text===undefined?undefined:loadPlace(text,placePath(key))}catch{return undefined}
  }));
  return places.filter((place):place is PlaceFile=>!!place);
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


// The campaign folder as the scenario, map and place editors read it (docs/scenario-format.md): its
// scenario, its scenes, maps and places, each file's text as it is now (an open editor's draft before
// what's on disk) and what the game's parse makes of it, and the scenario format's rules run over them
// as the campaign check runs them (shared/scene/scenario-rules.ts).
import type {SceneDocument} from '../../../../shared/scene/document.ts';
import {parseScene} from '../../../../shared/scene/document.ts';
import {MAP_EXTENSION,PLACE_EXTENSION,SCENARIO_EXTENSION,mapPath,parseMap,parsePlace,parseScenario,placePath,scenarioPathIn} from '../../../../shared/scene/scenario.ts';
import type {MapDocument,PlaceDocument,ScenarioDocument} from '../../../../shared/scene/scenario.ts';
import {flowProblems,mapRuleProblems,placeRuleProblems,scenarioRuleProblems} from '../../../../shared/scene/scenario-rules.ts';
import type {ScenarioCampaign,ScenarioProblem,ScenarioProblemAt} from '../../../../shared/scene/scenario-rules.ts';

export type {MapDocument,PlaceDocument,ScenarioDocument,ScenarioProblem,ScenarioProblemAt,SceneDocument};

/** What the editors need of a host's files: the paths under a folder, and a file's text as it is now (undefined when it isn't there). */
export type VaultFiles={
  list:(folder:string)=>string[];
  read:(path:string)=>Promise<string|undefined>;
};

/** The kinds of file the plugin edits, by their extensions. */
export type FileKind='scene'|'scenario'|'map'|'place';
export const EXTENSIONS:Record<FileKind,string>={scene:'kmscene',scenario:'kmscenario',map:'kmmap',place:'kmplace'};
export const kindOfPath=(path:string):FileKind|undefined=>(Object.entries(EXTENSIONS) as [FileKind,string][]).find(([,extension])=>path.toLowerCase().endsWith(`.${extension}`))?.[0];

/**
 * The campaign folder of a file of it: a scene's, a map's or a place's is the folder its scenes/,
 * maps/ or places/ folder is in; anything else's (the scenario's) is its own folder. '' when the vault
 * is the campaign folder, else the folder with a slash ("campaigns/caerwyn/").
 */
export function campaignRootOf(path:string):string{
  const parts=path.split('/');
  const folder=parts.length>=2?parts[parts.length-2]:undefined;
  const at=folder!==undefined&&FOLDERS.includes(folder)?parts.length-2:parts.length-1;
  return parts.slice(0,at).map(part=>`${part}/`).join('');
}
const FOLDERS=['scenes','maps','places'];

/** A file's key: its name without its extension (scenes/hanged-clerk.kmscene is hanged-clerk). */
export const keyOfPath=(path:string):string=>(path.split('/').at(-1)??path).replace(/\.[^.]+$/,'');

/** Where each of a campaign's files is in the vault. */
export const pathIn={
  scene:(root:string,key:string)=>`${root}scenes/${key}.kmscene`,
  map:(root:string,key:string)=>`${root}${mapPath(key)}`,
  place:(root:string,key:string)=>`${root}${placePath(key)}`,
};

/** One of the campaign's files: its key, where it is, its text as it is now, and the document the game's parse makes of it (or why it can't). */
export type CampaignFile<T>={key:string;path:string;text?:string;doc?:T;error?:string};

/** A scene of the campaign: as a CampaignFile, and its JSON whatever its shape (where the story goes is read from any). */
export type CampaignScene=CampaignFile<SceneDocument>&{value?:unknown};

/** The campaign around a file, as the scenario, map and place editors see it. */
export type CampaignFiles={
  root:string;
  /** The scenario's path in the vault, its text and its document, when the campaign has one that parses. */
  scenarioPath?:string;
  scenarioText?:string;
  scenario?:ScenarioDocument;
  /** Why the scenario couldn't be read, if it couldn't: then nothing needing it is checked or offered. */
  error?:string;
  /** The scenario's scenes in story order, then its talk template. */
  scenes:CampaignScene[];
  maps:CampaignFile<MapDocument>[];
  places:CampaignFile<PlaceDocument>[];
  /** The keys of the files in the folder's scenes/, maps/ and places/, listed in the scenario or not. */
  present:{scenes:string[];maps:string[];places:string[]};
  /** How the cast look on screen (looks.json): a glyph and a colour by cast id. */
  looks:Record<string,{glyph?:string;fg?:string}>;
  /** Every file under lore/, by its path there. */
  lore:string[];
};

/** The campaign around the file at `path`: its scenario and every scene, map and place it lists. */
export async function readCampaignFiles(path:string,files:VaultFiles):Promise<CampaignFiles>{
  const root=campaignRootOf(path);
  const all=files.list(root).filter(file=>file.startsWith(root)).map(file=>file.slice(root.length));
  const inFolder=(folder:string,extension:string)=>all.filter(file=>file.startsWith(`${folder}/`)&&file.split('/').length===2&&file.endsWith(extension)).map(keyOfPath).sort((a,b)=>a.localeCompare(b));
  const present={scenes:inFolder('scenes','.kmscene'),maps:inFolder('maps',MAP_EXTENSION),places:inFolder('places',PLACE_EXTENSION)};
  const lore=all.filter(file=>file.startsWith('lore/')).map(file=>file.slice(5)).sort((a,b)=>a.localeCompare(b));
  const looks=await readLooks(root,files);
  const empty:CampaignFiles={root,scenes:[],maps:[],places:[],present,looks,lore};

  const found=scenarioPathIn(all);
  if(!found){
    const scenarios=all.filter(file=>!file.includes('/')&&file.endsWith(SCENARIO_EXTENSION));
    return {...empty,error:scenarios.length>1?`the campaign folder has ${scenarios.length} scenarios (${scenarios.join(', ')}): a campaign has one`:`the campaign has no scenario (${root}<id>${SCENARIO_EXTENSION})`};
  }
  const scenarioPath=`${root}${found}`;
  const scenarioText=await files.read(scenarioPath);
  if(scenarioText===undefined)return {...empty,scenarioPath,error:`${scenarioPath} isn't there`};
  let scenario:ScenarioDocument;
  try{scenario=parseScenario(scenarioText,found)}catch(error){return {...empty,scenarioPath,scenarioText,error:messageOf(error)}}

  const sceneKeys=[...scenario.scenes,...(scenario.talk!==undefined&&!scenario.scenes.includes(scenario.talk)?[scenario.talk]:[])];
  const [scenes,maps,places]=await Promise.all([
    Promise.all(sceneKeys.map(key=>readScene(root,key,files))),
    Promise.all(scenario.maps.map(key=>readOne(pathIn.map(root,key),key,files,text=>parseMap(text,mapPath(key))))),
    Promise.all(scenario.places.map(key=>readOne(pathIn.place(root,key),key,files,text=>parsePlace(text,placePath(key))))),
  ]);
  return {...empty,scenarioPath,scenarioText,scenario,scenes,maps,places};
}

async function readOne<T>(path:string,key:string,files:VaultFiles,parse:(text:string)=>T):Promise<CampaignFile<T>>{
  const text=await files.read(path);
  if(text===undefined)return {key,path,error:`${path} isn't there`};
  try{return {key,path,text,doc:parse(text)}}catch(error){return {key,path,text,error:messageOf(error)}}
}

async function readScene(root:string,key:string,files:VaultFiles):Promise<CampaignScene>{
  const path=pathIn.scene(root,key);
  const text=await files.read(path);
  if(text===undefined)return {key,path,error:`${path} isn't there`};
  let value:unknown;
  try{value=JSON.parse(text)}catch(error){return {key,path,text,error:`it isn't JSON (${messageOf(error)})`}}
  try{return {key,path,text,value,doc:parseScene(text,`scenes/${key}.kmscene`)}}catch(error){return {key,path,text,value,error:messageOf(error)}}
}

async function readLooks(root:string,files:VaultFiles):Promise<CampaignFiles['looks']>{
  const text=await files.read(`${root}looks.json`);
  if(text===undefined)return {};
  try{
    const value=JSON.parse(text);
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }catch{return {}}
}

const messageOf=(error:unknown)=>error instanceof Error?error.message:String(error);

// ---------------------------------------------------------------------------------------------
// Drafts and the rules.

/** The campaign with one of its files as an editor has it now (its document, and the text it saves as). */
export function withDraft(campaign:CampaignFiles,kind:'scenario'|'map'|'place',key:string,doc:ScenarioDocument|MapDocument|PlaceDocument,text:string):CampaignFiles{
  if(kind==='scenario')return {...campaign,scenario:doc as ScenarioDocument,scenarioText:text,error:undefined};
  const swap=<T,>(list:CampaignFile<T>[])=>list.map(file=>file.key===key?{...file,text,doc:doc as T,error:undefined}:file);
  return kind==='map'?{...campaign,maps:swap(campaign.maps)}:{...campaign,places:swap(campaign.places)};
}

/** A problem as the editors list it: the rules' own, with the file's path in the vault. */
export type CampaignProblem=ScenarioProblem&{path:string};

/**
 * What the campaign check would say of the scenario, its maps and its places (scenario-rules.ts): a
 * listed file that's missing or not of its format's shape first, and then, when every one is, the
 * rules. Each problem has its file, and where in it.
 */
export function campaignProblems(campaign:CampaignFiles):CampaignProblem[]{
  const {root,scenario}=campaign;
  if(!scenario||!campaign.scenarioPath)return [];
  const scenarioFile=campaign.scenarioPath.slice(root.length);
  const problems:CampaignProblem[]=[];
  const add=(file:string,message:string,at:ScenarioProblemAt)=>problems.push({file,message,at,path:`${root}${file}`});
  for(const scene of campaign.scenes)if(scene.text===undefined)add(scenarioFile,`its scene ${scene.key} has no file (scenes/${scene.key}.kmscene)`,{kind:'scenario',field:'scenes'});
  for(const map of campaign.maps){
    if(map.text===undefined)add(scenarioFile,`its map ${map.key} has no file (${mapPath(map.key)})`,{kind:'scenario',field:'maps'});
    else if(map.error)add(mapPath(map.key),map.error,{kind:'map',map:map.key});
  }
  for(const place of campaign.places){
    if(place.text===undefined)add(scenarioFile,`its place ${place.key} has no file (${placePath(place.key)})`,{kind:'scenario',field:'places'});
    else if(place.error)add(placePath(place.key),place.error,{kind:'place',place:place.key});
  }
  if(problems.length)return problems;
  const rules:ScenarioCampaign={
    path:scenarioFile,scenario,
    maps:campaign.maps.map(map=>({key:map.key,doc:map.doc!})),
    places:campaign.places.map(place=>({key:place.key,doc:place.doc!})),
    scenes:campaign.scenes.filter(scene=>scene.value!==undefined).map(scene=>({key:scene.key,doc:(scene.doc??scene.value) as SceneDocument})),
  };
  return [...scenarioRuleProblems(rules),...mapRuleProblems(rules),...placeRuleProblems(rules),...flowProblems(rules)].map(problem=>({...problem,path:`${root}${problem.file}`}));
}

/** Where a scene's endings go: each ending's id, title, result and next, read from a scene of any shape. */
export function endingsOf(scene:CampaignScene):Array<{id:string;title:string;result?:string;next?:string}>{
  const value=(scene.doc??scene.value) as {nodes?:unknown}|undefined;
  const nodes=Array.isArray(value?.nodes)?value!.nodes as unknown[]:[];
  return nodes.flatMap(node=>{
    const n=node as {id?:unknown;data?:{kind?:unknown;title?:unknown;result?:unknown;next?:unknown}}|null;
    if(!n||typeof n.id!=='string'||n.data?.kind!=='exit')return [];
    return [{id:n.id,title:typeof n.data.title==='string'&&n.data.title?n.data.title:n.id,...(typeof n.data.result==='string'?{result:n.data.result}:{}),...(typeof n.data.next==='string'?{next:n.data.next}:{})}];
  });
}

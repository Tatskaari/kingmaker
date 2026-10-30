// The plugin's model of the scenario (<campaign>.kmscenario, docs/scenario-format.md): its own fields,
// edited as the plain JSON it is, and the story's flow drawn from the files that own it. The flow is
// never stored: a scene's ending goes on to its `next` (the scene's file), a map's region plays its
// `sceneId` and its exits lead to other maps (the map's file), and the scenario says where the story
// starts. The diagram's layout is the scenario's own (`layout`, which the game doesn't read).
import {parseScenario,scenarioShapeProblems} from '../../../../shared/scene/scenario.ts';
import type {ScenarioDocument} from '../../../../shared/scene/scenario.ts';
import type {MapDocument} from '../../../../shared/scene/scenario.ts';
import {standable} from '../../../../shared/scene/scenario-rules.ts';
import {mapOf} from '../../../../shared/map/tiles.ts';
import {asMapFile} from '../../../../shared/scene/scenario.ts';
import type {Tile2} from '../../../../shared/map/types.ts';
import {serializeJson,slugOf,withKey} from '../campaign/json.ts';
import {endingsOf} from '../campaign/files.ts';
import type {CampaignFile,CampaignFiles,CampaignScene,SceneDocument} from '../campaign/files.ts';

export type {ScenarioDocument,Tile2};

export const ORDER={
  scenario:['format','version','kind','id','title','description','campaignVersion','firstScene','startPlace','start','level','rulesPack','scenes','talk','places','maps','startingPurse','creation','quests','layout'],
  start:['day','time','map','at'],
  coin:['name','quantity','description'],
  creation:['name','premise','begins','primer','notCanon','places'],
  creationPlace:['doc','words'],
  point:['x','y'],
} as const;

export const openScenarioFile=(text:string,where='the scenario'):ScenarioDocument=>parseScenario(text,where);
export const serializeScenario=(doc:ScenarioDocument):string=>serializeJson(doc);
export const scenarioShapeOf=(doc:ScenarioDocument):string[]=>scenarioShapeProblems(doc);

export const setScenarioField=(doc:ScenarioDocument,key:string,value:unknown):ScenarioDocument=>withKey(doc,key,value,ORDER.scenario);
export const setStartField=(doc:ScenarioDocument,key:string,value:unknown):ScenarioDocument=>{
  const start=withKey(doc.start,key,value,ORDER.start);
  return start===doc.start?doc:withKey(doc,'start',start,ORDER.scenario);
};
export const setCreationField=(doc:ScenarioDocument,key:string,value:unknown):ScenarioDocument=>{
  const creation=withKey(doc.creation,key,value,ORDER.creation);
  return creation===doc.creation?doc:withKey(doc,'creation',creation,ORDER.scenario);
};

/** The story starting on a map's tile (or, with none, opening its first scene at once). */
export function withStart(doc:ScenarioDocument,map:string|undefined,at:Tile2|undefined):ScenarioDocument{
  let start=withKey(doc.start,'map',map,ORDER.start);
  const pair=at?(doc.start.at&&doc.start.at[0]===at.x&&doc.start.at[1]===at.y?doc.start.at:[at.x,at.y] as [number,number]):undefined;
  start=withKey(start,'at',pair,ORDER.start);
  return start===doc.start?doc:withKey(doc,'start',start,ORDER.scenario);
}

/** A new scenario's file: the format's fields, empty for the author to write, a campaign with nothing in it yet. */
export function newScenario(title:string,id=slugOf(title)):ScenarioDocument{
  return {
    format:'kingmaker',version:2,kind:'scenario',id,title,description:'',
    campaignVersion:'0.1.0',firstScene:'',startPlace:'',
    start:{day:1,time:'morning'},level:1,rulesPack:'starter-pack@0.1.0',
    scenes:[],places:[],maps:[],startingPurse:[],
    creation:{name:title,premise:'',primer:'',notCanon:[],places:[]},
    quests:{},
  };
}

// ---------------------------------------------------------------------------------------------
// The flow, as the diagram draws it.

/** A card on the diagram: the start, a scene or a map. */
export type FlowCard={
  id:string;
  kind:'start'|'scene'|'map';
  /** The scene's or map's key (its file's name). */
  key?:string;
  title:string;
  subtitle:string;
  /** The file it is, when it's a scene or a map: its path, and why it can't be read, if it can't. */
  path?:string;
  error?:string;
  /** Where it goes from: an ending, a region that plays a scene, the ways to another map, the start's two. */
  ports:FlowPort[];
  /** The layout key it's kept by (the scenario's `layout`). */
  layoutKey:string;
};

/** A way out of a card: its id on the card, what it says, and where it goes (a card's id), with what owns it. */
export type FlowPort={id:string;label:string;detail?:string;target?:string;owner:FlowOwner};

/** Who owns an edge, and what of theirs it is: the file an edit of it is written to. */
export type FlowOwner=
  |{kind:'start'}
  |{kind:'lead'}
  |{kind:'ending';scene:string;ending:string}
  |{kind:'region';map:string;index:number;region:string}
  |{kind:'exits';map:string;indices:number[];label:string;to:string};

export type FlowEdge={id:string;source:string;sourceHandle:string;target:string;label:string;owner:FlowOwner;dashed?:boolean};
export type Flow={cards:FlowCard[];edges:FlowEdge[]};

export const sceneCard=(key:string)=>`scene:${key}`;
export const mapCard=(key:string)=>`map:${key}`;
export const START_CARD='start';

/** The flow of the scenario `doc` over the campaign's files: its cards (the start, its scenes in order, its maps) and the edges their owners give them. */
export function flowOf(doc:ScenarioDocument,campaign:CampaignFiles):Flow{
  const scenes=new Map(campaign.scenes.map(scene=>[scene.key,scene]));
  const maps=new Map(campaign.maps.map(map=>[map.key,map]));
  const cards:FlowCard[]=[],edges:FlowEdge[]=[];
  const sceneTarget=(id:string|undefined)=>id!==undefined&&doc.scenes.includes(id)?sceneCard(id):undefined;
  const mapTarget=(id:string|undefined)=>id!==undefined&&doc.maps.includes(id)?mapCard(id):undefined;

  // The start: where the player starts walking (a map's tile), and the story's first lead.
  const start=doc.start;
  const startPorts:FlowPort[]=[
    {id:'start:map',label:start.map?`Starts on ${titleOf(maps.get(start.map),start.map)}`:'Starts in the first scene',detail:start.map?(start.at?`at (${start.at[0]}, ${start.at[1]})`:'no tile yet'):'no map: it opens at once',target:mapTarget(start.map)??(start.map===undefined?sceneTarget(doc.firstScene):undefined),owner:{kind:'start'}},
    ...(start.map!==undefined?[{id:'start:lead',label:'First lead',detail:doc.firstScene||'none yet',target:sceneTarget(doc.firstScene),owner:{kind:'lead'} as FlowOwner}]:[]),
  ];
  cards.push({id:START_CARD,kind:'start',title:'Start',subtitle:`Day ${start.day}, ${start.time.replace('-',' ')}`,ports:startPorts,layoutKey:'start'});

  for(const key of doc.scenes){
    const scene=scenes.get(key);
    const endings=scene?endingsOf(scene):[];
    const d=scene?.doc;
    cards.push({
      id:sceneCard(key),kind:'scene',key,title:titleOf(scene,key),
      subtitle:[d?.interlude?'interlude':undefined,d?.time,d?.place?`place: ${d.place}`:undefined].filter(Boolean).join(' · ')||(scene?.error?'':'a scene'),
      path:scene?.path,...(scene?.error?{error:scene.error}:{}),
      ports:endings.map(ending=>({id:`ending:${ending.id}`,label:ending.title,detail:ending.result,target:sceneTarget(ending.next),owner:{kind:'ending',scene:key,ending:ending.id}})),
      layoutKey:`scenes/${key}`,
    });
  }
  for(const key of doc.maps){
    const map=maps.get(key),m=map?.doc;
    const ports:FlowPort[]=[];
    m?.regions.forEach((region,index)=>{
      if(region.sceneId===undefined)return;
      ports.push({id:`region:${index}`,label:region.name||region.id,detail:region.worldOrigin?'lays its place':region.trigger?`opens it (${region.trigger})`:undefined,target:sceneTarget(region.sceneId),owner:{kind:'region',map:key,index,region:region.id}});
    });
    const groups=new Map<string,number[]>();
    m?.exits.forEach((exit,index)=>{const id=JSON.stringify([exit.to.map,exit.label]);groups.set(id,[...(groups.get(id)??[]),index])});
    for(const [id,indices] of groups){
      const [to,label]=JSON.parse(id) as [string,string];
      ports.push({id:`exits:${id}`,label:label||`to ${to}`,detail:indices.length>1?`${indices.length} tiles`:undefined,target:mapTarget(to),owner:{kind:'exits',map:key,indices,label,to}});
    }
    cards.push({
      id:mapCard(key),kind:'map',key,title:titleOf(map,key),
      subtitle:m?`${Math.max(0,...m.grid.map(row=>[...row].length))} × ${m.grid.length} tiles · ${m.regions.length} region${m.regions.length===1?'':'s'}`:'',
      path:map?.path,...(map?.error?{error:map.error}:{}),ports,layoutKey:`maps/${key}`,
    });
  }
  for(const card of cards)for(const port of card.ports){
    if(port.target===undefined)continue;
    const owner=port.owner;
    edges.push({id:`${card.id}>${port.id}`,source:card.id,sourceHandle:port.id,target:port.target,label:port.label,owner,...(owner.kind==='lead'||owner.kind==='region'&&!campaign.maps.find(m=>m.key===owner.map)?.doc?.regions[owner.index]?.worldOrigin?{dashed:true}:{})});
  }
  return {cards,edges};
}

const titleOf=(file:CampaignFile<{title:string}>|CampaignScene|undefined,key:string)=>(file?.doc as {title?:string}|undefined)?.title||key;

/**
 * Where each card goes when the layout doesn't say: the start on the left, the story's scenes in their
 * order along the top, and the maps beneath them, in the scenario's order.
 */
export function layoutOf(flow:Flow,layout:Record<string,{x:number;y:number}>|undefined):Map<string,{x:number;y:number}>{
  const out=new Map<string,{x:number;y:number}>();
  let scene=0,map=0;
  for(const card of flow.cards){
    const stored=layout?.[card.layoutKey];
    const position=card.kind==='start'?{x:-380,y:200}:card.kind==='scene'?{x:(scene++)*380,y:0}:{x:(map++)*380,y:460};
    out.set(card.id,stored??position);
  }
  return out;
}

/** The scenario with a card's place on the diagram kept (whole numbers of pixels). */
export function withLayout(doc:ScenarioDocument,positions:Record<string,{x:number;y:number}>):ScenarioDocument{
  let layout=doc.layout??{};
  for(const [key,p] of Object.entries(positions)){
    const point={x:Math.round(p.x),y:Math.round(p.y)};
    const old=layout[key];
    if(old&&old.x===point.x&&old.y===point.y)continue;
    layout=withKey(layout,key,old?withKey(withKey(old,'x',point.x,ORDER.point),'y',point.y,ORDER.point):point,[]);
  }
  return layout===(doc.layout??{})?doc:withKey(doc,'layout',layout,ORDER.scenario);
}

// ---------------------------------------------------------------------------------------------
// Landing tiles.

/**
 * Where a way into a map lands by default: just inside a way back out of it to `from`, if it has one
 * (the standable tile nearest it that isn't a way out itself, a step straight out before one aslant),
 * else the standable tile nearest its middle. The author moves it as they like; the campaign check says if nobody can stand there.
 */
export function landingOn(map:MapDocument|undefined,from?:string):Tile2{
  if(!map)return {x:0,y:0};
  const width=Math.max(1,...map.grid.map(row=>[...row].length)),height=map.grid.length;
  const middle={x:Math.floor(width/2),y:Math.floor(height/2)};
  const back=from!==undefined?map.exits.find(exit=>exit.to.map===from):undefined;
  const near=back?back.at:middle;
  let built;
  try{built=mapOf(asMapFile(map)).map}catch{return near}
  const exits=new Set(map.exits.map(exit=>`${exit.at.x},${exit.at.y}`));
  let best:Tile2|undefined,score=Infinity;
  for(let y=0;y<built.height;y++)for(let x=0;x<built.width;x++){
    if(exits.has(`${x},${y}`)||!standable(built,{x,y}))continue;
    // Nearest the way in (a step straight out of it before one aslant), then nearest the middle.
    const d=Math.max(Math.abs(x-near.x),Math.abs(y-near.y))*10000+(Math.abs(x-near.x)+Math.abs(y-near.y))*100+Math.abs(x-middle.x)+Math.abs(y-middle.y);
    if(d<score){best={x,y};score=d}
  }
  return best??near;
}

// ---------------------------------------------------------------------------------------------
// Where the campaign's files name each other: shown both ways (a scene's card says where it's played,
// a quest's where it's named), each a link there.

/** Where a scene is named: the regions that play it (laying its place or opening it), the endings that go on to it, and whether it's the first lead; and where it goes, by its endings. */
export type SceneUses={
  regions:Array<{map:string;mapTitle:string;region:string;name:string;lays:boolean}>;
  from:Array<{scene:string;sceneTitle:string;ending:string;title:string}>;
  first:boolean;
  next:Array<{ending:string;title:string;next?:string}>;
  place?:string;
};

export function sceneUsesOf(key:string,doc:ScenarioDocument,campaign:CampaignFiles):SceneUses{
  const scene=campaign.scenes.find(file=>file.key===key);
  return {
    regions:campaign.maps.flatMap(map=>(map.doc?.regions??[]).filter(region=>region.sceneId===key).map(region=>({map:map.key,mapTitle:titleOf(map,map.key),region:region.id,name:region.name||region.id,lays:!!region.worldOrigin}))),
    from:campaign.scenes.filter(other=>other.key!==key).flatMap(other=>endingsOf(other).filter(ending=>ending.next===key).map(ending=>({scene:other.key,sceneTitle:titleOf(other,other.key),ending:ending.id,title:ending.title}))),
    first:doc.firstScene===key,
    next:scene?endingsOf(scene).map(ending=>({ending:ending.id,title:ending.title,...(ending.next?{next:ending.next}:{})})):[],
    ...(scene?.doc?.place?{place:scene.doc.place}:{}),
  };
}

/** Where a map is named: the ways out of it (grouped by where they lead), the ways into it from the others, the regions on it that play a scene, and whether the story starts on it. */
export type MapUses={
  out:Array<{to:string;label:string;count:number}>;
  into:Array<{from:string;fromTitle:string;label:string;count:number}>;
  plays:Array<{region:string;name:string;scene:string;lays:boolean}>;
  start:boolean;
};

export function mapUsesOf(key:string,doc:ScenarioDocument,campaign:CampaignFiles):MapUses{
  const map=campaign.maps.find(file=>file.key===key)?.doc;
  const grouped=(exits:Array<{to:{map:string};label:string}>,by:(exit:{to:{map:string};label:string})=>string)=>{const groups=new Map<string,{exit:{to:{map:string};label:string};count:number}>();for(const exit of exits){const id=by(exit);const old=groups.get(id);groups.set(id,{exit,count:(old?.count??0)+1})}return [...groups.values()]};
  return {
    out:grouped(map?.exits??[],exit=>JSON.stringify([exit.to.map,exit.label])).map(({exit,count})=>({to:exit.to.map,label:exit.label,count})),
    into:campaign.maps.filter(other=>other.key!==key).flatMap(other=>grouped((other.doc?.exits??[]).filter(exit=>exit.to.map===key),exit=>exit.label).map(({exit,count})=>({from:other.key,fromTitle:titleOf(other,other.key),label:exit.label,count}))),
    plays:(map?.regions??[]).filter(region=>region.sceneId!==undefined).map(region=>({region:region.id,name:region.name||region.id,scene:region.sceneId!,lays:!!region.worldOrigin})),
    start:doc.start.map===key,
  };
}

/** Where a place is named: the scenes played in it, the regions that lay it on a map (each scene's), and whether it's the scenario's start place. */
export type PlaceUses={
  scenes:Array<{key:string;title:string}>;
  laid:Array<{map:string;mapTitle:string;region:string;name:string;origin:Tile2;scene:string}>;
  start:boolean;
};

export function placeUsesOf(key:string,doc:ScenarioDocument|undefined,campaign:CampaignFiles):PlaceUses{
  const scenes=campaign.scenes.filter(scene=>scene.doc?.place===key);
  const names=new Set(scenes.map(scene=>scene.key));
  return {
    scenes:scenes.map(scene=>({key:scene.key,title:titleOf(scene,scene.key)})),
    laid:campaign.maps.flatMap(map=>(map.doc?.regions??[]).filter(region=>region.worldOrigin&&region.sceneId!==undefined&&names.has(region.sceneId)).map(region=>({map:map.key,mapTitle:titleOf(map,map.key),region:region.id,name:region.name||region.id,origin:region.worldOrigin!,scene:region.sceneId!}))),
    start:doc?.startPlace===key,
  };
}

/** An effect of a scene that names a quest: which scene, where (an ending's effects, the scene's as it starts, onStart, or every ending's, onEnd), its place in that list, and what it does to the quest. */
export type QuestUse={scene:string;sceneTitle:string;at:{kind:'ending';id:string;title:string}|{kind:'onStart'}|{kind:'onEnd'};index:number;step?:string};

/** Every effect of the campaign's scenes naming the quest `key`. */
export function questUsesOf(key:string,campaign:CampaignFiles):QuestUse[]{
  return campaign.scenes.flatMap(scene=>{
    const doc=scene.doc;if(!doc)return [];
    const title=titleOf(scene,scene.key);
    const named=(effects:readonly unknown[]|undefined)=>(effects??[]).map((effect,index)=>({effect:effect as {op?:unknown;quest?:unknown;do?:unknown},index})).filter(({effect})=>effect.op==='quest'&&effect.quest===key);
    return [
      ...named(doc.onStart).map(({effect,index})=>({scene:scene.key,sceneTitle:title,at:{kind:'onStart' as const},index,...(typeof effect.do==='string'?{step:effect.do}:{})})),
      ...named(doc.onEnd).map(({effect,index})=>({scene:scene.key,sceneTitle:title,at:{kind:'onEnd' as const},index,...(typeof effect.do==='string'?{step:effect.do}:{})})),
      ...doc.nodes.filter(node=>node.data.kind==='exit').flatMap(node=>named((node.data as {effects?:unknown[]}).effects).map(({effect,index})=>({scene:scene.key,sceneTitle:title,at:{kind:'ending' as const,id:node.id,title:node.data.title||node.id},index,...(typeof effect.do==='string'?{step:effect.do}:{})}))),
    ];
  });
}

/** A quest's key renamed in the scenario's quests, where it was (its title kept). */
export function renameQuest(doc:ScenarioDocument,from:string,to:string):ScenarioDocument{
  const quests=doc.quests??{};
  if(!(from in quests)||from===to)return doc;
  return withKey(doc,'quests',Object.fromEntries(Object.entries(quests).map(([key,title])=>[key===from?to:key,title])),ORDER.scenario);
}

/** A scene with every effect naming the quest `from` naming `to` (its keys where they were): the same scene when none does. */
export function renameQuestIn(scene:SceneDocument,from:string,to:string):SceneDocument{
  const renamed=(effects:unknown[]|undefined)=>{
    if(!effects)return effects;
    let changed=false;
    const next=effects.map(effect=>{const e=effect as {op?:unknown;quest?:unknown};if(e.op!=='quest'||e.quest!==from)return effect;changed=true;return withKey(e as object,'quest',to,['op','quest'])});
    return changed?next:effects;
  };
  let next=scene;
  const onStart=renamed(scene.onStart as unknown[]|undefined);
  if(onStart!==scene.onStart)next={...next,onStart:onStart as SceneDocument['onStart']};
  const onEnd=renamed(scene.onEnd as unknown[]|undefined);
  if(onEnd!==scene.onEnd)next={...next,onEnd:onEnd as SceneDocument['onEnd']};
  const nodes=scene.nodes.map(node=>{
    if(node.data.kind!=='exit')return node;
    const data=node.data as {effects?:unknown[]};
    const effects=renamed(data.effects);
    return effects===data.effects?node:{...node,data:{...node.data,effects} as typeof node.data};
  });
  if(nodes.some((node,i)=>node!==scene.nodes[i]))next={...next,nodes};
  return next;
}

/** Why a quest's key can't be `key`: not a slug, or another quest's. */
export function questKeyProblem(doc:ScenarioDocument,key:string,current?:string):string|undefined{
  if(!/^[a-z0-9][a-z0-9-]*$/.test(key))return 'A quest\'s key is a slug: lower-case letters, digits and dashes.';
  if(key!==current&&key in (doc.quests??{}))return `There's a quest ${key} already.`;
  return undefined;
}

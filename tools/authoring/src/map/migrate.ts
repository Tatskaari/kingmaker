// A version 1 map (the plugin's own .kmmap before M4: a palette id per tile, a clutter layer, and spawn
// points and interactions as graph nodes) migrated to the game's map format, version 2
// (docs/scenario-format.md, "The user's v1 maps migrate").
import type {MapDocument} from '../../../../shared/scene/scenario.ts';
import {mapDocumentOf} from '../../../../shared/scene/scenario.ts';
import type {LegendEntry,PlaceRegion,Tile2} from './model.ts';
import {DEFAULT_LEGEND,ORDER,cleanEntry,freeChar} from './model.ts';
import {slugOf,uniqueId,withKey} from '../campaign/json.ts';

/** The version 1 palette's ids and the clutter's, as the plugin's version 1 maps have them. */
export const V1_PALETTE=['grass','dirt','cobbles','boards','water','deep-water','bridge','stone','timber','door','window','roof','tree','fence','stairs'] as const;
export const V1_CLUTTER=['lamp','sign','crate','barrel','bench'] as const;

type V1Node={id:string;data:{kind?:string;title?:string;mapFeature?:'spawn'|'interaction';mapAt?:Tile2;eventMessage?:string;exitPort?:string;script?:string;file?:string;entry?:string;next?:string;destinationKind?:string}};
type V1Terrain={version:1;width:number;height:number;tiles:string[];clutter?:Array<string|null>};
/** What a version 1 map file holds, as far as the migration reads it. */
export type V1Map={format:'kingmaker';version:1;kind:'map';id:string;title:string;description:string;nodes:V1Node[];edges:unknown[];lore?:string[];terrain?:V1Terrain;[key:string]:unknown};

/** A version 1 map's spawn point: a named tile where a scenario's player arrived. */
export type V1Spawn={id:string;title:string;at:Tile2};
/** Where a version 1 interaction's exit went, as the vault has it now: a map and the tile its entry was, or a scene. */
export type Destination={kind:'map';id:string;at:Tile2}|{kind:'scene';id:string};

/** A version 1 map file's text as the map it is: its palette, clutter and features checked; or why it can't be migrated. */
export function readV1Map(text:string):V1Map{
  const value=JSON.parse(text) as V1Map;
  if(!value||value.format!=='kingmaker'||value.version!==1||value.kind!=='map')throw new Error('It isn\'t a version 1 map of the plugin.');
  if(typeof value.title!=='string'||!Array.isArray(value.nodes))throw new Error('It has no title or no nodes.');
  const t=value.terrain;
  if(t!==undefined){
    const size=(n:unknown)=>Number.isInteger(n)&&(n as number)>=1;
    if(!t||t.version!==1||!size(t.width)||!size(t.height)||!Array.isArray(t.tiles)||t.tiles.length!==t.width*t.height)throw new Error('Its terrain isn\'t a version 1 grid (a palette id a tile).');
    const unknown=[...new Set(t.tiles.filter(id=>!(V1_PALETTE as readonly string[]).includes(id)))];
    if(unknown.length)throw new Error(`Its terrain has palette ids the version 1 palette hasn't got: ${unknown.join(', ')}.`);
    if(t.clutter!==undefined&&(!Array.isArray(t.clutter)||t.clutter.length!==t.tiles.length||t.clutter.some(id=>id!==null&&!(V1_CLUTTER as readonly string[]).includes(id))))throw new Error('Its clutter isn\'t a version 1 clutter layer (a clutter id or none a tile).');
  }
  return value;
}

/** A version 1 map's spawn points. */
export const spawnsOf=(v1:V1Map):V1Spawn[]=>v1.nodes.filter(node=>node.data?.mapFeature==='spawn'&&node.data.mapAt).map(node=>({id:node.id,title:node.data.title||'spawn',at:{x:node.data.mapAt!.x,y:node.data.mapAt!.y}}));

/** What a migration makes: the map, what each legend character was, and what became of each spawn point and interaction. */
export type Migration={doc:MapDocument;legend:Array<{ch:string;was:string}>;notes:string[]};

/**
 * A version 1 map as a version 2 one, `id` its id. Each palette id the grid uses becomes a legend
 * character (the default legend's, so a migrated map paints like a new one), and each pair of a
 * palette id and the clutter standing on it becomes one too (the default legend's clutter character
 * on cobbles, a character of its own on anything else). The spawn point `start` becomes the
 * scenario's start (the caller writes it); any other spawn point is kept as a region of one tile,
 * named for it. An interaction whose exit led to a map becomes an exit to that map's tile, one whose
 * exit led to a scene a region that plays it (opened by interacting), and any other a region of one
 * tile, its event message its description. The rest of the file (its unknown keys, its lore) is kept.
 */
export function migrateV1Map(v1:V1Map,options:{id:string;start?:string;destination?:(file:string,entry:string|undefined)=>Destination|undefined;takenRegionIds?:Iterable<string>}):Migration{
  const t:V1Terrain=v1.terrain??{version:1,width:32,height:24,tiles:Array(32*24).fill('grass')};
  const notes:string[]=[];
  // The legend: the palette ids and pairs the grid uses, the default legend's characters where it has them.
  const byId=new Map(DEFAULT_LEGEND.map(item=>[item.id,item]));
  const legend:Record<string,LegendEntry>={};
  const charOf=new Map<string,string>(),was:Array<{ch:string;was:string}>=[];
  // A pair the default legend hasn't got takes a character of its own: its clutter's in capitals (a lamp on grass is L) if that's free, never one of the default legend's.
  const reserved=new Set(DEFAULT_LEGEND.map(item=>item.ch));
  const own=(prefer:string)=>{const draft={legend:{...legend,...Object.fromEntries([...reserved].map(ch=>[ch,{terrain:'void'}]))}} as unknown as MapDocument;return freeChar(draft,[prefer])};
  const used=new Set(t.tiles.map((id,i)=>`${id}|${t.clutter?.[i]??''}`));
  const ordered=[...used].sort((a,b)=>orderOf(a)-orderOf(b));
  for(const pair of ordered){
    const [ground,clutter]=pair.split('|');
    const plain=byId.get(ground)!;
    const item=clutter?byId.get(clutter)!:undefined;
    const [ch,entry]=!item?[plain.ch,plain.entry]:ground==='cobbles'?[item.ch,item.entry]:[own(item.ch.toUpperCase()),{...plain.entry,decor:item.entry.decor}];
    legend[ch]=cleanEntry(entry);
    charOf.set(pair,ch);
    was.push({ch,was:item?`${clutter} on ${ground}`:ground});
  }
  const grid=Array.from({length:t.height},(_,y)=>Array.from({length:t.width},(_,x)=>{const i=y*t.width+x;return charOf.get(`${t.tiles[i]}|${t.clutter?.[i]??''}`)}).join(''));

  // The features: spawn points and interactions.
  const regions:PlaceRegion[]=[],exits:MapDocument['exits']=[];
  const taken=new Set(options.takenRegionIds??[]);
  const regionId=(title:string)=>{const id=uniqueId(slugOf(title)||'region',taken);taken.add(id);return id};
  const tile=(at:Tile2)=>({x:at.x,y:at.y,w:1,h:1});
  for(const node of v1.nodes){
    const d=node.data??{},at=d.mapAt;
    if(!at||!d.mapFeature)continue;
    const title=d.title||(d.mapFeature==='spawn'?'spawn':'interaction');
    if(d.mapFeature==='spawn'){
      if(node.id===options.start){notes.push(`The spawn point “${title}” (${at.x}, ${at.y}) is the scenario's start.`);continue}
      const id=regionId(title);
      regions.push({id,name:title,rect:tile(at)});
      notes.push(`The spawn point “${title}” (${at.x}, ${at.y}) is the region ${id}.`);
      continue;
    }
    const port=d.exitPort?.trim();
    const target=port&&d.file?options.destination?.(d.file,d.entry):undefined;
    if(target?.kind==='map'){
      exits.push({at:{x:at.x,y:at.y},to:{map:target.id,at:{x:target.at.x,y:target.at.y}},label:port!});
      notes.push(`The interaction “${title}” is an exit, “${port}”, to ${target.id} (${target.at.x}, ${target.at.y}).`);
      continue;
    }
    const id=regionId(title);
    let region:PlaceRegion={id,name:title,rect:tile(at)};
    if(target?.kind==='scene'){
      region=withKey(region,'sceneId',target.id,ORDER.region);
      region=withKey(region,'trigger','interact',ORDER.region);
      region=withKey(region,'label',port!,ORDER.region);
    }else if(port)region=withKey(region,'label',port,ORDER.region);
    if(d.eventMessage?.trim())region=withKey(region,'description',d.eventMessage,ORDER.region);
    if(d.script?.trim())region={...region,notes:d.script} as PlaceRegion;
    regions.push(region);
    notes.push(target?.kind==='scene'?`The interaction “${title}” is the region ${id}, which plays ${target.id}.`
      :port&&d.file?`The interaction “${title}” is the region ${id}: where its exit went (${d.file}) isn't a map or scene the migration could find.`
      :`The interaction “${title}” is the region ${id}.`);
  }

  // The file: the envelope, the map, and whatever else the version 1 file had that wasn't its graph.
  const {format:_f,version:_v,kind:_k,id:_i,title,description,nodes:_n,edges:_e,terrain:_t,lore,...rest}=v1;
  const doc={
    format:'kingmaker',version:2,kind:'map',id:options.id,title,description:description??'',
    grid,legend,regions,exits,
    ...(Array.isArray(lore)&&lore.length?{lore}:{}),
    ...rest,
  };
  return {doc:mapDocumentOf(doc,`${options.id}.kmmap`),legend:was,notes};
}

const PAIR_ORDER=[...V1_PALETTE,...V1_CLUTTER];
/** A pair's place in the legend: the default legend's order, the plain ground before what stands on it. */
function orderOf(pair:string):number{
  const [ground,clutter]=pair.split('|');
  return PAIR_ORDER.indexOf(ground as never)*100+(clutter?1+PAIR_ORDER.indexOf(clutter as never):0);
}

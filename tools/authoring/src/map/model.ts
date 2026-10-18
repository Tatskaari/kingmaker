// The plugin's model of a map file (maps/<id>.kmmap, docs/scenario-format.md): the game's own format,
// read with the game's parse and edited as the plain JSON it is. The grid is rows of legend characters;
// the painter works on it as cells, one character a tile, and writes back only the rows it changed.
import {mapShapeProblems,parseMap} from '../../../../shared/scene/scenario.ts';
import type {MapDocument} from '../../../../shared/scene/scenario.ts';
import {TERRAINS} from '../../../../shared/map/tiles.ts';
import type {DecorDef,LegendEntry,MapPerson,PlaceRegion} from '../../../../shared/map/tiles.ts';
import type {Terrain,Tile2} from '../../../../shared/map/types.ts';
import {MAP_LIMIT} from '../../../../shared/scene/scenario-rules.ts';
import {serializeJson,slugOf,uniqueId,withKey} from '../campaign/json.ts';

export type {DecorDef,LegendEntry,MapDocument,MapPerson,PlaceRegion,Terrain,Tile2};
export {MAP_LIMIT,TERRAINS};

/** A map's exit: a tile that leads to a tile of another map. */
export type MapExit=MapDocument['exits'][number];
/** The times of day a person can be about at. */
export const TIMES=['morning','afternoon','evening','night','next-morning'] as const;
export type TimeOfDay=typeof TIMES[number];
/** What a map's person, or a decor, can be. */
export const ACTOR_KINDS=['person','creature','object','item'] as const;

/** The smallest map the painter makes: a tile less and there's nothing to stand on. */
export const MAP_MIN=2;

/** Each object's keys in the order the format and the campaign's files have them. A key added goes where this puts it. */
export const ORDER={
  map:['format','version','kind','id','title','description','grid','legend','regions','exits','people'],
  legend:['terrain','style','height','roof','roofHeight','blocks','opaque','decor'],
  decor:['id','name','glyph','color','kind','blocks','states','text'],
  region:['id','name','rect','sceneId','worldOrigin','trigger','label','shut','opensFor','lockedAfter','exteriorOf','locked','description'],
  rect:['x','y','w','h'],
  point:['x','y'],
  exit:['at','to','label'],
  to:['map','at'],
  person:['name','times','glyph','color','kind','at','text','states','blocks'],
} as const;

// ---------------------------------------------------------------------------------------------
// The file.

/** A .kmmap file's text as the map it is: the game's parse, or an error naming every problem. */
export const openMapFile=(text:string,where='the map'):MapDocument=>parseMap(text,where);
/** A map as its file has it. */
export const serializeMap=(doc:MapDocument):string=>serializeJson(doc);
/** What's wrong with a map's shape (the game's parse): [] when the game can load it. An edit that would leave any is refused. */
export const mapShapeOf=(doc:MapDocument):string[]=>mapShapeProblems(doc);

/** A map file of the version 2 format, or something else (a version 1 map of the plugin's own, or not a map at all)? */
export function mapFileKind(text:string):'v2'|'v1'|'other'{
  try{
    const value=JSON.parse(text) as {format?:unknown;version?:unknown;kind?:unknown};
    if(value?.format!=='kingmaker'||value.kind!=='map')return 'other';
    return value.version===2?'v2':value.version===1?'v1':'other';
  }catch{return 'other'}
}

// ---------------------------------------------------------------------------------------------
// The grid as cells.

/** The void: the absence of a tile, where a row is short or a space is written. */
export const VOID=' ';

/** A map's grid as cells: its width (its longest row) and height, and a legend character a tile, row by row (a short row padded with the void). */
export type Cells={width:number;height:number;cells:string[]};

export function cellsOf(grid:string[]):Cells{
  const rows=grid.map(row=>[...row]);
  const width=Math.max(0,...rows.map(row=>row.length)),height=rows.length;
  const cells:string[]=new Array(width*height);
  rows.forEach((row,y)=>{for(let x=0;x<width;x++)cells[y*width+x]=row[x]??VOID});
  return {width,height,cells};
}

/**
 * The grid of `cells`, given the grid it was made from: a row whose cells didn't change is the same
 * row (the same bytes), and a changed row keeps its own length when what's past it is the void (as a
 * short row of the file is: the game pads it). A row that's new is the map's width.
 */
export function gridOf(cells:Cells,before:string[]):string[]{
  const rows:string[]=[];
  for(let y=0;y<cells.height;y++){
    const chars=cells.cells.slice(y*cells.width,(y+1)*cells.width);
    const old=before[y];
    if(old!==undefined){
      // Its own length, or as far as it's painted now if that's further: the void past both isn't written.
      let end=chars.length;
      while(end>[...old].length&&chars[end-1]===VOID)end--;
      const text=chars.slice(0,end).join('');
      rows.push(text===old?old:text);
    }else rows.push(chars.join(''));
  }
  return rows;
}

export const inside=(cells:{width:number;height:number},p:Tile2)=>p.x>=0&&p.y>=0&&p.x<cells.width&&p.y<cells.height;
export const cellAt=(cells:Cells,p:Tile2):string=>inside(cells,p)?cells.cells[p.y*cells.width+p.x]:VOID;

/** The tiles of a line from one tile to another, every one (a fast stroke skips pointer samples). */
export const line=(a:Tile2,b:Tile2):Tile2[]=>{
  const n=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));
  return Array.from({length:n+1},(_,i)=>({x:Math.round(a.x+(b.x-a.x)*i/(n||1)),y:Math.round(a.y+(b.y-a.y)*i/(n||1))}));
};

/** Cells with `ch` painted at each point, with a square brush of `size`. */
export function paint(m:Cells,points:Tile2[],ch:string,size=1):Cells{
  const cells=[...m.cells],low=-Math.floor((size-1)/2),high=Math.ceil((size-1)/2);
  for(const p of points)for(let dy=low;dy<=high;dy++)for(let dx=low;dx<=high;dx++){const q={x:p.x+dx,y:p.y+dy};if(inside(m,q))cells[q.y*m.width+q.x]=ch}
  return {...m,cells};
}

/** Cells with a rectangle (corner to corner, either way round) painted with `ch`. */
export function rectangle(m:Cells,a:Tile2,b:Tile2,ch:string):Cells{
  const points:Tile2[]=[];
  for(let y=Math.max(0,Math.min(a.y,b.y));y<=Math.min(m.height-1,Math.max(a.y,b.y));y++)for(let x=Math.max(0,Math.min(a.x,b.x));x<=Math.min(m.width-1,Math.max(a.x,b.x));x++)points.push({x,y});
  return paint(m,points,ch);
}

/** Cells with the four-connected run of one character from `p` painted with `ch`. */
export function fill(m:Cells,p:Tile2,ch:string):Cells{
  if(!inside(m,p))return m;
  const before=m.cells[p.y*m.width+p.x];
  if(before===ch)return m;
  const cells=[...m.cells],todo=[p];
  cells[p.y*m.width+p.x]=ch;
  while(todo.length){
    const a=todo.pop()!;
    for(const q of [{x:a.x-1,y:a.y},{x:a.x+1,y:a.y},{x:a.x,y:a.y-1},{x:a.x,y:a.y+1}])if(inside(m,q)&&cells[q.y*m.width+q.x]===before){cells[q.y*m.width+q.x]=ch;todo.push(q)}
  }
  return {...m,cells};
}

export const sameCells=(a:Cells,b:Cells)=>a.width===b.width&&a.height===b.height&&a.cells.every((ch,i)=>ch===b.cells[i]);

/** The map with its grid made from `cells`: the rows that changed, and nothing else. */
export function withCells(doc:MapDocument,cells:Cells):MapDocument{
  const grid=gridOf(cells,doc.grid);
  return grid.length===doc.grid.length&&grid.every((row,i)=>row===doc.grid[i])?doc:{...doc,grid};
}

/** How often each character is used, and the most used. */
export function usage(cells:Cells):Map<string,number>{
  const counts=new Map<string,number>();
  for(const ch of cells.cells)counts.set(ch,(counts.get(ch)??0)+1);
  return counts;
}

// ---------------------------------------------------------------------------------------------
// The legend.

/** A legend entry's name, as the painter's palette shows it: its decor's, else its look and terrain ("stone wall", "boards under a brick roof"). */
export function entryName(entry:LegendEntry|undefined):string{
  if(!entry)return 'Void';
  const ground=`${entry.style&&entry.style!==entry.terrain?`${entry.style} `:''}${entry.terrain.replace(/-/g,' ')}${entry.roof?` under a ${entry.roof} roof`:''}`;
  const name=entry.decor?`${entry.decor.name} (on ${entry.terrain.replace(/-/g,' ')})`:ground;
  return name.charAt(0).toUpperCase()+name.slice(1);
}

/** Can `ch` be a new legend character: one character, not a space (the void), not one the legend has? Why not, if not. */
export function legendCharProblem(doc:MapDocument,ch:string):string|undefined{
  if([...ch].length!==1)return 'A legend character is one character.';
  if(ch===VOID||!ch.trim())return 'A space is the void: choose a character you can see.';
  if(ch in doc.legend)return `"${ch}" is in the legend already (${entryName(doc.legend[ch])}).`;
  return undefined;
}

/** A character the legend hasn't got, from a list that reads well in a grid. */
export function freeChar(doc:MapDocument,prefer:string[]=[]):string{
  for(const ch of [...prefer,...POOL])if(!legendCharProblem(doc,ch))return ch;
  for(let code=0xa1;;code++){const ch=String.fromCodePoint(code);if(!legendCharProblem(doc,ch))return ch}
}
const POOL=[...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!$%&*-/;<>?@^`|()[]{}'];

/**
 * A legend entry as the format writes it: without the fields that say nothing (an empty text or list,
 * a false that's no override), its keys where they were, and any the format doesn't know kept. A
 * decor's name and glyph are always there: the format requires them.
 */
export function cleanEntry(entry:LegendEntry):LegendEntry{
  const empty=(key:string,value:unknown,keep:string[])=>value===undefined||(value===''&&!keep.includes(key))||Array.isArray(value)&&!value.length||value===false&&!keep.includes(key);
  let out=entry;
  for(const [key,value] of Object.entries(entry))if(key!=='terrain'&&(ORDER.legend as readonly string[]).includes(key)&&empty(key,value,['blocks','opaque']))out=withKey(out,key,undefined,ORDER.legend);
  if(out.decor){
    let decor=out.decor;
    for(const [key,value] of Object.entries(decor))if((ORDER.decor as readonly string[]).includes(key)&&empty(key,value,['name','glyph']))decor=withKey(decor,key,undefined,ORDER.decor);
    if(decor!==out.decor)out=withKey(out,'decor',decor,ORDER.legend);
  }
  return out;
}

/** The map with a legend entry added (refused for a character that can't be one). */
export function addLegendEntry(doc:MapDocument,ch:string,entry:LegendEntry):MapDocument{
  const problem=legendCharProblem(doc,ch);
  if(problem)throw new Error(problem);
  return {...doc,legend:{...doc.legend,[ch]:cleanEntry(entry)}};
}

/** The map with a legend entry changed, where it is (its character stays: the grid is written in it). */
export function setLegendEntry(doc:MapDocument,ch:string,entry:LegendEntry):MapDocument{
  if(!(ch in doc.legend))throw new Error(`"${ch}" isn't in the legend.`);
  const old=doc.legend[ch];
  // Keep the keys where they were: each set in place, new ones where the format puts them, empty ones out.
  let next=old;
  const clean=cleanEntry(entry);
  for(const key of Object.keys(old))if(!(key in clean))next=withKey(next,key,undefined,ORDER.legend);
  for(const [key,value] of Object.entries(clean)){
    if(key==='decor'&&old.decor){
      let decor=old.decor;
      const fresh=value as DecorDef;
      for(const k of Object.keys(decor))if(!(k in fresh))decor=withKey(decor,k,undefined,ORDER.decor);
      for(const [k,v] of Object.entries(fresh))decor=JSON.stringify((decor as unknown as Record<string,unknown>)[k])===JSON.stringify(v)?decor:withKey(decor,k,v,ORDER.decor);
      next=withKey(next,'decor',decor,ORDER.legend);
    }else if(JSON.stringify((old as Record<string,unknown>)[key])!==JSON.stringify(value))next=withKey(next,key,value,ORDER.legend);
  }
  return next===old?doc:{...doc,legend:Object.fromEntries(Object.entries(doc.legend).map(([k,v])=>[k,k===ch?next:v]))};
}

/** The map without a legend entry; where the grid used it, `replacement` instead (refused when it's used and there's none). */
export function removeLegendEntry(doc:MapDocument,ch:string,replacement?:string):MapDocument{
  const cells=cellsOf(doc.grid);
  const used=cells.cells.includes(ch);
  if(used&&replacement===undefined)throw new Error(`"${ch}" is painted on the map: choose what replaces it.`);
  if(replacement!==undefined&&replacement!==VOID&&!(replacement in doc.legend))throw new Error(`"${replacement}" isn't in the legend.`);
  const legend=Object.fromEntries(Object.entries(doc.legend).filter(([k])=>k!==ch));
  const next={...doc,legend};
  return used?withCells(next,{...cells,cells:cells.cells.map(c=>c===ch?replacement!:c)}):next;
}

// ---------------------------------------------------------------------------------------------
// Regions, exits and people.

/** The map with one of its regions changed (by its index), one field at a time (undefined takes it out). */
export function setRegionField(doc:MapDocument,index:number,key:string,value:unknown):MapDocument{
  const region=doc.regions[index];
  if(!region)throw new Error('That region isn\'t there any more.');
  const next=withKey(region,key,value,ORDER.region);
  return next===region?doc:{...doc,regions:doc.regions.map((r,i)=>i===index?next:r)};
}

/** A new region's id: a slug of its name, free across the campaign's regions (`taken`). */
export const regionIdFor=(name:string,taken:Iterable<string>,asked='')=>uniqueId(slugOf(asked)||slugOf(name)||'region',taken);

/** The map with a region added: its id, its name and where it is. */
export function addRegion(doc:MapDocument,region:{id:string;name:string;rect:{x:number;y:number;w:number;h:number}}):MapDocument{
  if(doc.regions.some(r=>r.id===region.id))throw new Error(`This map has a region ${region.id} already.`);
  return {...doc,regions:[...doc.regions,{id:region.id,name:region.name,rect:region.rect}]};
}

export const removeRegion=(doc:MapDocument,index:number):MapDocument=>({...doc,regions:doc.regions.filter((_,i)=>i!==index)});

/** The map with an exit changed (by its index). */
export function setExit(doc:MapDocument,index:number,exit:MapExit):MapDocument{
  const old=doc.exits[index];
  if(!old)throw new Error('That exit isn\'t there any more.');
  let next=old;
  for(const key of ORDER.exit){
    const value=(exit as Record<string,unknown>)[key];
    if(JSON.stringify((old as Record<string,unknown>)[key])===JSON.stringify(value))continue;
    if(key==='at')next=withKey(next,'at',pointLike(old.at,exit.at),ORDER.exit);
    else if(key==='to'){
      let to=old.to;
      if(to.map!==exit.to.map)to=withKey(to,'map',exit.to.map,ORDER.to);
      if(JSON.stringify(to.at)!==JSON.stringify(exit.to.at))to=withKey(to,'at',pointLike(old.to.at,exit.to.at),ORDER.to);
      next=withKey(next,'to',to,ORDER.exit);
    }else next=withKey(next,key,value,ORDER.exit);
  }
  return next===old?doc:{...doc,exits:doc.exits.map((e,i)=>i===index?next:e)};
}

export const addExit=(doc:MapDocument,exit:MapExit):MapDocument=>({...doc,exits:[...doc.exits,exit]});
export const removeExits=(doc:MapDocument,indices:Iterable<number>):MapDocument=>{const gone=new Set(indices);return {...doc,exits:doc.exits.filter((_,i)=>!gone.has(i))}};

/** The map with a person changed (by their index), one field at a time. */
export function setPersonField(doc:MapDocument,index:number,key:string,value:unknown):MapDocument{
  const people=doc.people??[];
  const person=people[index];
  if(!person)throw new Error('That person isn\'t there any more.');
  const next=withKey(person,key,value,ORDER.person);
  return next===person?doc:{...doc,people:people.map((p,i)=>i===index?next:p)};
}

/** The map with someone about at a tile: a name and a glyph, about all day until the author says otherwise. */
export function addPerson(doc:MapDocument,person:{name:string;glyph:string;at:Tile2}):MapDocument{
  const added:MapPerson={name:person.name,times:[...TIMES],glyph:person.glyph,at:person.at,text:''};
  return withKey(doc,'people',[...(doc.people??[]),added],ORDER.map);
}

/** The map without a person; with nobody left, without its people at all (the field is optional). */
export function removePerson(doc:MapDocument,index:number):MapDocument{
  const people=(doc.people??[]).filter((_,i)=>i!==index);
  return withKey(doc,'people',people.length?people:undefined,ORDER.map);
}

/** A point { x, y } like `old` (its keys in its order), at `p`. */
function pointLike(old:Tile2,p:Tile2):Tile2{
  let next=old;
  if(next.x!==p.x)next=withKey(next,'x',p.x,ORDER.point);
  if(next.y!==p.y)next=withKey(next,'y',p.y,ORDER.point);
  return next;
}
export const movedPoint=pointLike;

/** What's on a tile: the regions over it (smallest first), the exits from it, the people standing on it. */
export function thingsAt(doc:MapDocument,p:Tile2){
  const inRect=(r:{x:number;y:number;w:number;h:number})=>p.x>=r.x&&p.y>=r.y&&p.x<r.x+r.w&&p.y<r.y+r.h;
  return {
    regions:doc.regions.map((region,index)=>({region,index})).filter(({region})=>inRect(region.rect)).sort((a,b)=>a.region.rect.w*a.region.rect.h-b.region.rect.w*b.region.rect.h),
    exits:doc.exits.map((exit,index)=>({exit,index})).filter(({exit})=>exit.at.x===p.x&&exit.at.y===p.y),
    people:(doc.people??[]).map((person,index)=>({person,index})).filter(({person})=>person.at.x===p.x&&person.at.y===p.y),
  };
}

// ---------------------------------------------------------------------------------------------
// Resizing.

export type MapEdge='north'|'east'|'south'|'west';
/** A resize: the cells after it, how far the old tiles moved (a north or west edge moves them), the edge and how much, and how many tiles went. */
export type Resize={cells:Cells;offset:Tile2;edge:MapEdge;amount:number;removed:number};

/** An edge grown (a positive amount, new tiles `fillWith`) or cropped (a negative one), within the format's size limits. */
export function resizeCells(m:Cells,edge:MapEdge,amount:number,fillWith=VOID):Resize{
  if(!['north','east','south','west'].includes(edge)||!Number.isInteger(amount))throw new Error('Choose a map edge and a whole number of tiles.');
  const horizontal=edge==='east'||edge==='west',length=horizontal?m.width:m.height,limit=horizontal?MAP_LIMIT.w:MAP_LIMIT.h;
  const delta=Math.max(MAP_MIN-length,Math.min(limit-length,amount));
  const width=m.width+(horizontal?delta:0),height=m.height+(horizontal?0:delta);
  const offset={x:edge==='west'?delta:0,y:edge==='north'?delta:0};
  const cells:string[]=new Array(width*height).fill(fillWith);
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const nx=x+offset.x,ny=y+offset.y;if(nx>=0&&ny>=0&&nx<width&&ny<height)cells[ny*width+nx]=m.cells[y*m.width+x]}
  return {cells:{width,height,cells},offset,edge,amount:delta,removed:Math.max(0,m.width*m.height-width*height)};
}

/**
 * The map resized: its grid (written as rows again: a resize changes them all, every row the new
 * width, with the void past what was painted), and its regions, exits and people moved with the tiles
 * under them. What's off the new map goes: a region is cut to what's left of it, and an exit or a
 * person off it is taken out. `lost` says what went.
 */
export function resizeMap(doc:MapDocument,result:Resize):{doc:MapDocument;lost:string[]}{
  const {cells,offset}=result;
  // A row only moved up or down keeps its bytes where its cells are the same; a west edge moves every row.
  const before=Array.from({length:cells.height},(_,y)=>offset.x===0?doc.grid[y-offset.y]:undefined) as string[];
  const grid=gridOf(cells,before);
  const lost:string[]=[];
  const shift=(p:Tile2)=>movedPoint(p,{x:p.x+offset.x,y:p.y+offset.y});
  const regions=doc.regions.flatMap(region=>{
    const r=region.rect,x0=Math.max(0,r.x+offset.x),y0=Math.max(0,r.y+offset.y),x1=Math.min(cells.width,r.x+offset.x+r.w),y1=Math.min(cells.height,r.y+offset.y+r.h);
    if(x1<=x0||y1<=y0){lost.push(`region ${region.id}`);return []}
    let rect=r;
    for(const [k,v] of [['x',x0],['y',y0],['w',x1-x0],['h',y1-y0]] as const)if(rect[k]!==v)rect=withKey(rect,k,v,ORDER.rect);
    let next=rect===r?region:withKey(region,'rect',rect,ORDER.region);
    if(region.worldOrigin&&(offset.x||offset.y))next=withKey(next,'worldOrigin',shift(region.worldOrigin),ORDER.region);
    return [next];
  });
  const exits=doc.exits.flatMap(exit=>{
    const p={x:exit.at.x+offset.x,y:exit.at.y+offset.y};
    if(!inside(cells,p)){lost.push(`the exit "${exit.label}" at (${exit.at.x}, ${exit.at.y})`);return []}
    return [offset.x||offset.y?withKey(exit,'at',shift(exit.at),ORDER.exit):exit];
  });
  const people=doc.people?.flatMap(person=>{
    const p={x:person.at.x+offset.x,y:person.at.y+offset.y};
    if(!inside(cells,p)){lost.push(`${person.name} at (${person.at.x}, ${person.at.y})`);return []}
    return [offset.x||offset.y?withKey(person,'at',shift(person.at),ORDER.person):person];
  });
  return {doc:{...doc,grid,regions,exits,...(people?{people}:{})},lost};
}

// ---------------------------------------------------------------------------------------------
// A new map.

/** A new map's file: the default legend (the plugin's palette and its clutter) and a grid of grass, nothing on it yet. */
export function newMap(title:string,id=slugOf(title),width=32,height=24):MapDocument{
  const grass=DEFAULT_LEGEND.find(entry=>entry.id==='grass')!.ch;
  return {
    format:'kingmaker',version:2,kind:'map',id,title,description:'',
    grid:Array.from({length:height},()=>grass.repeat(width)),
    legend:defaultLegend(),
    regions:[],exits:[],
  };
}

/**
 * The default legend: the plugin's version 1 palette (its terrains, each with the game's look) and its
 * clutter (each standing on cobbles), as legend entries, a character each. Version 1 maps migrate onto
 * the same characters.
 */
export const DEFAULT_LEGEND:Array<{id:string;ch:string;entry:LegendEntry;clutter?:boolean}>=[
  {id:'grass',ch:',',entry:{terrain:'grass'}},
  {id:'dirt',ch:':',entry:{terrain:'dirt'}},
  {id:'cobbles',ch:'.',entry:{terrain:'cobbles'}},
  {id:'boards',ch:'_',entry:{terrain:'boards'}},
  {id:'water',ch:'~',entry:{terrain:'water'}},
  {id:'deep-water',ch:'w',entry:{terrain:'deep-water'}},
  {id:'bridge',ch:'=',entry:{terrain:'bridge'}},
  {id:'stone',ch:'#',entry:{terrain:'wall',style:'stone'}},
  {id:'timber',ch:'W',entry:{terrain:'wall',style:'timber'}},
  {id:'door',ch:'+',entry:{terrain:'door',style:'timber'}},
  {id:'window',ch:'o',entry:{terrain:'window',style:'stone'}},
  {id:'roof',ch:'r',entry:{terrain:'boards',roof:'brick',roofHeight:3}},
  {id:'tree',ch:'t',entry:{terrain:'tree'}},
  {id:'fence',ch:'f',entry:{terrain:'fence'}},
  {id:'stairs',ch:'v',entry:{terrain:'stairs'}},
  {id:'lamp',ch:'l',clutter:true,entry:{terrain:'cobbles',decor:{name:'a lamp',glyph:'¤',color:'#ffd27f',states:['lamp','lit','post']}}},
  {id:'sign',ch:'s',clutter:true,entry:{terrain:'cobbles',decor:{name:'a sign',glyph:'T',color:'#dbc797',states:['sign']}}},
  {id:'crate',ch:'k',clutter:true,entry:{terrain:'cobbles',decor:{name:'a crate',glyph:'▣',color:'#bb9168',blocks:true,states:['crate']}}},
  {id:'barrel',ch:'b',clutter:true,entry:{terrain:'cobbles',decor:{name:'a barrel',glyph:'o',color:'#b99068',blocks:true,states:['barrel']}}},
  {id:'bench',ch:'n',clutter:true,entry:{terrain:'cobbles',decor:{name:'a bench',glyph:'▬',color:'#c3a57c',blocks:true,states:['bench']}}},
];

export const defaultLegend=():Record<string,LegendEntry>=>Object.fromEntries(DEFAULT_LEGEND.map(({ch,entry})=>[ch,cleanEntry(entry)]));

/** The ids of the campaign's regions on other maps, for a new region's id to be free of (a region's id is unique across the maps). */
export const regionIds=(maps:Array<{key:string;doc?:MapDocument}>,except:string):string[]=>maps.filter(map=>map.key!==except).flatMap(map=>map.doc?.regions.map(r=>r.id)??[]);

/** The terrains a legend entry can be, those of buildings and the rest. */
export const STRUCTURES:Terrain[]=['wall','door','window','fence'];
export const isTerrain=(value:string):value is Terrain=>(TERRAINS as string[]).includes(value);

/**
 * The map with a legend character renamed: its entry under the new character, where it was in the
 * legend, and every tile painted with it written in the new one (only the rows it's on change).
 * Refused for a character that can't be one.
 */
export function renameLegendChar(doc:MapDocument,from:string,to:string):MapDocument{
  if(!(from in doc.legend))throw new Error(`"${from}" isn't in the legend.`);
  if(from===to)return doc;
  const problem=legendCharProblem(doc,to);
  if(problem)throw new Error(problem);
  const legend=Object.fromEntries(Object.entries(doc.legend).map(([ch,entry])=>[ch===from?to:ch,entry]));
  const grid=doc.grid.map(row=>row.includes(from)?[...row].map(ch=>ch===from?to:ch).join(''):row);
  return {...doc,legend,grid};
}

/** The people about at an hour (all of them, for none), each with their index in the map's list. */
export const peopleAbout=(doc:MapDocument,time?:TimeOfDay)=>(doc.people??[]).map((person,index)=>({person,index})).filter(({person})=>!time||person.times.includes(time));

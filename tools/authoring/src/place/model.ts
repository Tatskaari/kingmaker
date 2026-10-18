// The plugin's model of a place file (places/<key>.kmplace, docs/scenario-format.md): a scene's place,
// its areas, things and where its people start, in feet in the scene's world. The game's own format,
// read with its parse and edited as the plain JSON it is. On a map, a place is laid at its region's
// worldOrigin, five feet to a tile.
import {MATERIALS,SIZES,THING_KINDS,parsePlace,placeShapeProblems} from '../../../../shared/scene/scenario.ts';
import type {PlaceDocument} from '../../../../shared/scene/scenario.ts';
import type {Tile2} from '../../../../shared/map/types.ts';
import {serializeJson,slugOf,uniqueId,withKey} from '../campaign/json.ts';

export type {PlaceDocument};
export {MATERIALS,SIZES,THING_KINDS};

export type Area=PlaceDocument['areas'][number];
export type Thing=PlaceDocument['things'][number];
export type Person=PlaceDocument['people'][string];
export type Rect={x:number;y:number;w:number;h:number};
export type Feet=[number,number];

/** Five feet to a tile, as the game lays a place on its map (shared/map/reconcile.ts). */
export const FEET_PER_TILE=5;

/** Each object's keys in the order the format and the campaign's files have them. A key added goes where this puts it. */
export const ORDER={
  place:['format','version','kind','id','title','description','size','areas','things','people'],
  size:['w','h'],
  area:['id','name','rect','description','tags','states'],
  rect:['x','y','w','h'],
  thing:['id','name','kind','in','at','size','material','tags','states','description','ac','hp','quantity'],
  person:['in','at','note'],
} as const;

export const openPlaceFile=(text:string,where='the place'):PlaceDocument=>parsePlace(text,where);
export const serializePlace=(doc:PlaceDocument):string=>serializeJson(doc);
export const placeShapeOf=(doc:PlaceDocument):string[]=>placeShapeProblems(doc);

// ---------------------------------------------------------------------------------------------
// Feet and tiles.

/** The tile a spot in the place (feet) falls on, the place laid at `origin` (a tile of the map). */
export const tileOfFeet=(origin:Tile2,at:Feet):Tile2=>({x:origin.x+Math.floor(at[0]/FEET_PER_TILE),y:origin.y+Math.floor(at[1]/FEET_PER_TILE)});
/** A spot in the place (feet) on a tile of the map: the tile's middle, in whole feet. */
export const feetOfTile=(origin:Tile2,tile:Tile2):Feet=>[(tile.x-origin.x)*FEET_PER_TILE+Math.floor(FEET_PER_TILE/2),(tile.y-origin.y)*FEET_PER_TILE+Math.floor(FEET_PER_TILE/2)];
/** A spot moved to another tile, keeping where in its tile it was (a thing at 34 ft moved one tile east is at 39). */
export function feetMoved(origin:Tile2,at:Feet,tile:Tile2):Feet{
  const from=tileOfFeet(origin,at);
  return [at[0]+(tile.x-from.x)*FEET_PER_TILE,at[1]+(tile.y-from.y)*FEET_PER_TILE];
}
/** The place's size in tiles, rounded up (as the campaign check fits it on its map). */
export const tilesOf=(size:{w:number;h:number})=>({w:Math.ceil(size.w/FEET_PER_TILE),h:Math.ceil(size.h/FEET_PER_TILE)});

const inRect=(r:Rect,at:Feet)=>at[0]>=r.x&&at[1]>=r.y&&at[0]<r.x+r.w&&at[1]<r.y+r.h;
/** Whether a spot is on the place's floor (the campaign check's rule: the game lays the place on its map from its origin, and what's past its edges is off its tiles). */
export const onPlace=(doc:PlaceDocument,at:Feet)=>inRect({x:0,y:0,w:doc.size.w,h:doc.size.h},at);
const within=(value:number,low:number,high:number)=>Math.min(Math.max(value,low),Math.max(low,high));
/** A spot brought onto the place's floor: one past an edge goes just inside it. */
export const ontoPlace=(doc:PlaceDocument,at:Feet):Feet=>onPlace(doc,at)?at:[within(at[0],0,doc.size.w-1),within(at[1],0,doc.size.h-1)];
/** The smallest area a spot is in. */
export const areaAt=(doc:PlaceDocument,at:Feet):Area|undefined=>doc.areas.filter(area=>inRect(area.rect,at)).sort((a,b)=>a.rect.w*a.rect.h-b.rect.w*b.rect.h)[0];

// ---------------------------------------------------------------------------------------------
// What's where.

/** Everything in the place by its id: its areas, things and people (and what kind each is). */
export function idsOf(doc:PlaceDocument):Map<string,'area'|'thing'|'person'>{
  return new Map<string,'area'|'thing'|'person'>([...doc.areas.map(a=>[a.id,'area'] as const),...doc.things.map(t=>[t.id,'thing'] as const),...Object.keys(doc.people).map(id=>[id,'person'] as const)]);
}

/** What's in something: the things whose `in` it is. */
export const contentsOf=(doc:PlaceDocument,id:string):Thing[]=>doc.things.filter(thing=>thing.in===id);

/** Where a thing is on the place's floor: its own spot, or its holder's (a thing in a person or another thing is where they are). */
export function spotOf(doc:PlaceDocument,id:string,seen=new Set<string>()):Feet|undefined{
  if(seen.has(id))return undefined;
  seen.add(id);
  const thing=doc.things.find(t=>t.id===id);
  if(thing)return thing.at??spotOf(doc,thing.in,seen);
  return doc.people[id]?.at;
}

// ---------------------------------------------------------------------------------------------
// Edits. Each takes a place and returns a new one, the given one unchanged.

export function setPlaceField(doc:PlaceDocument,key:string,value:unknown):PlaceDocument{
  return withKey(doc,key,value,ORDER.place);
}

export function setAreaField(doc:PlaceDocument,id:string,key:string,value:unknown):PlaceDocument{
  return {...doc,areas:doc.areas.map(area=>area.id===id?withKey(area,key,value,ORDER.area):area)};
}

export function setThingField(doc:PlaceDocument,id:string,key:string,value:unknown):PlaceDocument{
  return {...doc,things:doc.things.map(thing=>thing.id===id?withKey(thing,key,value,ORDER.thing):thing)};
}

export function setPersonField(doc:PlaceDocument,id:string,key:string,value:unknown):PlaceDocument{
  const person=doc.people[id];
  if(!person)return doc;
  return {...doc,people:Object.fromEntries(Object.entries(doc.people).map(([who,p])=>[who,who===id?withKey(p,key,value,ORDER.person):p]))};
}

/** A rect moved or resized: its keys in its order. */
export function rectLike(old:Rect,next:Rect):Rect{
  let rect=old;
  for(const key of ORDER.rect)if(rect[key]!==next[key])rect=withKey(rect,key,next[key],ORDER.rect);
  return rect;
}

/**
 * A thing moved to a spot (feet), kept on the place's floor (a spot past an edge goes just inside it).
 * A thing on the floor (in an area) moves into the area the spot is in, if it's in one; a thing held
 * by someone or in something stays theirs (it's put down only when its `in` changes).
 */
export function moveThing(doc:PlaceDocument,id:string,to:Feet):PlaceDocument{
  const thing=doc.things.find(t=>t.id===id);
  if(!thing)return doc;
  const at=ontoPlace(doc,to);
  let next=withKey(thing,'at',atLike(thing.at,at),ORDER.thing);
  const area=areaAt(doc,at);
  if(area&&doc.areas.some(a=>a.id===thing.in)&&area.id!==thing.in)next=withKey(next,'in',area.id,ORDER.thing);
  return next===thing?doc:{...doc,things:doc.things.map(t=>t.id===id?next:t)};
}

/** Someone's start moved to a spot (feet) on the place's floor, into the area it's in (a person starts in an area). */
export function movePerson(doc:PlaceDocument,id:string,to:Feet):PlaceDocument{
  const person=doc.people[id];
  if(!person)return doc;
  const at=ontoPlace(doc,to);
  let next=withKey(person,'at',atLike(person.at,at),ORDER.person);
  const area=areaAt(doc,at);
  if(area&&area.id!==person.in)next=withKey(next,'in',area.id,ORDER.person);
  return next===person?doc:{...doc,people:Object.fromEntries(Object.entries(doc.people).map(([who,p])=>[who,who===id?next:p]))};
}

/** An area moved (its corner to `x`, `y` in feet, as far as the place's edges let it go), the things and people on its floor with it. */
export function moveArea(doc:PlaceDocument,id:string,toX:number,toY:number):PlaceDocument{
  const area=doc.areas.find(a=>a.id===id);
  if(!area)return doc;
  const x=within(toX,0,doc.size.w-area.rect.w),y=within(toY,0,doc.size.h-area.rect.h);
  const dx=x-area.rect.x,dy=y-area.rect.y;
  if(!dx&&!dy)return doc;
  const shift=(at:Feet|undefined)=>at?atLike(at,[at[0]+dx,at[1]+dy]):at;
  return {
    ...doc,
    areas:doc.areas.map(a=>a.id===id?withKey(a,'rect',rectLike(a.rect,{...a.rect,x,y}),ORDER.area):a),
    things:doc.things.map(t=>t.in===id&&t.at?withKey(t,'at',shift(t.at),ORDER.thing):t),
    people:Object.fromEntries(Object.entries(doc.people).map(([who,p])=>[who,p.in===id&&p.at?withKey(p,'at',shift(p.at),ORDER.person):p])),
  };
}

/** A pair of feet like `old` (the same array when it's the same spot). */
const atLike=(old:Feet|undefined,at:Feet):Feet=>old&&old[0]===at[0]&&old[1]===at[1]?old:[at[0],at[1]];

/** A new id in the place: a slug of the name, free among its areas, things and people. */
export const placeIdFor=(doc:PlaceDocument,name:string,asked='')=>uniqueId(slugOf(asked)||slugOf(name)||'thing',idsOf(doc).keys());

/** A thing added: its id, name, where it is (an area, or whoever or whatever holds it) and, on the floor, its spot. */
export function addThing(doc:PlaceDocument,thing:{id:string;name:string;in:string;at?:Feet}):PlaceDocument{
  if(idsOf(doc).has(thing.id))throw new Error(`${thing.id} is in the place already.`);
  return {...doc,things:[...doc.things,{id:thing.id,name:thing.name,in:thing.in,...(thing.at?{at:thing.at}:{})}]};
}

/** An area added: its id, name and rect (feet). */
export function addArea(doc:PlaceDocument,area:{id:string;name:string;rect:Rect}):PlaceDocument{
  if(idsOf(doc).has(area.id))throw new Error(`${area.id} is in the place already.`);
  return {...doc,areas:[...doc.areas,{id:area.id,name:area.name,rect:area.rect}]};
}

/** Someone who starts here (a cast id of the scene, or "player"): in an area, at a spot. */
export function addPerson(doc:PlaceDocument,id:string,where:{in:string;at?:Feet}):PlaceDocument{
  if(id in doc.people)throw new Error(`${id} starts here already.`);
  return {...doc,people:{...doc.people,[id]:{in:where.in,...(where.at?{at:where.at}:{})}}};
}

/**
 * Something taken out of the place. A thing takes what's in it along (a bag and its coins); an area
 * can only go once nothing is in it; a person's start goes alone (what they hold stays, for the
 * author: the rules name a thing in someone who isn't there).
 */
export function removeFromPlace(doc:PlaceDocument,id:string):PlaceDocument{
  const kind=idsOf(doc).get(id);
  if(kind==='area'){
    const inside=[...doc.things.filter(t=>t.in===id).map(t=>t.id),...Object.entries(doc.people).filter(([,p])=>p.in===id).map(([who])=>who)];
    if(inside.length)throw new Error(`Move or remove what's in it first: ${inside.join(', ')}.`);
    return {...doc,areas:doc.areas.filter(a=>a.id!==id)};
  }
  if(kind==='thing'){
    const gone=new Set([id]);
    for(let grew=true;grew;){grew=false;for(const t of doc.things)if(!gone.has(t.id)&&gone.has(t.in)){gone.add(t.id);grew=true}}
    return {...doc,things:doc.things.filter(t=>!gone.has(t.id))};
  }
  if(kind==='person')return {...doc,people:Object.fromEntries(Object.entries(doc.people).filter(([who])=>who!==id))};
  return doc;
}

/** A new place's file: a size, and nothing in it yet but one area, the whole of it. */
export function newPlace(title:string,id=slugOf(title)):PlaceDocument{
  return {
    format:'kingmaker',version:2,kind:'place',id,title,description:'',
    size:{w:40,h:30},
    areas:[{id:'floor',name:'the floor',rect:{x:0,y:0,w:40,h:30}}],
    things:[],people:{},
  };
}

/** Why an area's or a thing's id can't be `id`: not a slug, or taken in the place (its own aside). */
export function placeIdProblem(doc:PlaceDocument,id:string,current?:string):string|undefined{
  if(!/^[a-z0-9][a-z0-9-]*$/.test(id))return 'An id is a slug: lower-case letters, digits and dashes.';
  if(id!==current&&idsOf(doc).has(id))return `${id} is in the place already.`;
  return undefined;
}

/**
 * An area or a thing renamed, and everything of the place naming it following: what's in it (a thing's
 * or someone's `in`). The scenes naming it (a path's via, an effect) aren't the place's: the problems
 * and warnings say where they need it.
 */
export function renamePlaceId(doc:PlaceDocument,from:string,to:string):PlaceDocument{
  const kind=idsOf(doc).get(from);
  if(!kind||kind==='person'||from===to)return doc;
  const problem=placeIdProblem(doc,to,from);
  if(problem)throw new Error(problem);
  const areas=kind==='area'?doc.areas.map(area=>area.id===from?withKey(area,'id',to,ORDER.area):area):doc.areas;
  const things=doc.things.map(thing=>{let next=thing.id===from?withKey(thing,'id',to,ORDER.thing):thing;if(next.in===from)next=withKey(next,'in',to,ORDER.thing);return next});
  const people=Object.fromEntries(Object.entries(doc.people).map(([who,person])=>[who,person.in===from?withKey(person,'in',to,ORDER.person):person]));
  return {...doc,areas,things,people};
}

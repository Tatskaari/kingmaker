import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';

// The plugin's model of a place file (src/place/model.ts) on the game's own places: read with the
// game's parse, edited a value at a time, and laid on its map as the game lays it, five feet a tile.
const bundle=async entry=>{
  const output=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
};
const model=await bundle('../src/place/model.ts');
const game=await bundle('./game-places.ts');
const {openPlaceFile,serializePlace,placeShapeOf,tileOfFeet,feetOfTile,feetMoved,tilesOf,areaAt,contentsOf,spotOf,setThingField,setAreaField,setPersonField,moveThing,movePerson,moveArea,onPlace,addThing,addArea,addPerson,removeFromPlace,placeIdFor,newPlace,idsOf}=model;

const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const read=path=>readFile(new URL(path,CAMPAIGN),'utf8');
const placeNames=(await readdir(new URL('places/',CAMPAIGN))).filter(name=>name.endsWith('.kmplace')).sort();
const yard=async()=>openPlaceFile(await read('places/granary-yard.kmplace'));

test('every real place opens with the game\'s parse and saves to the same bytes',async()=>{
  assert.deepEqual(placeNames,['dressing-room.kmplace','drowned-rat.kmplace','granary-yard.kmplace','heron.kmplace']);
  for(const name of placeNames){
    const text=await read(`places/${name}`);
    const doc=openPlaceFile(text);
    assert.equal(serializePlace(doc),text,`${name} round-trips byte for byte`);
    assert.deepEqual(placeShapeOf(doc),[]);
  }
});

test('feet and tiles: a place laid at its region\'s origin, as the game lays it',async()=>{
  const origin={x:40,y:9};
  // The game's own conversion (shared/map/reconcile.ts) agrees.
  for(const at of [[0,0],[4,4],[5,5],[34,3],[51,39]])assert.deepEqual(tileOfFeet(origin,at),game.feetToTile(origin,at),JSON.stringify(at));
  assert.deepEqual(feetOfTile(origin,{x:46,y:9}),[32,2]);
  assert.deepEqual(tileOfFeet(origin,feetOfTile(origin,{x:46,y:9})),{x:46,y:9});
  assert.deepEqual(feetMoved(origin,[34,3],{x:47,y:10}),[39,8],'where in its tile it was is kept');
  assert.deepEqual(tilesOf({w:52,h:40}),{w:11,h:8});
  assert.deepEqual(tilesOf({w:105,h:90}),{w:21,h:18});
});

test('what\'s where: the areas a spot is in, what\'s in a thing or a person, and where held things are',async()=>{
  const doc=await yard();
  assert.equal(areaAt(doc,[45,22]).id,'loft');
  assert.equal(areaAt(doc,[14,10]).id,'yard');
  assert.equal(areaAt(doc,[60,60]),undefined);
  assert.deepEqual(contentsOf(doc,'hoist-beam').map(t=>t.id),['hoist-rope']);
  assert.deepEqual(contentsOf(doc,'cob').map(t=>t.id),['boots','gutter-stones']);
  assert.deepEqual(spotOf(doc,'prout'),[34,20],'the body hangs from the rope on the beam');
  assert.deepEqual(spotOf(doc,'ledger-page'),[30,24],'in the boot Cob has on');
  assert.equal(idsOf(doc).get('kell'),'person');
});

test('moving: a thing keeps its place in its tile and goes into the area under it; someone\'s start too; an area takes its floor with it',async()=>{
  const doc=await yard();
  let next=moveThing(doc,'satchel',[44,23]);
  const satchel=next.things.find(t=>t.id==='satchel');
  assert.deepEqual([satchel.at,satchel.in],[[44,23],'loft']);
  assert.deepEqual(Object.keys(satchel),Object.keys(doc.things.find(t=>t.id==='satchel')),'its keys where they were');
  assert.equal(moveThing(doc,'satchel',[14,10]),doc,'the same spot is the same place');
  // A thing held moves with no area of its own: it stays held.
  next=moveThing(doc,'boots',[3,3]);
  assert.equal(next.things.find(t=>t.id==='boots').in,'cob');
  next=movePerson(doc,'moll',[45,30]);
  assert.deepEqual(next.people.moll,{in:'loft',at:[45,30],note:'sitting on top of the yard wall'});
  // The loft moved two feet west: its things on the floor with it, what's held stays held.
  next=moveArea(doc,'loft',36,8);
  assert.deepEqual(next.areas.find(a=>a.id==='loft').rect,{x:36,y:8,w:14,h:32});
  assert.deepEqual(next.things.find(t=>t.id==='cleat').at,[38,18]);
  assert.deepEqual(next.things.find(t=>t.id==='granary-roll'),doc.things.find(t=>t.id==='granary-roll'));
  assert.equal(moveArea(doc,'loft',38,8),doc);
});

test('moving keeps everything on the place\'s floor: a spot past an edge goes just inside it, and an area stops at the edge',async()=>{
  // The yard is 52 by 40 feet; the loft (14 wide, from 38) is at its east edge already.
  const doc=await yard();
  assert.deepEqual(moveThing(doc,'satchel',[-7,10]).things.find(t=>t.id==='satchel').at,[0,10]);
  assert.deepEqual(moveThing(doc,'satchel',[60,45]).things.find(t=>t.id==='satchel').at,[51,39]);
  assert.deepEqual(movePerson(doc,'moll',[45,99]).people.moll.at,[45,39]);
  assert.equal(moveArea(doc,'loft',40,8),doc,'past the east edge it stays where it is');
  assert.deepEqual(moveArea(doc,'loft',30,-20).areas.find(a=>a.id==='loft').rect,{x:30,y:0,w:14,h:32});
  assert.deepEqual([onPlace(doc,[0,0]),onPlace(doc,[51,39]),onPlace(doc,[52,10]),onPlace(doc,[10,-1])],[true,true,false,false]);
});

test('adding and removing: ids free in the place, a thing takes what\'s in it along, an area goes only once it\'s empty',async()=>{
  const doc=await yard();
  assert.equal(placeIdFor(doc,'The Old Elm'),'the-old-elm');
  assert.equal(placeIdFor(doc,'Elm','elm'),'elm-2');
  let next=addThing(doc,{id:'ladder',name:'a ladder',in:'yard',at:[20,30]});
  assert.deepEqual(next.things.at(-1),{id:'ladder',name:'a ladder',in:'yard',at:[20,30]});
  assert.throws(()=>addThing(next,{id:'yard',name:'x',in:'yard'}),/in the place already/);
  next=addArea(next,{id:'shed',name:'the shed',rect:{x:0,y:30,w:10,h:10}});
  next=addPerson(next,'tull',{in:'shed',at:[5,35]});
  assert.deepEqual(next.people.tull,{in:'shed',at:[5,35]});
  assert.throws(()=>removeFromPlace(next,'shed'),/Move or remove what's in it first: tull/);
  next=removeFromPlace(next,'tull');
  assert.ok(!('tull' in next.people));
  assert.ok(removeFromPlace(next,'shed').areas.every(a=>a.id!=='shed'),'empty, it goes');
  // The beam takes its rope and the body hanging from it.
  next=removeFromPlace(doc,'hoist-beam');
  assert.deepEqual(['hoist-beam','hoist-rope','prout'].filter(id=>next.things.some(t=>t.id===id)),[]);
  assert.equal(next.things.length,doc.things.length-3);
  // Fields one at a time, in the format's order.
  next=setThingField(doc,'elm','states',['leaning']);
  assert.deepEqual(Object.keys(next.things.find(t=>t.id==='elm')),['id','name','kind','in','at','size','material','states','description'],'a new key where the format puts it');
  next=setThingField(next,'elm','description',undefined);
  assert.deepEqual(Object.keys(next.things.find(t=>t.id==='elm')),['id','name','kind','in','at','size','material','states']);
  next=setAreaField(doc,'lane','states',['busy']);
  assert.deepEqual(Object.keys(next.areas.find(a=>a.id==='lane')),['id','name','rect','description','tags','states']);
  next=setPersonField(doc,'kell','note',undefined);
  assert.deepEqual(next.people.kell,{in:'yard',at:[16,13]});
  // What the game builds a world from.
  game.build(next);
});

test('a new place is a size and one area, the whole of it; what isn\'t a place is refused, naming what\'s wrong',async()=>{
  const doc=newPlace('The Cooperage');
  assert.deepEqual([doc.id,doc.size,doc.areas.length],['the-cooperage',{w:40,h:30},1]);
  assert.deepEqual(placeShapeOf(doc),[]);
  game.build(doc);
  assert.throws(()=>openPlaceFile('{','places/x.kmplace'),/places\/x\.kmplace: it isn't JSON/);
  const yardDoc=await yard();
  assert.throws(()=>openPlaceFile(JSON.stringify({...yardDoc,things:[{id:'x',name:'x',in:'yard',size:'colossal'}]})),/size "colossal" isn't one of/);
});

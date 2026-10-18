import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// A version 1 map migrated to the game's map format (src/map/migrate.ts), on a copy of the user's own
// harbour study (tests/fixtures/v1-study, from their old vault's Maps/Harbour study.kmmap) and on the
// plugin's example.
const bundle=async entry=>{
  const output=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
};
const {readV1Map,migrateV1Map,spawnsOf}=await bundle('../src/map/migrate.ts');
const {serializeMap,openMapFile,cellsOf,mapShapeOf}=await bundle('../src/map/model.ts');
const game=await bundle('./game-maps.ts');
const studyText=await readFile(new URL('fixtures/v1-study/Harbour study.kmmap',import.meta.url),'utf8');
const exampleText=await readFile(new URL('fixtures/v1/Maps/Harbour study.kmmap',import.meta.url),'utf8');

test('the user\'s harbour study migrates: each palette id and clutter pair a legend character, the spawn kept, the interaction a region, and the game builds it',()=>{
  const v1=readV1Map(studyText);
  assert.deepEqual([v1.terrain.width,v1.terrain.height],[64,50]);
  assert.deepEqual(spawnsOf(v1),[{id:'8ffb205f-1ab1-489b-a8d3-bdb214e14b32',title:'docks',at:{x:46,y:40}}]);
  const {doc,legend,notes}=migrateV1Map(v1,{id:'harbour-study'});
  assert.deepEqual(legend,[
    {ch:',',was:'grass'},{ch:'L',was:'lamp on grass'},{ch:':',was:'dirt'},{ch:'.',was:'cobbles'},{ch:'l',was:'lamp on cobbles'},{ch:'s',was:'sign on cobbles'},
    {ch:'_',was:'boards'},{ch:'~',was:'water'},{ch:'w',was:'deep-water'},{ch:'#',was:'stone'},{ch:'W',was:'timber'},{ch:'+',was:'door'},{ch:'o',was:'window'},{ch:'r',was:'roof'},{ch:'t',was:'tree'},
  ]);
  assert.deepEqual(doc.legend.L,{terrain:'grass',decor:{name:'a lamp',glyph:'¤',color:'#ffd27f',states:['lamp','lit','post']}});
  assert.deepEqual(doc.legend.r,{terrain:'boards',roof:'brick',roofHeight:3});
  // Tile for tile: every palette id is its character, every clutter its pair's.
  const cells=cellsOf(doc.grid);
  assert.deepEqual([cells.width,cells.height],[64,50]);
  const byPair=new Map(legend.map(({ch,was})=>[was,ch]));
  v1.terrain.tiles.forEach((id,i)=>{const clutter=v1.terrain.clutter?.[i];assert.equal(cells.cells[i],byPair.get(clutter?`${clutter} on ${id}`:id),`tile ${i}`)});
  assert.deepEqual(doc.regions,[{id:'docks',name:'docks',rect:{x:46,y:40,w:1,h:1}},{id:'asdf',name:'asdf',rect:{x:36,y:41,w:1,h:1}}]);
  assert.deepEqual(doc.exits,[]);
  assert.deepEqual(notes,['The spawn point “docks” (46, 40) is the region docks.','The interaction “asdf” is the region asdf.']);
  assert.deepEqual([doc.format,doc.version,doc.kind,doc.id,doc.title,doc.description],['kingmaker',2,'map','harbour-study','Harbour study',v1.description]);
  assert.deepEqual(Object.keys(doc),['format','version','kind','id','title','description','grid','legend','regions','exits']);
  // A file the game loads: its parse, and its build.
  assert.deepEqual(mapShapeOf(doc),[]);
  const text=serializeMap(doc);
  assert.deepEqual(openMapFile(text),doc);
  const built=game.build(doc);
  assert.deepEqual([built.width,built.height],[64,50]);
  assert.equal(game.decorOf(doc).length,11,'its eleven lamps and sign');
});

test('the spawn made the scenario\'s start isn\'t kept on the map; exits to a map become exits, and to a scene, regions that play it',()=>{
  const v1=readV1Map(studyText);
  const [spawn]=spawnsOf(v1);
  const started=migrateV1Map(v1,{id:'harbour-study',start:spawn.id});
  assert.deepEqual(started.doc.regions.map(region=>region.id),['asdf']);
  assert.equal(started.notes[0],'The spawn point “docks” (46, 40) is the scenario\'s start.');
  // The plugin's own example, with ports wired as a version 1 scenario wired them.
  const example=readV1Map(exampleText);
  const wired={...example,nodes:[
    {id:'in',data:{kind:'start',title:'From the lane',mapFeature:'spawn',mapAt:{x:3,y:3}}},
    {id:'door',data:{kind:'exit',title:'Tavern door',mapFeature:'interaction',mapAt:{x:8,y:11},exitPort:'Into the tavern',file:'Maps/Tavern.kmmap',entry:'bar',eventMessage:'The door sticks.'}},
    {id:'body',data:{kind:'exit',title:'The body',mapFeature:'interaction',mapAt:{x:12,y:7},exitPort:'Look closer',file:'Scenes/The Hanged Clerk.kmscene',entry:'yard',script:'Open the scene.'}},
    {id:'lost',data:{kind:'exit',title:'Old well',mapFeature:'interaction',mapAt:{x:2,y:2},exitPort:'Down the well',file:'Maps/Gone.kmmap',entry:'x'}},
  ]};
  const destination=file=>file==='Maps/Tavern.kmmap'?{kind:'map',id:'tavern',at:{x:4,y:9}}:file.startsWith('Scenes/')?{kind:'scene',id:'hanged-clerk'}:undefined;
  const {doc,notes}=migrateV1Map(wired,{id:'harbour',destination,takenRegionIds:['in']});
  assert.deepEqual(doc.exits,[{at:{x:8,y:11},to:{map:'tavern',at:{x:4,y:9}},label:'Into the tavern'}]);
  assert.deepEqual(doc.regions,[
    {id:'from-the-lane',name:'From the lane',rect:{x:3,y:3,w:1,h:1}},
    {id:'the-body',name:'The body',rect:{x:12,y:7,w:1,h:1},sceneId:'hanged-clerk',trigger:'interact',label:'Look closer',notes:'Open the scene.'},
    {id:'old-well',name:'Old well',rect:{x:2,y:2,w:1,h:1},label:'Down the well'},
  ]);
  assert.match(notes[3],/where its exit went \(Maps\/Gone\.kmmap\) isn't a map or scene the migration could find/);
  assert.deepEqual(mapShapeOf(doc),[]);
});

test('what isn\'t a version 1 map can\'t be migrated, and says why',()=>{
  assert.throws(()=>readV1Map(JSON.stringify({format:'kingmaker',version:2,kind:'map'})),/isn't a version 1 map/);
  const v1=JSON.parse(studyText);
  assert.throws(()=>readV1Map(JSON.stringify({...v1,terrain:{...v1.terrain,tiles:v1.terrain.tiles.slice(1)}})),/isn't a version 1 grid/);
  assert.throws(()=>readV1Map(JSON.stringify({...v1,terrain:{...v1.terrain,tiles:v1.terrain.tiles.map((t,i)=>i?t:'lava')}})),/palette ids the version 1 palette hasn't got: lava/);
  // A blank version 1 map (no terrain painted) is the version 1 editor's blank: grass, 32 by 24.
  const blank=migrateV1Map(readV1Map(JSON.stringify({format:'kingmaker',version:1,kind:'map',id:'x',title:'Blank',description:'',nodes:[],edges:[],lore:['Places/Somewhere.md']})),{id:'blank'});
  assert.deepEqual([blank.doc.grid.length,blank.doc.grid[0]],[24,','.repeat(32)]);
  assert.deepEqual(blank.doc.lore,['Places/Somewhere.md'],'what else the file had is kept');
});

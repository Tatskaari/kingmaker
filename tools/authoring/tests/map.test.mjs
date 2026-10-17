import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async file=>{const out=await build({entryPoints:[new URL(`../src/${file}`,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))};
const {blankMap,paint,rectangle,fill,line,validateMap,gameMap,harbourMap,PALETTE,resizeMap}=await load('map-model.ts');
const {parseDocument,serializeDocument,emptyDocument}=await load('model.ts');
const {paintClutter,rectangleClutter,fillClutter,gameClutter}=await load('map-model.ts');
const {saveMapFeature,resizeMapDocument}=await load('map-features.ts');
const {MapStroke}=await load('map-stroke.ts');
test('stroke moves visit only changed brush tiles, not the grid; repeated samples do nothing',()=>{
  const base=blankMap(64,64),s=new MapStroke(base,{x:20,y:20},'water','terrain',1,false);
  assert.deepEqual([...s.move({x:20,y:20})],[20*64+20]);assert.equal(s.move({x:20,y:20}).size,0);
  assert.deepEqual([...s.move({x:23,y:20})],[20*64+21,20*64+22,20*64+23]);assert.equal(s.touched.size,4);assert.equal(s.changed,true);assert.ok(base.tiles.every(t=>t==='grass'));assert.equal(s.draft.clutter,base.clutter);
});
test('rectangle updates and shrinks its dirty footprint without changing the base or unrelated cells',()=>{
  const base=paint(blankMap(8,8),[{x:2,y:2}],'door'),s=new MapStroke(base,{x:1,y:1},'water','terrain',1,true);
  assert.equal(s.move({x:3,y:3}).size,9);assert.equal(s.move({x:3,y:3}).size,0);assert.equal(s.move({x:1,y:1}).size,8);assert.equal(s.draft.tiles[2*8+2],'door');assert.equal(s.draft.tiles.filter(t=>t==='water').length,1);
  assert.deepEqual(s.draft.tiles,rectangle(base,{x:1,y:1},{x:1,y:1},'water').tiles);
});
test('clutter gestures preserve terrain, clip footprints and can be cancelled without mutating history',()=>{
  const base=paintClutter(blankMap(4,4),[{x:0,y:0}],'lamp'),s=new MapStroke(base,{x:0,y:0},null,'clutter',3,false);
  assert.deepEqual([...s.move({x:0,y:0})],[0]);assert.equal(s.draft.tiles,base.tiles);assert.equal(base.clutter[0],'lamp');assert.equal(s.draft.clutter[0],null);
  const empty=new MapStroke(base,{x:1,y:1},'grass','terrain',1,false);assert.equal(empty.move({x:1,y:1}).size,0);assert.equal(empty.changed,false);
});
const {entryPorts,exitPorts,withDestination}=await load('model.ts');
const values=(title,exitPort='')=>({title,eventMessage:'The door creaks open.',exitPort,script:'Future behaviour'});
test('clutter is an independent, serializable layer; tools and erasure never alter terrain',()=>{
  const base=paint(blankMap(4,4),[{x:1,y:1}],'water'),m=paintClutter(base,[{x:1,y:1}],'lamp');
  assert.deepEqual(m.tiles,base.tiles);assert.equal(base.clutter,undefined);assert.equal(m.clutter[5],'lamp');
  const erased=paintClutter(m,[{x:1,y:1}],null);assert.equal(erased.clutter[5],null);assert.equal(erased.tiles[5],'water');
  const rect=rectangleClutter(m,{x:0,y:0},{x:1,y:1},'sign'),filled=fillClutter(rect,{x:0,y:0},'crate');assert.equal(filled.clutter.filter(c=>c==='crate').length,4);assert.deepEqual(filled.tiles,base.tiles);
  const doc={...emptyDocument('map','Test'),terrain:m};assert.deepEqual(parseDocument(serializeDocument(doc)).terrain,m);assert.equal(gameClutter(m,'test')[0].at.x,1);assert.deepEqual(gameClutter(m,'test')[0].states,['lamp','lit','post']);
  assert.throws(()=>validateMap({...m,clutter:['lamp']}));assert.throws(()=>validateMap({...m,clutter:Array(16).fill('unknown')}));
});
test('spawn and interaction ports use stable ids and preserve wired destinations when renamed',()=>{
  let doc=saveMapFeature(emptyDocument('map','Test'),'spawn','spawn',{x:3,y:4},values('From town'));
  doc=saveMapFeature(doc,'door','interaction',{x:4,y:4},values('Open door','To tavern'));
  assert.deepEqual(entryPorts(doc),[{id:'spawn',title:'From town'}]);assert.equal(exitPorts(doc)[0].data.title,'To tavern');assert.equal(doc.nodes[1].data.title,'Open door');
  const target={path:'Maps/Other.kmmap',document:saveMapFeature(emptyDocument('map','Other'),'in','spawn',{x:2,y:2},values('Front door'))};
  doc=withDestination(doc,'door',target,'in');doc=saveMapFeature(doc,'door','interaction',{x:4,y:4},values('Push door','Inside tavern'));
  assert.equal(doc.nodes[1].data.file,target.path);assert.equal(doc.nodes[1].data.entry,'in');assert.equal(exitPorts(doc)[0].id,'door');
  doc=saveMapFeature(doc,'door','interaction',{x:4,y:4},values('Push door'));assert.equal(exitPorts(doc).length,0);assert.equal(doc.nodes[1].data.file,undefined);assert.equal(doc.nodes[1].data.eventMessage,'The door creaks open.');
  assert.deepEqual(parseDocument(serializeDocument(doc)).nodes.map(n=>n.data),doc.nodes.map(n=>n.data));
  assert.throws(()=>saveMapFeature(doc,'duplicate','spawn',{x:1,y:1},values('From town')));
});
test('resize shifts spatial features and clutter; cropping removes only out-of-bounds features',()=>{
  let doc=saveMapFeature({...emptyDocument('map','Test'),terrain:paintClutter(blankMap(8,8),[{x:0,y:1}],'sign')},'spawn','spawn',{x:0,y:1},values('From town'));
  doc=saveMapFeature(doc,'interaction','interaction',{x:4,y:4},values('Read sign'));
  const grown=resizeMapDocument(doc,resizeMap(doc.terrain,'west',2));assert.deepEqual(grown.nodes[0].data.mapAt,{x:2,y:1});assert.equal(grown.terrain.clutter[1*10+2],'sign');
  const cropped=resizeMapDocument(doc,resizeMap(doc.terrain,'west',-2));assert.equal(cropped.nodes.length,1);assert.deepEqual(cropped.nodes[0].data.mapAt,{x:2,y:4});assert.equal(cropped.terrain.clutter.filter(Boolean).length,0);
  assert.equal(parseDocument(serializeDocument(grown)).nodes[0].id,'spawn');assert.equal(doc.nodes[0].data.mapAt.x,0);
});
test('invalid spatial features are rejected instead of losing their placement',()=>{
  const doc=saveMapFeature(emptyDocument('map','Test'),'spawn','spawn',{x:0,y:1},values('From town'));
  for(const data of [{mapAt:{x:-1,y:2}},{mapAt:{x:32,y:2}},{mapAt:{x:1.5,y:2}},{kind:'beat'},{mapFeature:'unknown'}])assert.throws(()=>parseDocument(JSON.stringify({...doc,nodes:[{...doc.nodes[0],data:{...doc.nodes[0].data,...data}}]})));
});
test('painting and erasing are immutable and clipped to bounds',()=>{const m=blankMap(4,4),n=paint(m,[{x:0,y:0}],'water',3);assert.equal(n.tiles.filter(t=>t==='water').length,4);assert.ok(m.tiles.every(t=>t==='grass'));assert.equal(paint(n,[{x:0,y:0}],'grass',3).tiles.filter(t=>t==='water').length,0)});
test('rectangle accepts either drag direction and clips to bounds',()=>{const m=blankMap(4,4);assert.deepEqual(rectangle(m,{x:2,y:2},{x:-2,y:-2},'stone'),rectangle(m,{x:-2,y:-2},{x:2,y:2},'stone'));assert.equal(rectangle(m,{x:2,y:2},{x:-2,y:-2},'stone').tiles.filter(t=>t==='stone').length,9)});
test('flood fill is four-connected and stops at a boundary',()=>{let m=blankMap(5,5);m=rectangle(m,{x:2,y:0},{x:2,y:4},'stone');const n=fill(m,{x:0,y:0},'water');assert.equal(n.tiles.filter(t=>t==='water').length,10);assert.equal(n.tiles.filter(t=>t==='grass').length,10);assert.equal(fill(n,{x:-1,y:0},'grass'),n);assert.equal(fill(n,{x:0,y:0},'water'),n)});
test('continuous strokes fill skipped pointer samples',()=>{assert.deepEqual(line({x:0,y:0},{x:3,y:0}),[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}]);assert.deepEqual(line({x:1,y:1},{x:1,y:1}),[{x:1,y:1}])});
test('all palette materials compile to game terrain without authoring labels',()=>{let m=blankMap();m.tiles.splice(0,PALETTE.length,...PALETTE.map(p=>p.id));const g=gameMap(m,'test','Test');assert.equal(g.tiles[0][7].terrain,'wall');assert.equal(g.tiles[0][7].blocks,true);assert.equal(g.tiles[0][11].roof,'brick');for(const t of g.tiles.flat()){assert.equal(t.color,undefined);assert.equal(t.id,undefined)}assert.equal(g.tiles.length,24);assert.equal(g.tiles[0].length,32)});
test('legacy map ports survive terrain edits and serialization',()=>{const doc=emptyDocument('map','Legacy');doc.nodes=[{id:'entry',position:{x:0,y:0},data:{kind:'start',title:'From town',description:'',lore:[]}}];doc.source={kept:true};const original=structuredClone(doc);assert.equal(parseDocument(serializeDocument(doc)).terrain,undefined);doc.terrain=harbourMap();const read=parseDocument(serializeDocument(doc));assert.deepEqual(read.nodes,original.nodes.map(n=>({...n,type:'story'})));assert.deepEqual(read.source,original.source);assert.deepEqual(read.terrain,doc.terrain)});
test('invalid terrain is rejected without silently replacing it',()=>{for(const change of [m=>m.version=2,m=>m.width=0,m=>m.height=65,m=>m.width=4.5,m=>m.tiles.pop(),m=>m.tiles[0]='lava']){const m=blankMap();change(m);assert.throws(()=>validateMap(m));assert.throws(()=>parseDocument(JSON.stringify({...emptyDocument('map','Bad'),terrain:m})))}assert.throws(()=>parseDocument(JSON.stringify({...emptyDocument('scene','Bad'),terrain:blankMap()})))});
test('harbour example is deterministic, valid and contains buildings and shoreline',()=>{const m=harbourMap();validateMap(m);assert.deepEqual(harbourMap(),m);for(const kind of ['water','deep-water','stone','roof','door','window','tree','boards'])assert.ok(m.tiles.includes(kind))});
test('all four edges grow with grass and preserve every authored tile; inverse crop restores it',()=>{
  const m=blankMap(8,6);m.tiles=m.tiles.map((_,i)=>PALETTE[i%PALETTE.length].id);const before=structuredClone(m);
  for(const edge of ['north','east','south','west']){const r=resizeMap(m,edge,3);validateMap(r.map);assert.equal(r.removed,0);assert.deepEqual(r.offset,{x:edge==='west'?3:0,y:edge==='north'?3:0});for(let y=0;y<r.map.height;y++)for(let x=0;x<r.map.width;x++){const ox=x-r.offset.x,oy=y-r.offset.y;assert.equal(r.map.tiles[y*r.map.width+x],ox>=0&&oy>=0&&ox<m.width&&oy<m.height?m.tiles[oy*m.width+ox]:'grass')}assert.deepEqual(resizeMap(r.map,edge,-3).map,m)}assert.deepEqual(m,before);
});
test('crop reports the exact removed area, preserves retained tiles and clamps dimensions safely',()=>{
  const m=blankMap(8,6);m.tiles[2*8+3]='door';const r=resizeMap(m,'west',-2);assert.equal(r.removed,12);assert.equal(r.map.tiles[2*6+1],'door');assert.equal(resizeMap(m,'north',-100).map.height,4);assert.equal(resizeMap(m,'east',1000).map.width,64);assert.deepEqual(resizeMap(m,'south',0).map,m);assert.throws(()=>resizeMap(m,'up',2));assert.throws(()=>resizeMap(m,'east',1.5));assert.throws(()=>resizeMap(m,'east',Infinity));
});

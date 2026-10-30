import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';

// The plugin's model of a map file (src/map/model.ts) on the game's own maps: read with the game's
// parse, painted as cells, and written back byte for byte where nothing changed.
const bundle=async entry=>{
  const output=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
};
const model=await bundle('../src/map/model.ts');
const game=await bundle('./game-maps.ts');
const {openMapFile,serializeMap,mapShapeOf,cellsOf,gridOf,withCells,paint,rectangle,fill,cellAt,addLegendEntry,setLegendEntry,removeLegendEntry,legendCharProblem,freeChar,entryName,setRegionField,addRegion,removeRegion,setExit,addExit,removeExits,setPersonField,addPerson,removePerson,resizeCells,resizeMap,newMap,DEFAULT_LEGEND,thingsAt,mapFileKind,VOID,renameLegendChar,peopleAbout}=model;

const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const read=path=>readFile(new URL(path,CAMPAIGN),'utf8');
const mapNames=(await readdir(new URL('maps/',CAMPAIGN))).filter(name=>name.endsWith('.kmmap')).sort();
const town=async()=>openMapFile(await read('maps/caerwyn.kmmap'));
const palace=async()=>openMapFile(await read('maps/palace.kmmap'));

test('every real map opens with the game\'s parse and saves to the same bytes; its grid as cells comes back as the same rows',async()=>{
  assert.deepEqual(mapNames,['caerwyn.kmmap','drowned-rat.kmmap','heron.kmmap','kings-road.kmmap','palace.kmmap']);
  for(const name of mapNames){
    const text=await read(`maps/${name}`);
    const doc=openMapFile(text);
    assert.equal(mapFileKind(text),'v2');
    assert.equal(serializeMap(doc),text,`${name} round-trips byte for byte`);
    assert.deepEqual(mapShapeOf(doc),[]);
    const cells=cellsOf(doc.grid);
    assert.equal(cells.cells.length,cells.width*cells.height);
    const grid=gridOf(cells,doc.grid);
    grid.forEach((row,i)=>assert.equal(row,doc.grid[i],`${name} row ${i}`));
    assert.equal(withCells(doc,cells),doc,'the same cells are the same map');
  }
  const doc=await town();
  assert.equal(Object.keys(doc.legend).length,52);
  assert.equal(doc.regions.length,21);
  assert.equal(doc.people.length,30);
  assert.deepEqual([cellsOf(doc.grid).width,cellsOf(doc.grid).height],[64,46]);
});

test('painting changes only the rows it touched; a short row is padded with the void, and keeps its length when what\'s past it stays void',async()=>{
  const doc=await palace();
  assert.equal(doc.grid[0],'PPPPP','the palace\'s first row is short');
  let cells=cellsOf(doc.grid);
  assert.deepEqual([cells.width,cells.height],[14,12]);
  assert.equal(cellAt(cells,{x:9,y:0}),VOID);
  // Paint inside a full row: that row alone changes.
  let next=withCells(doc,paint(cells,[{x:6,y:4}],'a'));
  assert.equal(next.grid[4],'Paaa+faffffffP');
  next.grid.forEach((row,i)=>{if(i!==4)assert.equal(row,doc.grid[i])});
  // Paint past the short row's end: it's padded with the void up to it.
  next=withCells(doc,paint(cells,[{x:8,y:0}],'P'));
  assert.equal(next.grid[0],'PPPPP   P');
  // Paint void over the end of what was painted: the row is its own length again, the same bytes.
  next=withCells(next,paint(cellsOf(next.grid),[{x:8,y:0}],VOID));
  assert.equal(next.grid[0],'PPPPP    ','its own length now, the void within it written');
  // A rectangle and a fill, clipped to the map, either way round.
  cells=cellsOf(doc.grid);
  assert.deepEqual(rectangle(cells,{x:7,y:3},{x:5,y:2},'a').cells,rectangle(cells,{x:5,y:2},{x:7,y:3},'a').cells);
  const filled=fill(cells,{x:6,y:3},'v');
  assert.equal(filled.cells.filter(ch=>ch==='v').length-cells.cells.filter(ch=>ch==='v').length,48,'the dressing room\'s floor, four-connected');
  assert.equal(fill(cells,{x:-1,y:0},'v'),cells);
  // The game builds what the painter writes.
  game.build(withCells(doc,filled));
});

test('the legend is the palette: an entry added, changed where it is, and taken out with what replaces it on the grid',async()=>{
  const doc=await palace();
  assert.equal(legendCharProblem(doc,'P'),'"P" is in the legend already (Gilt wall).');
  assert.match(legendCharProblem(doc,' '),/void/);
  assert.match(legendCharProblem(doc,'ab'),/one character/);
  assert.equal(legendCharProblem(doc,'→'),undefined,'any one character, as the format has it');
  const ch=freeChar(doc,['P','c']);
  assert.equal(ch,'c');
  const lamp={terrain:'floor',style:'carpet',decor:{name:'a candelabrum',glyph:'Ψ',color:'#ffd27f',states:['lamp','lit'],text:'Seven candles, four lit.',blocks:false}};
  let next=addLegendEntry(doc,ch,lamp);
  assert.deepEqual(next.legend.c,{terrain:'floor',style:'carpet',decor:{name:'a candelabrum',glyph:'Ψ',color:'#ffd27f',states:['lamp','lit'],text:'Seven candles, four lit.'}},'in the format\'s order, without what\'s false or empty');
  assert.throws(()=>addLegendEntry(next,'c',lamp),/in the legend already/);
  assert.equal(entryName(next.legend.c),'A candelabrum (on floor)');
  assert.equal(entryName(next.legend.q),'A portrait (on floor)');
  assert.equal(entryName(next.legend.a),'Carpet floor under a palace roof');
  // Changed where it is: the keys keep their places, a new one goes where the format puts it.
  const before=Object.keys(next.legend);
  next=setLegendEntry(next,'q',{...next.legend.q,height:1,decor:{...next.legend.q.decor,color:'#ffffff'}});
  assert.deepEqual(Object.keys(next.legend),before);
  assert.deepEqual(Object.keys(next.legend.q),['terrain','style','height','roof','roofHeight','decor']);
  assert.deepEqual(Object.keys(next.legend.q.decor),['name','glyph','color','blocks','text']);
  assert.equal(next.legend.q.decor.color,'#ffffff');
  assert.equal(setLegendEntry(next,'q',next.legend.q),next,'nothing changed is the same map');
  // Taken out: an unused entry goes; a used one needs what replaces it.
  assert.deepEqual(Object.keys(removeLegendEntry(next,'c').legend),Object.keys(doc.legend));
  assert.throws(()=>removeLegendEntry(next,'q'),/choose what replaces it/);
  const replaced=removeLegendEntry(next,'q','a');
  assert.ok(!replaced.grid.join('').includes('q'));
  assert.equal(replaced.grid[2],'PaaaPffffffffP');
  assert.equal(replaced.grid[1],doc.grid[1],'a row without it is the same row');
  game.build(replaced);
});

test('regions, exits and people are edited one field at a time, in the format\'s order, and found by their tile',async()=>{
  const doc=await town();
  const yard=doc.regions.findIndex(region=>region.id==='granary-yard');
  let next=setRegionField(doc,yard,'locked','The gate is chained.');
  assert.deepEqual(Object.keys(next.regions[yard]),['id','name','rect','sceneId','worldOrigin','trigger','label','lockedAfter','locked','description']);
  next=setRegionField(next,yard,'trigger',undefined);
  assert.ok(!('trigger' in next.regions[yard]));
  assert.equal(setRegionField(doc,yard,'name',doc.regions[yard].name),doc);
  next=addRegion(doc,{id:'cooperage',name:'the cooperage',rect:{x:1,y:1,w:2,h:2}});
  assert.deepEqual(next.regions.at(-1),{id:'cooperage',name:'the cooperage',rect:{x:1,y:1,w:2,h:2}});
  assert.throws(()=>addRegion(next,{id:'cooperage',name:'again',rect:{x:0,y:0,w:1,h:1}}),/already/);
  assert.equal(removeRegion(next,next.regions.length-1).regions.length,21);
  // Exits: moved and re-aimed in place, the point's keys kept.
  next=setExit(doc,0,{...doc.exits[0],to:{map:'heron',at:{x:1,y:5}},label:'Round the back'});
  assert.deepEqual(next.exits[0],{at:{x:11,y:12},to:{map:'heron',at:{x:1,y:5}},label:'Round the back'});
  assert.equal(setExit(doc,0,structuredClone(doc.exits[0])),doc);
  assert.equal(addExit(doc,{at:{x:0,y:0},to:{map:'palace',at:{x:2,y:10}},label:'x'}).exits.length,7);
  assert.equal(removeExits(doc,[2,3,4,5]).exits.length,2);
  // People.
  next=setPersonField(doc,3,'times',['morning']);
  assert.deepEqual(next.people[3].times,['morning']);
  next=addPerson(doc,{name:'a lamplighter',glyph:'l',at:{x:5,y:5}});
  assert.deepEqual(next.people.at(-1),{name:'a lamplighter',times:['morning','afternoon','evening','night','next-morning'],glyph:'l',at:{x:5,y:5},text:''});
  const palaceDoc=await palace();
  const one=addPerson(palaceDoc,{name:'a footman',glyph:'f',at:{x:2,y:5}});
  assert.deepEqual(Object.keys(one),[...Object.keys(palaceDoc),'people']);
  assert.ok(!('people' in removePerson(one,0)),'with nobody left, the optional field goes');
  // What's on a tile: the regions over it (smallest first), its exits and people.
  const found=thingsAt(doc,{x:26,y:35});
  assert.deepEqual(found.regions.map(r=>r.region.id),['rat-door','river-stairs']);
  assert.deepEqual(found.exits.map(e=>e.exit.label),['The Drowned Rat\'s door']);
  // A shape the game can't load is a shape problem, as it is for the game.
  assert.match(mapShapeOf({...doc,exits:[{at:{x:1,y:1},to:{map:'',at:{x:0,y:0}},label:'nowhere'}]}).join(),/exits\[0\]/);
});

test('resizing grows or crops an edge, within 160 by 120; a north or west edge moves the regions, exits and people with their tiles, and what\'s off the map goes',async()=>{
  const doc=await palace();
  const cells=cellsOf(doc.grid);
  // East: the rows keep their bytes (the new tiles are void past them).
  let r=resizeCells(cells,'east',3);
  assert.deepEqual([r.cells.width,r.cells.height,r.offset.x,r.offset.y,r.removed],[17,12,0,0,0]);
  let {doc:next,lost}=resizeMap(doc,r);
  assert.deepEqual(next.grid,doc.grid);
  assert.deepEqual(lost,[]);
  // East with ground: the rows grow.
  r=resizeCells(cells,'east',2,'a');
  ({doc:next}=resizeMap(doc,r));
  assert.equal(next.grid[0],'PPPPP         aa');
  assert.equal(next.grid[1],'PaaaPPpPpPpPpPaa');
  // North: the old rows move down, and so does everything on them.
  r=resizeCells(cells,'north',2,',');
  ({doc:next,lost}=resizeMap(doc,r));
  assert.deepEqual(next.grid.slice(2),doc.grid,'each old row as it was, two rows down');
  assert.equal(next.grid[0],',,,,,,,,,,,,,,');
  assert.deepEqual(next.regions[0].rect,{x:5,y:4,w:8,h:6});
  assert.deepEqual(next.regions[0].worldOrigin,{x:1,y:3});
  assert.deepEqual(next.exits[0].at,{x:2,y:13});
  assert.deepEqual(next.exits[0].to,doc.exits[0].to,'where an exit goes is another map\'s');
  assert.deepEqual(lost,[]);
  // West, cropping: a region is cut to what's left, and what's off the map goes, named.
  r=resizeCells(cells,'west',-3);
  assert.equal(r.removed,36);
  ({doc:next,lost}=resizeMap(doc,r));
  assert.deepEqual(next.regions.find(region=>region.id==='dressing-room').rect,{x:2,y:2,w:8,h:6});
  assert.deepEqual(next.regions.find(region=>region.id==='long-gallery').rect,{x:0,y:1,w:1,h:9},'cut to its last column');
  assert.deepEqual(lost,['the exit "Down to the palace gate" at (2, 11)']);
  ({lost}=resizeMap(doc,resizeCells(cells,'west',-4)));
  assert.deepEqual(lost,['region long-gallery','region back-stairs','the exit "Down to the palace gate" at (2, 11)']);
  assert.equal(next.grid[1],'aPPpPpPpPpP');
  // The limits: no bigger than 160 by 120, no smaller than 2.
  assert.equal(resizeCells(cells,'east',500).cells.width,160);
  assert.equal(resizeCells(cells,'south',500).cells.height,120);
  assert.equal(resizeCells(cells,'west',-500).cells.width,2);
});

test('a new map is the default legend, the plugin\'s palette and its clutter, on a grid of grass; the game builds it',()=>{
  const doc=newMap('The Cooperage');
  assert.equal(doc.id,'the-cooperage');
  assert.equal(Object.keys(doc.legend).length,20);
  assert.deepEqual(Object.keys(doc.legend),DEFAULT_LEGEND.map(item=>item.ch));
  assert.deepEqual(doc.legend['#'],{terrain:'wall',style:'stone'});
  assert.deepEqual(doc.legend.l,{terrain:'cobbles',decor:{name:'a lamp',glyph:'¤',color:'#ffd27f',states:['lamp','lit','post']}});
  assert.equal(doc.grid.length,24);
  assert.ok(doc.grid.every(row=>row===','.repeat(32)));
  assert.deepEqual(mapShapeOf(doc),[]);
  const built=game.build(doc);
  assert.deepEqual([built.width,built.height],[32,24]);
  // Every entry of it builds, as the game builds a map: a row painted with each.
  const painted=withCells(doc,paint(cellsOf(doc.grid),DEFAULT_LEGEND.map((_,x)=>({x,y:0})),'?'));
  const row=DEFAULT_LEGEND.map(item=>item.ch).join('');
  const every={...painted,grid:[row+painted.grid[0].slice(row.length),...painted.grid.slice(1)]};
  assert.deepEqual(game.terrainsOf(every).sort(),['boards','bridge','cobbles','deep-water','dirt','door','fence','grass','stairs','tree','wall','water','window']);
  assert.equal(game.decorOf(every).length,5,'the clutter stands on its tiles');
});

test('what isn\'t a map of the format is refused, naming what\'s wrong; a version 1 map is told apart',async()=>{
  assert.throws(()=>openMapFile('{ nope','maps/broken.kmmap'),/maps\/broken\.kmmap: it isn't JSON/);
  const doc=await town();
  assert.throws(()=>openMapFile(JSON.stringify({...doc,legend:{'..':{terrain:'grass'}}})),/legend "\.\." isn't one character/);
  assert.throws(()=>openMapFile(JSON.stringify({...doc,version:1})),/isn't a map of the kingmaker format, version 2/);
  const study=await readFile(new URL('fixtures/v1-study/Harbour study.kmmap',import.meta.url),'utf8');
  assert.equal(mapFileKind(study),'v1');
  assert.equal(mapFileKind('{}'),'other');
});

test('a legend character renamed: its entry where it was, every tile painted with it written in the new one, and only those rows changed',async()=>{
  const text=await read('maps/palace.kmmap'),doc=openMapFile(text);
  const next=renameLegendChar(doc,'f','F');
  assert.deepEqual(Object.keys(next.legend),Object.keys(doc.legend).map(ch=>ch==='f'?'F':ch));
  assert.deepEqual(next.legend.F,doc.legend.f);
  next.grid.forEach((row,y)=>assert.equal(row,doc.grid[y].replaceAll('f','F'),`row ${y}`));
  assert.ok(next.grid.some((row,y)=>row!==doc.grid[y]));
  assert.equal(serializeMap(next).split('\n').filter((line,i)=>line!==serializeMap(doc).split('\n')[i]).length,doc.grid.filter(row=>row.includes('f')).length+1);
  assert.throws(()=>renameLegendChar(doc,'f','a'),/in the legend already/);
  assert.throws(()=>renameLegendChar(doc,'f',' '),/the void/);
  assert.equal(renameLegendChar(doc,'f','f'),doc);
  // People by the hour: the town's about in the morning and at night.
  const town=openMapFile(await read('maps/caerwyn.kmmap'));
  assert.equal(peopleAbout(town).length,town.people.length);
  assert.deepEqual(peopleAbout(town,'night').map(({index})=>index),town.people.flatMap((person,index)=>person.times.includes('night')?[index]:[]));
});

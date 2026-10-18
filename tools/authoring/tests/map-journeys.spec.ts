import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// The map editor on the game's own maps (the browser harness's vault is campaigns/caerwyn): painting
// in the legend's characters, regions, exits and people, the scenario's start, a scene's place laid on
// its region, and a version 1 map migrated. Every journey asserts the files as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const original=async(path:string)=>JSON.parse(await readFile(new URL(path,CAMPAIGN),'utf8'));
const savedText=(page:Page,path:string)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path:string)=>JSON.parse(await savedText(page,path));
const canvas=(page:Page)=>page.locator('.map-stage canvas');
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const renderStats=(page:Page)=>canvas(page).evaluate(el=>({...((el as any).__kmPixi.stats)}));
const open=async(page:Page,path:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  await expect(page.locator('.file-path')).toHaveText(path);
};
const openMap=async(page:Page,path:string)=>{
  await open(page,path);
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');
  // The campaign around the map is read.
  await expect(page.locator('.km-map[data-campaign="read"]')).toBeVisible();
};
/** Where a tile's middle is on the page, as the painter draws it. */
async function point(page:Page,x:number,y:number){return canvas(page).evaluate((el,{x,y})=>{const c=el as HTMLCanvasElement,b=c.getBoundingClientRect(),z=Number(c.dataset.zoom),cx=Number(c.dataset.cameraX),cy=Number(c.dataset.cameraY);return {x:b.x+b.width/2+(x-cx+y-cy)*18*z,y:b.y+b.height*.56+(y-cy-x+cx)*9*z}},{x,y})}
async function stroke(page:Page,from:{x:number;y:number},to=from){const a=await point(page,from.x,from.y),b=await point(page,to.x,to.y);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up()}
async function tileMenu(page:Page,x:number,y:number){const p=await point(page,x,y);await page.mouse.click(p.x,p.y,{button:'right'});await expect(page.getByRole('menu',{name:`Tile ${x}, ${y}`})).toBeVisible()}
const fit=async(page:Page)=>{await page.getByRole('button',{name:/^Fit/}).click();await settle(page)};

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
});

test('every real map opens in the painter with no problems, and opening saves nothing; the town paints and saves a row at a time',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const before=await page.evaluate(()=>({...(window as any).__kingmakerHarness.files}));
  for(const id of ['caerwyn','drowned-rat','heron','palace']){
    await openMap(page,`maps/${id}.kmmap`);
    await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
    const map=await original(`maps/${id}.kmmap`);
    await expect(page.getByRole('heading',{level:1})).toHaveText(map.title);
    await expect(canvas(page)).toHaveAttribute('data-width',String(Math.max(...map.grid.map((row:string)=>[...row].length))));
    await expect(page.getByRole('list',{name:'Legend'}).getByRole('listitem')).toHaveCount(Object.keys(map.legend).length+1);
  }
  expect(await page.evaluate(()=>({...(window as any).__kingmakerHarness.files}))).toEqual(before);
  // The town: 64 by 46, 52 legend entries, 21 regions, 30 people. Paint the river a stroke at a time.
  await openMap(page,'maps/caerwyn.kmmap');
  await fit(page);
  const town=await original('maps/caerwyn.kmmap');
  const stats=await renderStats(page);
  await page.getByRole('button',{name:/^Paint “_” Boards$/}).click();
  await stroke(page,{x:20,y:43},{x:24,y:43});
  await settle(page);
  const painted=await renderStats(page);
  expect(painted.fullSyncs-stats.fullSyncs,'one sync, when the stroke is saved').toBeLessThanOrEqual(1);
  const after=await saved(page,'maps/caerwyn.kmmap');
  expect(after.grid[43]).toBe(town.grid[43].slice(0,20)+'_____'+town.grid[43].slice(25));
  after.grid.forEach((row:string,y:number)=>{if(y!==43)expect(row,`row ${y}`).toBe(town.grid[y])});
  expect({...after,grid:town.grid}).toEqual(town);
  // Hover and pan do no work a tile.
  const idle=await renderStats(page),box=(await canvas(page).boundingBox())!;
  for(let i=0;i<10;i++)await page.mouse.move(box.x+box.width/2+i*3,box.y+box.height*.56+i);
  await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width/2+120,box.y+box.height*.56+60,{steps:10});await page.mouse.up({button:'middle'});
  await settle(page);
  const moved=await renderStats(page);
  for(const key of ['fullSyncs','tileChecks','tileUpdates','tileCollections'])expect(moved[key]-idle[key],key).toBe(0);
  expect(moved.viewUpdates).toBeGreaterThan(idle.viewUpdates);
  // Undo puts the row back, byte for byte, and redo paints it again.
  await page.getByRole('button',{name:'Undo map edit'}).click();
  expect(await savedText(page,'maps/caerwyn.kmmap')).toBe(await readFile(new URL('maps/caerwyn.kmmap',CAMPAIGN),'utf8'));
  await page.getByRole('button',{name:'Redo map edit'}).click();
  expect((await saved(page,'maps/caerwyn.kmmap')).grid[43]).toBe(after.grid[43]);
  await page.screenshot({path:'dist/screenshots/map-town.png'});
  expect(errors).toEqual([]);
});

test('painting with a new legend entry: its fields from the editor, the palette is the legend, and the rows painted are the rows written',async({page})=>{
  await openMap(page,'maps/palace.kmmap');
  await fit(page);
  const palace=await original('maps/palace.kmmap');
  await page.getByRole('button',{name:'New entry'}).click();
  const dialog=page.getByRole('dialog',{name:'New legend entry'});
  await dialog.getByLabel('Character',{exact:true}).fill('c');
  await dialog.getByLabel('Terrain',{exact:true}).selectOption('floor');
  await dialog.getByLabel('Style',{exact:true}).fill('carpet');
  await dialog.getByLabel('Roof',{exact:true}).fill('palace');
  await dialog.getByLabel('Roof height',{exact:true}).fill('4');
  await dialog.getByRole('button',{name:'Something stands on it'}).click();
  await dialog.getByLabel('Decor name',{exact:true}).fill('a candelabrum');
  await dialog.getByLabel('Glyph',{exact:true}).fill('Ψ');
  await dialog.getByLabel('Colour',{exact:true}).fill('#ffd27f');
  await dialog.getByLabel('Decor text',{exact:true}).fill('Seven candles, four of them lit.');
  await dialog.getByLabel('Decor blocks the way').check();
  await page.screenshot({path:'dist/screenshots/map-new-legend-entry.png'});
  await dialog.getByRole('button',{name:'Add entry'}).click();
  let doc=await saved(page,'maps/palace.kmmap');
  expect(doc.legend.c).toEqual({terrain:'floor',style:'carpet',roof:'palace',roofHeight:4,decor:{name:'a candelabrum',glyph:'Ψ',color:'#ffd27f',blocks:true,text:'Seven candles, four of them lit.'}});
  expect(Object.keys(doc.legend)).toEqual([...Object.keys(palace.legend),'c']);
  expect(doc.grid).toEqual(palace.grid);
  // It's the paint material now: three tiles of the dressing room.
  await expect(page.getByRole('button',{name:'Choose paint material'})).toContainText('“c” A candelabrum');
  await stroke(page,{x:6,y:3},{x:8,y:3});
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.grid[3]).toBe('PaaaPfcccffffp');
  doc.grid.forEach((row:string,y:number)=>{if(y!==3)expect(row).toBe(palace.grid[y])});
  // The eyedropper and the eraser: erase is the most used ground, the carpet.
  await canvas(page).press('i');await stroke(page,{x:1,y:5});
  await expect(page.getByRole('button',{name:'Choose paint material'})).toContainText('“q” A portrait');
  await canvas(page).press('e');await stroke(page,{x:7,y:3});
  expect((await saved(page,'maps/palace.kmmap')).grid[3]).toBe('PaaaPfcfcffffp');
  // The entry edited in the inspector, where it is in the legend; then deleted, its tiles painted over.
  await page.getByRole('button',{name:'Edit legend entry “c”'}).click();
  await page.locator('.legend-inspector').getByLabel('Decor name',{exact:true}).fill('a candlestick');
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.legend.c.decor.name).toBe('a candlestick');
  await page.locator('.legend-inspector').getByRole('button',{name:'Delete entry…'}).click();
  const remove=page.getByRole('dialog',{name:'Delete legend entry'});
  await remove.getByLabel('Paint its tiles with').selectOption('f');
  await remove.getByRole('button',{name:'Delete entry'}).click();
  doc=await saved(page,'maps/palace.kmmap');
  expect('c' in doc.legend).toBe(false);
  expect(doc.grid[3]).toBe(palace.grid[3]);
  // The game builds what was painted: no problems.
  await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
});

test('an exit and a person added from a tile\'s menu, each edited in the inspector, and the story\'s start set on a tile',async({page})=>{
  await openMap(page,'maps/palace.kmmap');
  await fit(page);
  const palace=await original('maps/palace.kmmap');
  await tileMenu(page,12,3);
  expect(await page.getByRole('menuitem').allTextContents()).toEqual(['Edit region the King\'s dressing room…','Delete region the King\'s dressing room…','Add region here…','Add exit here…','Add person here…','Start the story here']);
  await page.keyboard.press('Escape');
  // An exit: out of a window onto the town (landing just inside the town's way back to the palace).
  await tileMenu(page,13,6);
  await page.getByRole('menuitem',{name:'Add exit here…'}).click();
  const exit=page.getByRole('dialog',{name:'New exit'});
  await exit.getByLabel('Label',{exact:true}).fill('Out of the window');
  await exit.getByLabel('To map',{exact:true}).selectOption('caerwyn');
  await exit.getByRole('button',{name:'Add exit'}).click();
  let doc=await saved(page,'maps/palace.kmmap');
  expect(doc.exits).toEqual([...palace.exits,{at:{x:13,y:6},to:{map:'caerwyn',at:{x:11,y:13}},label:'Out of the window'}]);
  await page.locator('.exit-inspector').getByLabel('Label',{exact:true}).fill('Out of the gallery window');
  expect((await saved(page,'maps/palace.kmmap')).exits.at(-1).label).toBe('Out of the gallery window');
  // A person: a footman in the gallery, about in the morning only.
  await tileMenu(page,2,4);
  await page.getByRole('menuitem',{name:'Add person here…'}).click();
  const person=page.getByRole('dialog',{name:'New person'});
  await person.getByLabel('Name',{exact:true}).fill('a footman');
  await person.getByLabel('Glyph',{exact:true}).fill('f');
  await person.getByRole('button',{name:'Add'}).click();
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.people).toEqual([{name:'a footman',times:['morning','afternoon','evening','night','next-morning'],glyph:'f',at:{x:2,y:4},text:''}]);
  const inspector=page.locator('.person-inspector');
  await inspector.getByLabel('Text',{exact:true}).fill('“The King is not receiving.”');
  for(const time of ['afternoon','evening','night','next morning'])await inspector.getByLabel(time,{exact:true}).uncheck();
  await inspector.getByLabel('Out of the way').check();
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.people).toEqual([{name:'a footman',times:['morning'],glyph:'f',at:{x:2,y:4},text:'“The King is not receiving.”',blocks:false}]);
  expect(Object.keys(doc)).toEqual([...Object.keys(palace),'people']);
  // The person and the exit are on the map: dragged a tile, they move there.
  const marker=page.getByRole('button',{name:'Person a footman at 2, 4'});
  const from=await point(page,2,4),to=await point(page,2,5);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
  await expect(page.getByRole('button',{name:'Person a footman at 2, 5'})).toBeVisible();
  expect((await saved(page,'maps/palace.kmmap')).people[0].at).toEqual({x:2,y:5});
  await expect(marker).toHaveCount(0);
  // The story's start: on a tile of this map, written in the scenario.
  await tileMenu(page,3,5);
  await page.getByRole('menuitem',{name:'Start the story here'}).click();
  await expect(page.getByRole('button',{name:'The story\'s start at 3, 5'})).toBeVisible();
  const scenario=await saved(page,'caerwyn.kmscenario');
  expect(scenario.start).toEqual({day:1,time:'morning',map:'palace',at:[3,5]});
  expect({...scenario,start:undefined}).toEqual({...await original('caerwyn.kmscenario'),start:undefined});
  // Undo takes the start back, in the scenario's file.
  await page.getByRole('button',{name:'Undo map edit'}).click();
  await expect(page.getByRole('button',{name:'The story\'s start at 3, 5'})).toHaveCount(0);
  expect(await savedText(page,'caerwyn.kmscenario')).toBe(await readFile(new URL('caerwyn.kmscenario',CAMPAIGN),'utf8'));
  await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
});

test('a region tied to a scene lays its place on the map, and a thing of the place moved there is moved in the place\'s file',async({page})=>{
  await openMap(page,'maps/palace.kmmap');
  await fit(page);
  const palace=await original('maps/palace.kmmap'),room=await original('places/dressing-room.kmplace');
  // A new region, drawn with the region tool: the King's closet.
  await page.getByRole('button',{name:'Region',exact:true}).click();
  await stroke(page,{x:5,y:2},{x:12,y:7});
  const dialog=page.getByRole('dialog',{name:'New region'});
  await expect(dialog.getByLabel('w',{exact:true})).toHaveValue('8');
  await dialog.getByLabel('Name',{exact:true}).fill('the King\'s closet');
  await expect(dialog.getByLabel('Id',{exact:true})).toHaveAttribute('placeholder','the-kings-closet');
  await dialog.getByRole('button',{name:'Add region'}).click();
  let doc=await saved(page,'maps/palace.kmmap');
  expect(doc.regions.at(-1)).toEqual({id:'the-kings-closet',name:'the King\'s closet',rect:{x:5,y:2,w:8,h:6}});
  // Tied to the King's morning, its place laid here from the region's corner.
  const inspector=page.locator('.region-inspector');
  await inspector.getByRole('button',{name:'Play a scene here'}).click();
  await inspector.getByLabel('Scene',{exact:true}).selectOption('kings-morning');
  await inspector.getByLabel('Its scene\'s place is laid here').check();
  await inspector.getByLabel('Trigger',{exact:true}).selectOption('enter');
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.regions.at(-1)).toEqual({id:'the-kings-closet',name:'the King\'s closet',rect:{x:5,y:2,w:8,h:6},sceneId:'kings-morning',worldOrigin:{x:5,y:2},trigger:'enter'});
  expect(doc.regions.slice(0,-1)).toEqual(palace.regions);
  // The region selected, its place is shown as soon as it lays it, with no button to press (and the button hides it).
  await expect(page.locator('.map-place-note')).toContainText('places/dressing-room.kmplace');
  await expect(inspector.getByRole('button',{name:'Hide its place'})).toBeVisible();
  await expect(page.locator('.map-marker-thing')).toHaveCount(room.things.filter((t:any)=>t.at).length);
  await expect(page.locator('.map-marker-cast')).toHaveCount(Object.keys(room.people).length);
  await page.screenshot({path:'dist/screenshots/map-place-layer.png'});
  // The long mirror, at 42, 7 feet (tile 13, 3 from the corner at 5, 2), dragged a tile south.
  const mirror=page.getByRole('button',{name:'Thing a long mirror'});
  const box=(await mirror.boundingBox())!,to=await point(page,13,4);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
  await expect.poll(async()=>(await saved(page,'places/dressing-room.kmplace')).things.find((t:any)=>t.id==='mirror').at).toEqual([42,12]);
  const place=await saved(page,'places/dressing-room.kmplace');
  expect({...place,things:place.things.filter((t:any)=>t.id!=='mirror')}).toEqual({...room,things:room.things.filter((t:any)=>t.id!=='mirror')});
  expect(place.things.find((t:any)=>t.id==='mirror')).toEqual({...room.things.find((t:any)=>t.id==='mirror'),at:[42,12]});
  // Selected, the thing's inspector edits the place: its name and states.
  await page.getByRole('button',{name:'Thing a long mirror'}).click();
  const thing=page.locator('.place-inspector[data-place-part="thing:mirror"]');
  // Typed a key at a time, each a write of the place's file: they queue, and none is lost.
  const name=thing.getByLabel('Name',{exact:true});
  await name.fill('');
  await name.pressSequentially('a cheval glass');
  await expect(name).toHaveValue('a cheval glass');
  await expect.poll(async()=>(await saved(page,'places/dressing-room.kmplace')).things.find((t:any)=>t.id==='mirror').name).toBe('a cheval glass');
  // Undo puts the place back as it was, a step at a time: the name typed in one go is one step.
  await page.getByRole('button',{name:'Undo map edit'}).click();
  await expect.poll(async()=>(await saved(page,'places/dressing-room.kmplace')).things.find((t:any)=>t.id==='mirror').name).toBe('a long mirror');
  await page.getByRole('button',{name:'Undo map edit'}).click();
  await expect.poll(()=>savedText(page,'places/dressing-room.kmplace')).toBe(await readFile(new URL('places/dressing-room.kmplace',CAMPAIGN),'utf8'));
  expect((await saved(page,'maps/palace.kmmap')).regions.at(-1).worldOrigin).toEqual({x:5,y:2});
  // On the town, selecting the granary yard's region shows the yard; a thing added from a tile's menu is the place's.
  await openMap(page,'maps/caerwyn.kmmap');
  await page.getByRole('tab',{name:/^Regions/}).click();
  await page.locator('.list-view').getByRole('button',{name:/^the yard behind the King's Granary/}).click();
  await expect(page.locator('.list-view .doc-card')).toContainText('The yard behind the King\'s Granary');
  await page.locator('.list-view .doc-card').getByRole('button',{name:'Show on the map'}).click();
  await expect(page.locator('.map-place-note')).toContainText('places/granary-yard.kmplace');
  await expect(page.locator('.region-inspector[data-region="granary-yard"]')).toBeVisible();
  await tileMenu(page,44,14);
  await page.getByRole('menuitem',{name:'Add a thing of The yard behind the King\'s Granary here…'}).click();
  const pigeon=page.getByRole('dialog',{name:'New thing'});
  await pigeon.getByLabel('Name',{exact:true}).fill('a dead pigeon');
  await pigeon.getByRole('button',{name:'Add thing'}).click();
  await expect.poll(async()=>(await saved(page,'places/granary-yard.kmplace')).things.at(-1)).toEqual({id:'a-dead-pigeon',name:'a dead pigeon',in:'yard',at:[22,27]});
  await expect(page.getByRole('button',{name:'Thing a dead pigeon'})).toBeVisible();
  // Off the yard's tiles (laid at 40, 9, eleven by eight) nothing of it is offered; on its last column, part of a tile (50 to 52 feet), a thing stands on its floor.
  await tileMenu(page,38,12);
  await expect(page.getByRole('menuitem',{name:/^Add a thing of/})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await tileMenu(page,50,15);
  await page.getByRole('menuitem',{name:'Add a thing of The yard behind the King\'s Granary here…'}).click();
  const crate=page.getByRole('dialog',{name:'New thing'});
  await crate.getByLabel('Name',{exact:true}).fill('a crate');
  await crate.getByRole('button',{name:'Add thing'}).click();
  await expect.poll(async()=>(await saved(page,'places/granary-yard.kmplace')).things.at(-1)).toEqual({id:'a-crate',name:'a crate',in:'loft',at:[51,32]});
});

test('resizing grows the map and moves what stands on it; the scenario\'s start and other maps\' ways in move with a north edge',async({page})=>{
  await openMap(page,'maps/palace.kmmap');
  await fit(page);
  const palace=await original('maps/palace.kmmap'),town=await original('maps/caerwyn.kmmap');
  await page.getByRole('button',{name:'Resize',exact:true}).click();
  await page.getByRole('button',{name:'Resize north edge'}).focus();
  await page.keyboard.press('+');
  const doc=await saved(page,'maps/palace.kmmap');
  expect(doc.grid.length).toBe(13);
  expect(doc.grid.slice(1)).toEqual(palace.grid);
  expect(doc.regions[0].rect).toEqual({...palace.regions[0].rect,y:3});
  expect(doc.regions[0].worldOrigin).toEqual({x:1,y:2});
  expect(doc.exits[0].at).toEqual({x:2,y:12});
  // The town's way in through the palace gate lands a tile further south, as the tiles moved.
  const after=await saved(page,'maps/caerwyn.kmmap');
  expect(after.exits[0].to.at).toEqual({x:2,y:11});
  expect({...after,exits:town.exits}).toEqual(town);
  await page.getByRole('button',{name:'Undo map edit'}).click();
  expect(await savedText(page,'maps/palace.kmmap')).toBe(await readFile(new URL('maps/palace.kmmap',CAMPAIGN),'utf8'));
  expect(await savedText(page,'maps/caerwyn.kmmap')).toBe(await readFile(new URL('maps/caerwyn.kmmap',CAMPAIGN),'utf8'));
  // Cropping from the keyboard asks once: pressed again on the same edge, while it keeps the focus, it crops on without asking.
  const width=async()=>Math.max(...(await saved(page,'maps/palace.kmmap')).grid.map((row:string)=>[...row].length));
  const east=page.getByRole('button',{name:'Resize east edge'});
  await east.focus();
  await page.keyboard.press('-');
  await expect(page.getByRole('alertdialog')).toContainText('Pressing − again on this edge crops on without asking');
  await page.getByRole('button',{name:'Crop map'}).click();
  await expect.poll(width).toBe(13);
  await expect(east).toBeFocused();
  await page.keyboard.press('-');
  await expect.poll(width).toBe(12);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // Left and come back to, the edge asks again.
  await page.getByRole('button',{name:'Resize north edge'}).focus();
  await east.focus();
  await page.keyboard.press('-');
  await expect(page.getByRole('alertdialog')).toContainText('Crop the map?');
  await page.getByRole('button',{name:'Cancel'}).click();
  expect(await width()).toBe(12);
});

test('the Game preview is the game\'s renderer on the map as the game builds it, with the people about at an hour, and saves nothing',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await openMap(page,'maps/caerwyn.kmmap');
  const before=await savedText(page,'maps/caerwyn.kmmap');
  await canvas(page).press('Tab');
  await expect(canvas(page)).toHaveAttribute('data-mode','preview');
  await page.getByRole('button',{name:/^Fit/}).click();
  await expect(page.locator('.map-error')).toHaveCount(0);
  const colours=async()=>canvas(page).evaluate(el=>{const c=el as HTMLCanvasElement,data=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data,s=new Set<string>();for(let i=0;i<data.length;i+=4)s.add(`${data[i]},${data[i+1]},${data[i+2]}`);return s.size});
  expect(await colours()).toBeGreaterThan(100);
  await page.screenshot({path:'dist/screenshots/map-town-preview.png'});
  await page.getByLabel('Time of day').selectOption('night');
  await page.getByLabel('Lift roofs').check();
  await expect(page.locator('.map-error')).toHaveCount(0);
  await canvas(page).hover();
  await expect(page.locator('.map-hover-tile')).toContainText('Hover:');
  await page.getByRole('tab',{name:'Paint',exact:true}).click();
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');
  expect(await savedText(page,'maps/caerwyn.kmmap')).toBe(before);
  expect(errors).toEqual([]);
});

test('a map as big as the format allows, 160 by 120, opens, paints and saves',async({page})=>{
  const map={format:'kingmaker',version:2,kind:'map',id:'big',title:'Big',description:'The biggest map.',grid:Array.from({length:120},()=>','.repeat(160)),legend:{',':{terrain:'grass'},'.':{terrain:'cobbles'}},regions:[],exits:[]};
  await page.evaluate(map=>(window as any).__kingmakerHarness.writeDocument('maps/big.kmmap',map),map);
  await openMap(page,'maps/big.kmmap');
  await expect(canvas(page)).toHaveAttribute('data-width','160');
  await expect(canvas(page)).toHaveAttribute('data-height','120');
  await page.getByRole('button',{name:/^Paint “\.” Cobbles$/}).click();
  const stats=await renderStats(page);
  await stroke(page,{x:80,y:60},{x:84,y:60});
  await settle(page);
  const after=await renderStats(page);
  expect(after.tileUpdates-stats.tileUpdates).toBeLessThan(40);
  const doc=await saved(page,'maps/big.kmmap');
  expect(doc.grid[60]).toBe(','.repeat(80)+'.....'+','.repeat(75));
  expect(doc.grid.filter((row:string)=>row!==','.repeat(160))).toHaveLength(1);
});

test('a version 1 map migrated: the user\'s harbour study, its spawn point made the scenario\'s start, opens as a map of the format',async({page})=>{
  const study=await readFile(new URL('fixtures/v1-study/Harbour study.kmmap',import.meta.url),'utf8');
  await page.evaluate(study=>(window as any).__kingmakerHarness.writeDocument('maps/harbour-study.kmmap',study),study);
  await open(page,'maps/harbour-study.kmmap');
  const offer=page.getByRole('region',{name:'A version 1 map'});
  await expect(offer).toContainText('This is a version 1 map');
  await expect(offer).toContainText('64 × 50 tiles');
  await expect(offer.locator('.migration-legend li')).toHaveCount(15);
  await offer.getByLabel(/Make “docks” \(46, 40\) the scenario's start, and list harbour-study among its maps/).check();
  await page.screenshot({path:'dist/screenshots/map-migration.png'});
  expect(await savedText(page,'maps/harbour-study.kmmap')).toBe(study);
  await offer.getByRole('button',{name:'Migrate to version 2'}).click();
  // The map editor opens it: the file is the format's now.
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');
  await expect(canvas(page)).toHaveAttribute('data-width','64');
  const doc=await saved(page,'maps/harbour-study.kmmap');
  expect([doc.format,doc.version,doc.kind,doc.id,doc.title]).toEqual(['kingmaker',2,'map','harbour-study','Harbour study']);
  expect(doc.grid).toHaveLength(50);
  expect(Object.keys(doc.legend)).toEqual([',','L',':','.','l','s','_','~','w','#','W','+','o','r','t']);
  expect(doc.regions).toEqual([{id:'asdf',name:'asdf',rect:{x:36,y:41,w:1,h:1}}]);
  expect(doc.exits).toEqual([]);
  // Tile for tile what the version 1 map was.
  const v1=JSON.parse(study),chars:Record<string,string>={grass:',',dirt:':',cobbles:'.',boards:'_',water:'~','deep-water':'w',stone:'#',timber:'W',door:'+',window:'o',roof:'r',tree:'t'};
  const pairs:Record<string,string>={'grass|lamp':'L','cobbles|lamp':'l','cobbles|sign':'s'};
  v1.terrain.tiles.forEach((id:string,i:number)=>{const clutter=v1.terrain.clutter?.[i];expect([...doc.grid[Math.floor(i/64)]][i%64]).toBe(clutter?pairs[`${id}|${clutter}`]:chars[id])});
  const scenario=await saved(page,'caerwyn.kmscenario');
  expect(scenario.start).toEqual({day:1,time:'morning',map:'harbour-study',at:[46,40]});
  expect(scenario.maps).toEqual(['caerwyn','drowned-rat','heron','palace','harbour-study']);
  await expect(page.getByRole('button',{name:'The story\'s start at 46, 40'})).toBeVisible();
});

test('a key the format doesn\'t know, a migrated region\'s notes, is shown on the region\'s card, edited and taken out',async({page})=>{
  const palace=await original('maps/palace.kmmap');
  const withNotes={...palace,regions:palace.regions.map((r:any,i:number)=>i===0?{...r,notes:'Script: the guard turns away.'}:r)};
  await page.evaluate(map=>(window as any).__kingmakerHarness.writeDocument('maps/palace.kmmap',map),withNotes);
  await openMap(page,'maps/palace.kmmap');
  await page.getByRole('tab',{name:/^Regions/}).click();
  const card=page.locator('.list-view .doc-card');
  await expect(card.locator('[data-field="other"]')).toContainText('notes');
  await card.getByLabel('notes',{exact:true}).fill('Script: the guard salutes.');
  expect((await saved(page,'maps/palace.kmmap')).regions[0].notes).toBe('Script: the guard salutes.');
  await card.getByRole('button',{name:'Remove notes'}).click();
  expect(await savedText(page,'maps/palace.kmmap')).toBe(await readFile(new URL('maps/palace.kmmap',CAMPAIGN),'utf8'));
  await expect(card.locator('[data-field="other"]')).toHaveCount(0);
});

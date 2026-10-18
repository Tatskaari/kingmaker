import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// A new map, its place and the scene laid there, written from nothing in the browser test harness as an
// author would, every value through a control and none by editing a file, in panes as wide as an
// Obsidian pane is (twice: the map and the scenario at 1000px and the place and the scene at 700px, then the
// other way round, so each document is written at each width): the map made
// from the scenario's Files view, cropped from its Map view, painted with a new legend entry, a region
// that plays a new scene made where it's picked and lays the scene's new place, a way to the town and
// one back, and two people by the hour; the place's two areas, three things and a start; the scene, a
// path's via picked from the place's things; and the scenario wired: the ending's next, the start moved
// onto the new map and back. Every editor's Problems view finds nothing, and the files are as written.
// With KINGMAKER_AUTHORED set, the files it wrote are saved there, for the campaign check and the
// game's loaders to read (the migration log has how).
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const original=async(file:string)=>JSON.parse(await readFile(new URL(file,CAMPAIGN),'utf8'));
const savedText=(page:Page,file:string)=>page.evaluate(file=>(window as any).__kingmakerHarness.files[file] as string|undefined,file);
const saved=async(page:Page,file:string)=>JSON.parse((await savedText(page,file))??'null');
const open=async(page:Page,file:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(file);
  await expect(page.locator('.file-path')).toHaveText(file);
};
const tab=(page:Page,list:string,name:string)=>page.getByRole('tablist',{name:list}).getByRole('tab',{name:new RegExp(`^${name}`)});
/** Text typed into a labelled field, and the field left (one step of undo). */
const write=async(within:Locator,label:string,text:string)=>{const field=within.getByLabel(label,{exact:true});await field.fill(text);await field.blur()};
const dialog=(page:Page,name:string)=>page.getByRole('dialog',{name});
/** A tile's x and y in a labelled pair of fields. */
const tile=async(within:Locator,legend:string,x:number,y:number)=>{const set=within.locator('fieldset',{has:within.page().locator('legend',{hasText:legend})}).first();await set.getByLabel(/^x/).fill(String(x));await set.getByLabel(/^y/).fill(String(y))};

// The painter: where a tile's middle is on the page, and a stroke from one tile to another.
const canvas=(page:Page)=>page.locator('.map-stage canvas');
const point=(page:Page,x:number,y:number)=>canvas(page).evaluate((el,{x,y})=>{const c=el as HTMLCanvasElement,b=c.getBoundingClientRect(),z=Number(c.dataset.zoom),cx=Number(c.dataset.cameraX),cy=Number(c.dataset.cameraY);return {x:b.x+b.width/2+(x-cx+y-cy)*18*z,y:b.y+b.height*.56+(y-cy-x+cx)*9*z}},{x,y});
const stroke=async(page:Page,from:{x:number;y:number},to=from)=>{const a=await point(page,from.x,from.y),b=await point(page,to.x,to.y);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up()};
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

// The scene editor: a node's card clicked, the graph fitted first so it's in view.
const settled=(locator:Locator)=>locator.evaluate(element=>new Promise<void>(resolve=>{
  let previous='',stable=0;
  const sample=()=>{const box=element.getBoundingClientRect(),at=[box.x,box.y,box.width,box.height].join(',');stable=at===previous?stable+1:0;previous=at;if(stable>=5)resolve();else requestAnimationFrame(sample)};
  sample();
}));
const sceneInspector=(page:Page)=>page.locator('.scene-inspector .inspector-body');
const selectNode=async(page:Page,id:string)=>{
  const graph=tab(page,'Views of the scene','Graph');
  if(await graph.getAttribute('aria-selected')!=='true')await graph.click();
  await page.getByRole('button',{name:'Fit graph'}).click();
  const card=page.locator(`.scene-card[data-node-id="${id}"]`);
  await settled(card);
  const box=(await card.boundingBox())!;
  await card.click({position:{x:box.width/2,y:Math.min(10,box.height/5)}});
  await expect(page.locator(`.node-inspector[data-node="${id}"]`)).toBeVisible();
};

// Each document is written in a pane of each width, by one test or the other.
for(const [wide,narrow] of [[1000,700],[700,1000]] as const)test(`a new map, its place and its scene written from nothing (the map and the scenario at ${wide}px, the place and the scene at ${narrow}px), and the scenario wired to them: no problems anywhere`,async({page})=>{
  await author(page,wide,narrow);
});

async function author(page:Page,wide:number,narrow:number){
  test.setTimeout(240_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:wide,height:820});
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
  const scenario=await original('caerwyn.kmscenario'),townBefore=await original('maps/caerwyn.kmmap');

  // ---- The map, made in the scenario's Files view and listed there ----
  await open(page,'caerwyn.kmscenario');
  await tab(page,'Views of the scenario','Files').click();
  const maps=page.locator('.files-view [data-section="maps"]');
  await maps.getByRole('button',{name:'Add map',exact:true}).click();
  await maps.getByLabel('New map: its title',{exact:true}).fill('Chandler Row');
  await maps.getByRole('button',{name:'Make the map'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).maps).toEqual([...scenario.maps,'chandler-row']);
  await maps.getByRole('button',{name:'Chandler Row',exact:true}).click();
  await expect(page.locator('.file-path')).toHaveText('maps/chandler-row.kmmap');
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');

  // Its own fields, and its size: 32 by 24 of grass, cropped to 16 by 12 after asking.
  await tab(page,'Views of the map','Map').click();
  const own=page.locator('.map-view');
  await write(own,'Description','A crooked row of chandlers\' shops off the market square, smelling of hot tallow.');
  await own.getByLabel('Width',{exact:true}).fill('16');
  await own.getByLabel('Height',{exact:true}).fill('12');
  await own.getByRole('button',{name:'Resize to 16 × 12'}).click();
  await expect(page.getByRole('alertdialog')).toContainText('This makes it 16 × 12, removing 576 tiles');
  await page.getByRole('button',{name:'Crop map'}).click();
  await expect.poll(async()=>(await saved(page,'maps/chandler-row.kmmap')).grid).toEqual(Array.from({length:12},()=>','.repeat(16)));

  // Painted: a new legend entry (a timber floor under a thatch roof) for the shop, and a cobbled street.
  await tab(page,'Views of the map','Paint').click();
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');
  await page.getByRole('button',{name:/^Fit/}).click();await settle(page);
  await page.getByRole('button',{name:'New entry'}).click();
  const entry=dialog(page,'New legend entry');
  await entry.getByLabel('Character',{exact:true}).fill('h');
  await entry.getByLabel('Terrain',{exact:true}).selectOption('floor');
  await entry.getByLabel('Style',{exact:true}).fill('timber');
  await entry.getByLabel('Roof',{exact:true}).fill('thatch');
  await entry.getByLabel('Roof height',{exact:true}).fill('3');
  await entry.getByRole('button',{name:'Add entry'}).click();
  await expect(page.getByRole('button',{name:'Choose paint material'})).toContainText('“h”');
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await stroke(page,{x:4,y:3},{x:9,y:7});
  await page.getByRole('button',{name:/^Paint “\.” Cobbles$/}).click();
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await stroke(page,{x:0,y:8},{x:15,y:9});
  let map=await saved(page,'maps/chandler-row.kmmap');
  expect(map.legend.h).toEqual({terrain:'floor',style:'timber',roof:'thatch',roofHeight:3});
  expect(map.grid).toEqual([...Array.from({length:3},()=>','.repeat(16)),...Array.from({length:5},()=>',,,,hhhhhh,,,,,,'),'.'.repeat(16),'.'.repeat(16),',,,,,,,,,,,,,,,,',',,,,,,,,,,,,,,,,']);

  // A region from a tile selected with Select (V): the shop, playing a new scene made where it's picked, laying the scene's new place.
  await page.getByRole('button',{name:'Select',exact:true}).click();
  await stroke(page,{x:4,y:3});
  const tileInspector=page.locator('.tile-inspector');
  await expect(tileInspector).toContainText('Timber floor under a thatch roof');
  await tileInspector.getByRole('button',{name:'Add region here…'}).click();
  const region=dialog(page,'New region');
  await region.getByLabel('Name',{exact:true}).fill('the chandler\'s shop');
  await region.getByLabel('w',{exact:true}).fill('6');
  await region.getByLabel('h',{exact:true}).fill('5');
  await region.getByRole('button',{name:'Add region'}).click();
  const regionInspector=page.locator('.map-inspector .region-inspector');
  await expect(regionInspector).toHaveAttribute('data-region','the-chandlers-shop');
  await regionInspector.getByRole('button',{name:'Play a scene here'}).click();
  await regionInspector.getByRole('button',{name:'New scene, played here'}).click();
  await regionInspector.getByLabel('New scene: its title',{exact:true}).fill('The Tallow Thief');
  await regionInspector.getByRole('button',{name:'Make the scene'}).click();
  await expect.poll(async()=>(await saved(page,'maps/chandler-row.kmmap')).regions[0]?.sceneId).toBe('the-tallow-thief');
  expect((await saved(page,'caerwyn.kmscenario')).scenes).toEqual([...scenario.scenes,'the-tallow-thief']);
  await regionInspector.getByLabel('Its scene\'s place is laid here').check();
  await regionInspector.getByRole('button',{name:'New place for it'}).click();
  await regionInspector.getByLabel('New place: its title',{exact:true}).fill('The chandler\'s shop');
  await regionInspector.getByRole('button',{name:'Make the place'}).click();
  await expect.poll(async()=>(await saved(page,'scenes/the-tallow-thief.kmscene'))?.place).toBe('the-chandlers-shop');
  expect((await saved(page,'caerwyn.kmscenario')).places).toEqual([...scenario.places,'the-chandlers-shop']);
  // The region selected, its place is shown as soon as it lays it.
  await expect(page.locator('.map-place-note')).toContainText('places/the-chandlers-shop.kmplace');
  await regionInspector.getByLabel('Trigger',{exact:true}).selectOption('enter');
  await write(regionInspector,'Label','Step into the chandler\'s');
  await write(regionInspector,'Description','Maud Tallis\'s shop: candles hanging in bunches, the vat in the back.');
  map=await saved(page,'maps/chandler-row.kmmap');
  expect(map.regions).toEqual([{id:'the-chandlers-shop',name:'the chandler\'s shop',rect:{x:4,y:3,w:6,h:5},sceneId:'the-tallow-thief',worldOrigin:{x:4,y:3},trigger:'enter',label:'Step into the chandler\'s',description:'Maud Tallis\'s shop: candles hanging in bunches, the vat in the back.'}]);
  await page.screenshot({path:`dist/screenshots/new-map-region-${wide}.png`});

  // A way back to the town, from the Exits view: it lands where a way into the town lands by default (nearest its middle).
  await tab(page,'Views of the map','Exits').click();
  await page.locator('.list-view').getByRole('button',{name:'Add exit',exact:true}).click();
  const exit=dialog(page,'New exit');
  await exit.getByLabel('Label',{exact:true}).fill('Back to the town');
  await tile(exit,'From (tile here)',0,8);
  await exit.getByLabel('To map',{exact:true}).selectOption('caerwyn');
  await exit.getByRole('button',{name:'Add exit'}).click();
  map=await saved(page,'maps/chandler-row.kmmap');
  expect(map.exits).toEqual([{at:{x:0,y:8},to:{map:'caerwyn',at:{x:32,y:23}},label:'Back to the town'}]);

  // Two people by the hour: a candle-seller by day, the night-soil man at night.
  await tab(page,'Views of the map','People').click();
  const people=page.locator('.people-view');
  for(const [name,glyph,x,y,times,text] of [['a candle-seller','c',8,8,['morning','afternoon'],'“Tapers, two a penny!”'],['the night-soil man','n',12,9,['night'],'He doesn\'t look up from his cart.']] as const){
    await people.getByRole('button',{name:'Add person',exact:true}).click();
    const person=dialog(page,'New person');
    await person.getByLabel('Name',{exact:true}).fill(name);
    await person.getByLabel('Glyph',{exact:true}).fill(glyph);
    await tile(person,'Stands at (tile)',x,y);
    await person.getByRole('button',{name:'Add',exact:true}).click();
    const card=people.locator('.doc-card');
    await expect(card.locator('h2')).toHaveText(name);
    for(const time of ['morning','afternoon','evening','night','next morning'])if(!(times as readonly string[]).includes(time.replace(' ','-')))await card.getByLabel(time,{exact:true}).uncheck();
    await write(card,'Text',text);
  }
  await tab(page,'Views of the map','People').click();
  await people.getByRole('radio',{name:'night',exact:true}).check();
  await expect(people.locator('.list-pick')).toHaveText([/the night-soil man/]);
  map=await saved(page,'maps/chandler-row.kmmap');
  expect(map.people).toEqual([
    {name:'a candle-seller',times:['morning','afternoon'],glyph:'c',at:{x:8,y:8},text:'“Tapers, two a penny!”'},
    {name:'the night-soil man',times:['night'],glyph:'n',at:{x:12,y:9},text:'He doesn\'t look up from his cart.'},
  ]);

  // ---- The town's way into the row, beside where the row's way back lands ----
  await open(page,'maps/caerwyn.kmmap');
  await tab(page,'Views of the map','Exits').click();
  await page.locator('.list-view').getByRole('button',{name:'Add exit',exact:true}).click();
  const into=dialog(page,'New exit');
  await into.getByLabel('Label',{exact:true}).fill('Into Chandler Row');
  await tile(into,'From (tile here)',33,23);
  await into.getByLabel('To map',{exact:true}).selectOption('chandler-row');
  await into.getByRole('button',{name:'Add exit'}).click();
  const town=await saved(page,'maps/caerwyn.kmmap');
  expect(town.exits.at(-1)).toEqual({at:{x:33,y:23},to:{map:'chandler-row',at:{x:0,y:7}},label:'Into Chandler Row'});
  expect({...town,exits:townBefore.exits}).toEqual(townBefore);

  // ---- The place, in a 700px pane: two areas, three things ----
  await page.setViewportSize({width:narrow,height:860});
  await open(page,'places/the-chandlers-shop.kmplace');
  await tab(page,'Views of the place','Place').click();
  const placeView=page.locator('.place-view');
  await write(placeView,'Description','A narrow shop of tallow and wicks, the counter at the front and the rendering vat behind a curtain.');
  await placeView.getByLabel('Width (feet)',{exact:true}).fill('30');
  await placeView.getByLabel('Depth (feet)',{exact:true}).fill('25');
  await expect(placeView).toContainText('6 × 5 tiles on a map');
  await expect(placeView.locator('[data-section="uses"]')).toContainText('Chandler Row, over the region “the chandler\'s shop”');
  await tab(page,'Views of the place','Areas').click();
  const areas=page.locator('.list-view');
  let card=areas.locator('.doc-card');
  await write(card,'Name','the shop floor');
  await card.getByRole('button',{name:'Rename area id floor'}).click();
  await card.getByLabel('New area id',{exact:true}).fill('shop-floor');
  await card.getByLabel('New area id',{exact:true}).press('Enter');
  await card.getByLabel('w',{exact:true}).fill('20');
  await card.getByLabel('h',{exact:true}).fill('25');
  await areas.getByRole('button',{name:'Add area',exact:true}).click();
  const area=dialog(page,'New area');
  await area.getByLabel('Name',{exact:true}).fill('the back room');
  for(const [label,value] of [['x','20'],['y','0'],['w','10'],['h','25']])await area.getByLabel(label,{exact:true}).fill(value);
  await area.getByRole('button',{name:'Add area'}).click();
  await tab(page,'Views of the place','Things').click();
  const things=page.locator('.list-view');
  for(const [name,inside,x,y,kind,material] of [['the tallow vat','the-back-room',25,12,'object','iron'],['the chandler\'s ledger','shop-floor',6,6,'item','paper'],['a broken shutter','shop-floor',2,22,'feature','wood']] as const){
    await things.getByRole('button',{name:'Add thing',exact:true}).click();
    const thing=dialog(page,'New thing');
    await thing.getByLabel('Name',{exact:true}).fill(name);
    await thing.getByLabel('In',{exact:true}).selectOption(inside);
    await thing.getByLabel('x (feet)',{exact:true}).fill(String(x));
    await thing.getByLabel('y (feet)',{exact:true}).fill(String(y));
    await thing.getByRole('button',{name:'Add thing'}).click();
    card=things.locator('.doc-card');
    await expect(card.locator('h2')).toHaveText(name);
    await card.getByLabel('Kind',{exact:true}).selectOption(kind);
    await card.getByLabel('Material',{exact:true}).selectOption(material);
  }
  await card.getByRole('button',{name:'Add a state',exact:true}).click();
  await card.getByLabel('New: States',{exact:true}).fill('broken');
  await card.getByLabel('New: States',{exact:true}).press('Enter');
  let place=await saved(page,'places/the-chandlers-shop.kmplace');
  expect(place.size).toEqual({w:30,h:25});
  expect(place.areas).toEqual([{id:'shop-floor',name:'the shop floor',rect:{x:0,y:0,w:20,h:25}},{id:'the-back-room',name:'the back room',rect:{x:20,y:0,w:10,h:25}}]);
  expect(place.things).toEqual([
    {id:'the-tallow-vat',name:'the tallow vat',kind:'object',in:'the-back-room',at:[25,12],material:'iron'},
    {id:'the-chandlers-ledger',name:'the chandler\'s ledger',kind:'item',in:'shop-floor',at:[6,6],material:'paper'},
    {id:'a-broken-shutter',name:'a broken shutter',kind:'feature',in:'shop-floor',at:[2,22],material:'wood',states:['broken']},
  ]);
  await tab(page,'Views of the place','Plan').click();
  await expect(page.locator('.place-name')).toHaveText(['the tallow vat','the chandler\'s ledger','a broken shutter']);
  await page.screenshot({path:`dist/screenshots/new-place-${narrow}.png`});

  // ---- The scene laid there, in a 700px pane: its fields, its cast, a discovery whose path's via is a thing of the place, an ending ----
  await open(page,'scenes/the-tallow-thief.kmscene');
  await tab(page,'Views of the scene','Scene').click();
  const scene=page.locator('.scene-view');
  await expect(scene.getByLabel('Place',{exact:true})).toHaveValue('the-chandlers-shop');
  await write(scene,'Description','Someone is skimming the tallow from Maud Tallis\'s vat.');
  await write(scene,'Hook','Maud Tallis swears her vat is lighter every morning, and the watch won\'t listen.');
  await write(scene,'Setting','A narrow shop off the market square at dusk: candles hanging in bunches, the vat steaming in the back.');
  await write(scene,'Premise','Who is skimming the vat, and can the player show it?');
  await write(scene,'Truth','Maud\'s apprentice skims the vat each night and sells the tallow on the wharves.');
  await scene.getByLabel('Time',{exact:true}).selectOption('evening');
  await tab(page,'Views of the scene','Cast').click();
  await page.locator('.cast-view').getByRole('button',{name:'Add person',exact:true}).click();
  const newPerson=page.getByRole('group',{name:'Add a person'});
  await newPerson.getByLabel('New person\'s name').fill('Maud Tallis');
  await newPerson.getByLabel('New person\'s id').fill('maud');
  await newPerson.getByRole('button',{name:'Add person'}).click();
  const maud=page.locator('.cast-detail[data-cast="maud"]');
  for(const field of ['Look','Voice','Attitude','Wants','Why here'])await write(maud,field,`Maud Tallis: ${field.toLowerCase()}.`);
  await maud.getByRole('button',{name:'Add what they know'}).click();
  await page.keyboard.type('Her apprentice comes in late and smells of the wharves.');
  await page.keyboard.press('Tab');
  await selectNode(page,'start');
  await write(sceneInspector(page),'Title','At the chandler\'s door');
  await write(sceneInspector(page),'Opening','Maud waves the player in out of the dusk: the vat is down again.');
  await selectNode(page,'discovery');
  await write(sceneInspector(page),'Title','The vat was skimmed');
  await write(sceneInspector(page),'Revelation','Someone takes tallow from the vat at night, after the shop is shut.');
  await write(sceneInspector(page),'How to play it','Let the player look at the vat and ask Maud anything.');
  for(const [index,via,clue,earn,strength] of [[0,'maud','The vat is lower every morning.','Free: she\'s eager to tell.','Strong'],[1,'','Scrape marks inside the rim, fresh tallow on the floor.','Looking closely at the vat.','Proof']] as const){
    await sceneInspector(page).getByRole('button',{name:'Add path',exact:true}).click();
    const item=sceneInspector(page).locator(`[data-field="paths.${index}"]`);
    if(via)await item.getByLabel('Via',{exact:true}).fill(via);
    // The second's via picked from the place's things.
    else await item.getByLabel('Pick via',{exact:true}).selectOption('the tallow vat');
    await write(item,'Clue',clue);
    await write(item,'Earn',earn);
    await item.getByRole('radio',{name:strength}).check();
  }
  await expect(sceneInspector(page).locator('[data-field="paths.1"]').getByLabel('Via',{exact:true})).toHaveValue('the tallow vat');
  await selectNode(page,'ending');
  await write(sceneInspector(page),'Title','Maud names the thief');
  await write(sceneInspector(page),'What\'s true','The apprentice is caught with a pail of tallow.');
  await write(sceneInspector(page),'Closing','Maud takes the apprentice by the ear and the player out for a drink.');
  await selectNode(page,'discovery');
  await sceneInspector(page).getByRole('button',{name:'Add route to…'}).click();
  const ending=page.locator('.scene-card[data-node-id="ending"]');
  await settled(ending);
  await ending.click({position:{x:40,y:10}});
  const route=page.locator('.scene-inspector .route-card[data-route-id="to-ending"]');
  await write(route,'Condition','The player shows Maud the scrape marks, and she knows whose they are.');
  await route.getByRole('button',{name:'Add beat',exact:true}).click();
  await route.locator('.add-picker').getByRole('button',{name:/^The vat was skimmed/}).first().click();
  await expect(tab(page,'Views of the scene','Problems')).toHaveAttribute('aria-label','Problems (0)');
  await expect(page.locator('.problems-link')).toHaveText(/No problems$/);

  // ---- Maud starts in the shop: the place's People view offers the scene's cast ----
  await open(page,'places/the-chandlers-shop.kmplace');
  await tab(page,'Views of the place','People').click();
  await page.locator('.list-view').getByRole('button',{name:'Start someone here',exact:true}).click();
  const start=dialog(page,'Someone starts here');
  await start.getByLabel('Who',{exact:true}).selectOption('maud');
  await start.getByLabel('In',{exact:true}).selectOption('shop-floor');
  await start.getByLabel('x (feet)',{exact:true}).fill('10');
  await start.getByLabel('y (feet)',{exact:true}).fill('12');
  await start.getByRole('button',{name:'Start them here'}).click();
  await write(page.locator('.list-view .doc-card'),'Note','Behind the counter, wiping her hands.');
  await expect.poll(async()=>(await saved(page,'places/the-chandlers-shop.kmplace')).people.maud?.note).toBe('Behind the counter, wiping her hands.');
  // Someone new of the scene's cast, made where their start is picked: the apprentice, in the back room.
  await page.locator('.list-view').getByRole('button',{name:'Start someone here',exact:true}).click();
  const apprentice=dialog(page,'Someone starts here');
  await apprentice.getByLabel('Who',{exact:true}).selectOption({label:'Someone new, of the scene\'s cast…'});
  await apprentice.getByLabel('Their name',{exact:true}).fill('Jory Wick');
  await apprentice.getByLabel('Their id',{exact:true}).fill('jory');
  await apprentice.getByLabel('In',{exact:true}).selectOption('the-back-room');
  await apprentice.getByLabel('x (feet)',{exact:true}).fill('24');
  await apprentice.getByLabel('y (feet)',{exact:true}).fill('20');
  await apprentice.getByRole('button',{name:'Start them here'}).click();
  await expect.poll(async()=>(await saved(page,'scenes/the-tallow-thief.kmscene')).cast.map((member:any)=>member.id)).toEqual(['maud','jory']);
  place=await saved(page,'places/the-chandlers-shop.kmplace');
  expect(place.people).toEqual({maud:{in:'shop-floor',at:[10,12],note:'Behind the counter, wiping her hands.'},jory:{in:'the-back-room',at:[24,20]}});
  // His card, written in the scene: the problems named what it needed.
  await open(page,'scenes/the-tallow-thief.kmscene');
  await expect(page.locator('.problems-link')).toHaveText(/5 problems/);
  await tab(page,'Views of the scene','Cast').click();
  await page.locator('.cast-view').getByRole('button',{name:/^Jory Wick/}).click();
  const jory=page.locator('.cast-detail[data-cast="jory"]');
  for(const field of ['Look','Voice','Attitude','Wants','Why here'])await write(jory,field,`Jory Wick: ${field.toLowerCase()}.`);
  await expect(tab(page,'Views of the scene','Problems')).toHaveAttribute('aria-label','Problems (0)');
  await open(page,'places/the-chandlers-shop.kmplace');
  // The thing's card says where the scene names it.
  await tab(page,'Views of the place','Things').click();
  await page.locator('.list-view').getByRole('button',{name:/^the tallow vat/}).click();
  await expect(page.locator('.list-view .doc-card [data-field="namedBy"]')).toContainText('The Tallow Thief: The vat was skimmed: path 2');
  await expect(tab(page,'Views of the place','Problems')).toHaveAttribute('aria-label','Problems (0)');

  // ---- The scenario wired: the ending's next; the start moved onto the row and back ----
  await page.setViewportSize({width:wide,height:820});
  await open(page,'caerwyn.kmscenario');
  await tab(page,'Views of the scenario','Diagram').click();
  const thief=page.locator('.scenario-card[data-card="scene:the-tallow-thief"]');
  await page.getByRole('button',{name:'Fit the diagram'}).click();
  await settled(thief);
  await thief.locator('h3').click();
  await page.locator('.scenario-inspector').getByLabel('Maud names the thief: next scene',{exact:true}).selectOption('scene:drowned-rat');
  await expect.poll(async()=>(await saved(page,'scenes/the-tallow-thief.kmscene')).nodes.find((node:any)=>node.id==='ending').data.next).toBe('drowned-rat');
  await open(page,'maps/chandler-row.kmmap');
  await tab(page,'Views of the map','Paint').click();
  await page.getByRole('button',{name:/^Fit/}).click();await settle(page);
  await page.getByRole('button',{name:'Select',exact:true}).click();
  await stroke(page,{x:2,y:8});
  await page.locator('.tile-inspector').getByRole('button',{name:'Start the story here'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).start).toEqual({day:1,time:'morning',map:'chandler-row',at:[2,8]});
  await expect(page.getByRole('button',{name:'The story\'s start at 2, 8'})).toBeVisible();
  await open(page,'caerwyn.kmscenario');
  await tab(page,'Views of the scenario','Scenario').click();
  const own2=page.locator('.scenario-view');
  await own2.getByLabel('Start map',{exact:true}).selectOption('caerwyn');
  await tile(own2,'Start tile',42,9);
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).start).toEqual(scenario.start);

  // ---- No problems anywhere, and the scenario lists what was made, nothing else of it changed ----
  await expect(tab(page,'Views of the scenario','Problems')).toHaveAttribute('aria-label','Problems (0)');
  const after=await saved(page,'caerwyn.kmscenario');
  expect(after).toEqual({...scenario,scenes:[...scenario.scenes,'the-tallow-thief'],places:[...scenario.places,'the-chandlers-shop'],maps:[...scenario.maps,'chandler-row']});
  for(const file of ['maps/chandler-row.kmmap','maps/caerwyn.kmmap']){
    await open(page,file);
    await expect(tab(page,'Views of the map','Problems')).toHaveAttribute('aria-label','Problems (0)');
  }
  await tab(page,'Views of the map','Problems').click();
  await page.screenshot({path:`dist/screenshots/new-map-problems-${wide}.png`});
  expect(errors).toEqual([]);

  // The files as written, for the campaign check and the game's loaders (KINGMAKER_AUTHORED).
  const out=process.env.KINGMAKER_AUTHORED;
  if(out&&wide===1000){
    for(const file of ['caerwyn.kmscenario','maps/caerwyn.kmmap','maps/chandler-row.kmmap','places/the-chandlers-shop.kmplace','scenes/the-tallow-thief.kmscene']){
      await mkdir(path.dirname(path.join(out,file)),{recursive:true});
      await writeFile(path.join(out,file),(await savedText(page,file))!);
    }
  }
}

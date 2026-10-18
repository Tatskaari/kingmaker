import {test,expect,type Page,type Locator} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// The coverage tables' rows the other journeys don't reach, each through its control in the scenario, map
// and place editors (the plugin's README, "Every value, and where it's edited"): ids renamed (with what
// names them following), the quest renamed across the scenes, the purse, the backstory's docs, the talk
// template made where it's picked, the layout forgotten; a legend character and a region's id renamed, a
// region's optional parts, the map's start set from its Map view, people by the hour on the painter; a
// thing's id, armour, hit points, quantity and holder, an area renamed, a bare spot of floor, the plan's
// names. Every step asserts the files as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const text=(path:string)=>readFile(new URL(path,CAMPAIGN),'utf8');
const original=async(path:string)=>JSON.parse(await text(path));
const savedText=(page:Page,path:string)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path:string)=>JSON.parse(await savedText(page,path));
const open=async(page:Page,path:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  await expect(page.locator('.file-path')).toHaveText(path);
};
const tab=(page:Page,list:string,name:string)=>page.getByRole('tablist',{name:list}).getByRole('tab',{name:new RegExp(`^${name}`)});
const write=async(within:Locator,label:string,value:string)=>{const field=within.getByLabel(label,{exact:true});await field.fill(value);await field.blur()};
const rename=async(within:Locator,label:string,from:string,to:string)=>{
  await within.getByRole('button',{name:`Rename ${label.toLowerCase()} ${from}`}).click();
  await within.getByLabel(`New ${label.toLowerCase()}`,{exact:true}).fill(to);
  await within.getByLabel(`New ${label.toLowerCase()}`,{exact:true}).press('Enter');
};

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
});

test('the scenario: its id renamed, a quest renamed in every scene naming it, the purse, the backstory\'s docs, a talk template made where it\'s picked, the layout forgotten',async({page})=>{
  const scenario=await original('caerwyn.kmscenario');
  await open(page,'caerwyn.kmscenario');
  await tab(page,'Views of the scenario','Scenario').click();
  const own=page.locator('.scenario-view');
  // The id: renamed in the file, the problems saying until the file's renamed to match; and back.
  await rename(own,'Scenario id','caerwyn','caerwyn-ii');
  expect((await saved(page,'caerwyn.kmscenario')).id).toBe('caerwyn-ii');
  await expect(page.locator('.problems-link')).toHaveText(/1 problem/);
  await rename(own,'Scenario id','caerwyn-ii','caerwyn');
  await expect(page.locator('.problems-link')).toHaveText(/No problems/);
  // The purse: a coin added and written, moved up, and removed.
  const purse=own.locator('[data-section="startingPurse"]');
  await purse.getByRole('button',{name:'Add coin',exact:true}).click();
  const coins=scenario.startingPurse.length;
  const coin=purse.locator(`[data-field="startingPurse.${coins}"]`);
  await write(coin,'Coin','a brass token');
  await write(coin,'Coin description','A chandler\'s token, good for a candle.');
  await coin.getByRole('button',{name:`Move Coin ${coins+1} up`}).click();
  expect((await saved(page,'caerwyn.kmscenario')).startingPurse.map((c:any)=>c.name)).toEqual([...scenario.startingPurse.slice(0,-1).map((c:any)=>c.name),'a brass token',scenario.startingPurse.at(-1).name]);
  await purse.getByRole('button',{name:`Remove coin ${coins}`}).click();
  expect((await saved(page,'caerwyn.kmscenario')).startingPurse).toEqual(scenario.startingPurse);
  // The backstory's docs: one not canon added from the lore and taken out again; a place doc added and removed.
  const backstory=own.locator('[data-section="creation"]');
  await backstory.locator('[data-field="creation.notCanon"]').getByRole('button',{name:'Add a doc',exact:true}).click();
  await backstory.locator('[data-field="creation.notCanon"] .add-picker').getByRole('button',{name:/^Centennial Assembly/}).first().click();
  let doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.creation.notCanon).toEqual([...scenario.creation.notCanon,'World/Centennial Assembly.md']);
  const added=doc.creation.notCanon.at(-1);
  await backstory.getByRole('button',{name:`Remove ${added}`}).click();
  await backstory.locator('[data-field="creation.places"]').getByRole('button',{name:'Add a place doc',exact:true}).click();
  await backstory.locator('[data-field="creation.places"] .add-picker').getByRole('button',{name:/^Royal Palace/}).first().click();
  doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.creation.places.at(-1)).toEqual({doc:'World/Royal Palace.md',words:'royal palace'});
  await backstory.getByRole('button',{name:`Remove place doc ${doc.creation.places.length}`}).click();
  expect((await saved(page,'caerwyn.kmscenario')).creation).toEqual(scenario.creation);
  // A quest renamed: its key in the scenario, and every effect naming it in the Rat's and the Heron's files; undone in one step.
  await tab(page,'Views of the scenario','Quests').click();
  const ledger=page.locator('.quests-view [data-field="quests.heron-ledger"]');
  await expect(ledger).toContainText('Named by');
  await rename(ledger,'Quest key','heron-ledger','the-ledger');
  await expect.poll(async()=>Object.keys((await saved(page,'caerwyn.kmscenario')).quests)).toEqual(['hanged-clerk','purveyors-man','the-ledger']);
  for(const scene of ['drowned-rat','heron-warehouse']){
    const before=await text(`scenes/${scene}.kmscene`);
    await expect.poll(()=>savedText(page,`scenes/${scene}.kmscene`)).toBe(before.replaceAll('"quest": "heron-ledger"','"quest": "the-ledger"'));
    expect(before.includes('"quest": "heron-ledger"')).toBe(true);
  }
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(()=>savedText(page,'scenes/drowned-rat.kmscene')).toBe(await text('scenes/drowned-rat.kmscene'));
  expect(await savedText(page,'scenes/heron-warehouse.kmscene')).toBe(await text('scenes/heron-warehouse.kmscene'));
  // The talk template: a new scene made where it's picked, the talk and not one of the story's.
  await tab(page,'Views of the scenario','Files').click();
  const talk=page.locator('.files-view [data-section="talk"]');
  await talk.getByRole('button',{name:'New scene, the talk template'}).click();
  await talk.getByLabel('New scene: its title',{exact:true}).fill('A word on the road');
  await talk.getByRole('button',{name:'Make the scene'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).talk).toBe('a-word-on-the-road');
  expect((await saved(page,'caerwyn.kmscenario')).scenes).toEqual(scenario.scenes);
  // The layout: a card dragged, then forgotten after asking.
  await tab(page,'Views of the scenario','Diagram').click();
  await page.getByRole('button',{name:'Fit the diagram'}).click();
  const palace=page.locator('.scenario-card[data-card="map:palace"]');
  const box=(await palace.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+50,{steps:6});await page.mouse.up();
  await expect.poll(async()=>Object.keys((await saved(page,'caerwyn.kmscenario')).layout??{})).toEqual(['maps/palace']);
  await page.getByRole('button',{name:'Forget the layout'}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Forget the layout'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).layout).toBeUndefined();
});

test('a map: a legend character and a region\'s id renamed, a region\'s optional parts, the start set from the Map view, people by the hour on the painter',async({page})=>{
  const palace=await original('maps/palace.kmmap');
  await open(page,'maps/palace.kmmap');
  await expect(page.locator('.km-map[data-campaign="read"]')).toBeVisible();
  // The legend's "f" renamed "F": the entry where it was, every tile of it rewritten.
  await tab(page,'Views of the map','Legend').click();
  await page.locator('.list-view').getByRole('button',{name:/^f /}).click();
  const entry=page.locator('.list-view .doc-card');
  await rename(entry,'Character','f','F');
  let doc=await saved(page,'maps/palace.kmmap');
  expect(Object.keys(doc.legend)).toEqual(Object.keys(palace.legend).map(ch=>ch==='f'?'F':ch));
  expect(doc.grid).toEqual(palace.grid.map((row:string)=>row.replaceAll('f','F')));
  await page.getByRole('button',{name:'Undo map edit'}).click();
  expect(await savedText(page,'maps/palace.kmmap')).toBe(await text('maps/palace.kmmap'));
  // A region's id renamed (and back), and the long gallery's optional parts added and taken out.
  await tab(page,'Views of the map','Regions').click();
  const region=page.locator('.list-view .doc-card');
  await rename(region,'Region id','dressing-room','kings-dressing-room');
  expect((await saved(page,'maps/palace.kmmap')).regions[0].id).toBe('kings-dressing-room');
  await rename(region,'Region id','kings-dressing-room','dressing-room');
  await page.locator('.list-view').getByRole('button',{name:/^the long gallery/}).click();
  await expect(region.locator('h2')).toHaveText('the long gallery');
  await region.getByRole('button',{name:'Shut outside its scene\'s time',exact:true}).click();
  await write(region,'Shut','The gallery is shut for the Assembly.');
  await region.getByLabel('Opens for',{exact:true}).selectOption('kings-morning');
  await region.getByRole('button',{name:'Locked after its scene',exact:true}).click();
  await write(region,'Locked after','The portraits watch you out.');
  await region.getByRole('button',{name:'What its locked doors say',exact:true}).click();
  await write(region,'Locked','Locked, and a footman shakes his head.');
  await region.getByRole('button',{name:'The outside of a scene\'s place',exact:true}).click();
  await region.getByLabel('Exterior of',{exact:true}).selectOption('kings-morning');
  doc=await saved(page,'maps/palace.kmmap');
  expect(doc.regions[1]).toEqual({...palace.regions[1],shut:'The gallery is shut for the Assembly.',opensFor:'kings-morning',lockedAfter:'The portraits watch you out.',exteriorOf:'kings-morning',locked:'Locked, and a footman shakes his head.',description:palace.regions[1].description});
  expect(Object.keys(doc.regions[1])).toEqual(['id','name','rect','shut','opensFor','lockedAfter','exteriorOf','locked','description']);
  for(const section of ['Remove shut outside its scene\'s time','Remove locked after its scene','Remove the outside of a scene\'s place','Remove its locked doors'])await region.getByRole('button',{name:section,exact:true}).click();
  expect(await savedText(page,'maps/palace.kmmap')).toBe(await text('maps/palace.kmmap'));
  // The story's start set on this map from its Map view, then undone.
  await tab(page,'Views of the map','Map').click();
  const start=page.locator('.map-view [data-section="start"]');
  await start.getByLabel('x',{exact:true}).fill('3');
  await start.getByLabel('y',{exact:true}).fill('5');
  await start.getByRole('button',{name:'Start the story on this map'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).start).toEqual({day:1,time:'morning',map:'palace',at:[3,5]});
  await page.getByRole('button',{name:'Undo map edit'}).click();
  await expect.poll(()=>savedText(page,'caerwyn.kmscenario')).toBe(await text('caerwyn.kmscenario'));
  // People by the hour, on the town's painter: only those about at night.
  await open(page,'maps/caerwyn.kmmap');
  const town=await original('maps/caerwyn.kmmap');
  await expect(page.locator('.map-marker-person')).toHaveCount(town.people.length);
  await page.getByLabel('People about at',{exact:true}).selectOption('night');
  await expect(page.locator('.map-marker-person')).toHaveCount(town.people.filter((p:any)=>p.times.includes('night')).length);
});

test('a place: a thing\'s id, armour, hit points, quantity and holder; an area renamed with what\'s in it; a bare spot of floor; the plan\'s names',async({page})=>{
  const path='places/granary-yard.kmplace',yard=await original(path);
  await open(page,path);
  await expect(page.locator('.km-place[data-campaign="read"]')).toBeVisible();
  // The plan names its things; Names turns them off.
  await expect(page.locator('.place-name')).toHaveCount(yard.things.filter((t:any)=>t.at).length+Object.keys(yard.people).length);
  await page.getByLabel('Names',{exact:true}).uncheck();
  await expect(page.locator('.place-name')).toHaveCount(0);
  // A bare spot of floor (outside every area): what can be added there.
  const spot=await page.locator('svg.place-grid').evaluate(svg=>{const m=(svg as SVGSVGElement).getScreenCTM()!;return {x:m.a*45+m.e,y:m.d*4+m.f}});
  await page.mouse.click(spot.x,spot.y);
  await expect(page.locator('.spot-inspector')).toContainText('On the floor, in no area');
  await expect(page.locator('.spot-inspector').getByRole('button',{name:'Add an area here…'})).toBeVisible();
  // Prout's satchel: renamed, its own armour and hit points, a stack of one, then carried by Kell (no spot of its own).
  await tab(page,'Views of the place','Things').click();
  await page.locator('.list-view').getByRole('button',{name:/^Prout's satchel/}).click();
  const thing=page.locator('.list-view .doc-card');
  await rename(thing,'Thing id','satchel','prouts-satchel');
  await thing.getByRole('button',{name:'Its own armour and hit points'}).click();
  await write(thing,'AC','12');
  await write(thing,'HP','5');
  await write(thing,'How many','1');
  await thing.getByLabel('In',{exact:true}).selectOption('kell');
  await thing.getByRole('button',{name:'No spot of its own'}).click();
  let doc=await saved(page,path);
  const satchel=doc.things.find((t:any)=>t.id==='prouts-satchel');
  expect(satchel).toEqual({...yard.things.find((t:any)=>t.id==='satchel'),id:'prouts-satchel',in:'kell',at:undefined,ac:12,hp:5,quantity:1});
  // Its keys in the format's order: the new ones where the format puts them.
  const ORDER=['id','name','kind','in','at','size','material','tags','states','description','ac','hp','quantity'];
  expect(Object.keys(satchel)).toEqual(ORDER.filter(key=>key in satchel));
  await thing.getByRole('button',{name:'Remove its own armour and hit points'}).click();
  expect(Object.keys((await saved(page,path)).things.find((t:any)=>t.id==='prouts-satchel'))).not.toContain('ac');
  // The lane renamed: what's in it follows.
  await tab(page,'Views of the place','Areas').click();
  await page.locator('.list-view').getByRole('button',{name:/^the lane/}).click();
  await rename(page.locator('.list-view .doc-card'),'Area id','lane','the-lane');
  doc=await saved(page,path);
  expect(doc.areas.map((a:any)=>a.id)).toEqual(yard.areas.map((a:any)=>a.id==='lane'?'the-lane':a.id));
  expect(doc.things.filter((t:any)=>t.in==='the-lane').map((t:any)=>t.id)).toEqual(yard.things.filter((t:any)=>t.in==='lane').map((t:any)=>t.id));
  await expect(page.locator('.problems-link')).toHaveText(/No problems/);
});

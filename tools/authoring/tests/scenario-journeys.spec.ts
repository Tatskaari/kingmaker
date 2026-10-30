import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// The scenario editor on the game's own campaign: the story's flow drawn from the files that own it,
// and edited there (a scene's ending in the scene's file, a region and a way out in the map's, the
// start and the lists in the scenario's). Every journey asserts the files as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const text=(path:string)=>readFile(new URL(path,CAMPAIGN),'utf8');
const original=async(path:string)=>JSON.parse(await text(path));
const savedText=(page:Page,path:string)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path:string)=>JSON.parse(await savedText(page,path));
const files=(page:Page)=>page.evaluate(()=>({...(window as any).__kingmakerHarness.files}) as Record<string,string>);
const card=(page:Page,id:string)=>page.locator(`.scenario-card[data-card="${id}"]`);
const inspector=(page:Page)=>page.locator('.scenario-inspector .inspector-body');
const view=(page:Page,name:string)=>page.getByRole('tablist',{name:'Views of the scenario'}).getByRole('tab',{name:new RegExp(`^${name}`)});
/** Whether a card is wholly in the diagram's view. */
const inView=async(page:Page,id:string)=>{const c=await card(page,id).boundingBox(),d=await page.locator('.react-flow').first().boundingBox();return !!c&&!!d&&c.x>=d.x&&c.y>=d.y&&c.x+c.width<=d.x+d.width&&c.y+c.height<=d.y+d.height};
const openScenario=async(page:Page)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption('caerwyn.kmscenario');
  await expect(page.locator('.file-path')).toHaveText('caerwyn.kmscenario');
  await expect(card(page,'map:caerwyn')).toBeVisible();
  await expect(page.getByRole('tab',{name:/^Problems \(\d+\)$/})).toBeVisible();
};
const node=(scene:any,id:string)=>scene.nodes.find((n:any)=>n.id===id);
/** Once an element has stopped moving (a diagram drawn again, or moving to a card), five frames alike. */
const settled=(locator:ReturnType<Page['locator']>)=>locator.evaluate(element=>new Promise<void>(resolve=>{
  let previous='',stable=0;
  const sample=()=>{const box=element.getBoundingClientRect(),at=[box.x,box.y,box.width,box.height].join(',');stable=at===previous?stable+1:0;previous=at;if(stable>=5)resolve();else requestAnimationFrame(sample)};
  sample();
}));

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
});

test('the scenario opens as the story\'s flow, drawn from the files that own it, with no problems, and opening saves nothing',async({page})=>{
  const before=await files(page);
  await openScenario(page);
  await expect(page.locator('.scenario-card')).toHaveCount(15);
  await expect(page.locator('.react-flow__edge')).toHaveCount(38);
  await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
  // Each ending a port of its scene, each region that plays a scene and each way out a port of its map.
  await expect(card(page,'scene:drowned-rat').locator('.scenario-port')).toHaveCount(6);
  await expect(card(page,'map:caerwyn').locator('.scenario-port')).toHaveText([/the yard behind the King's Granary/,/the tally loft/,/the downriver end of the wharves/,/Through the palace gate/,/The Drowned Rat's door/,/Along the wharf to the Heron.*4 tiles/]);
  await expect(card(page,'start').locator('.scenario-port')).toHaveText([/Starts on The King's Road.*at \(12, 12\)/,/First lead.*kings-road/]);
  await page.screenshot({path:'dist/screenshots/scenario.png'});
  expect(await files(page)).toEqual(before);
  expect(await savedText(page,'caerwyn.kmscenario')).toBe(await text('caerwyn.kmscenario'));
});

test('the scenario\'s wiring edited in its owning file: an ending\'s next in its scene, a way out and a region in its map; undo puts each back',async({page})=>{
  await openScenario(page);
  const clerk=await original('scenes/hanged-clerk.kmscene'),town=await original('maps/caerwyn.kmmap');
  // The clerk's failed ending goes on to the Drowned Rat: set in the scene's file, where the ending is.
  await card(page,'scene:hanged-clerk').locator('h3').click();
  await inspector(page).getByLabel('Failed: next scene',{exact:true}).selectOption('scene:drowned-rat');
  await expect.poll(async()=>node(await saved(page,'scenes/hanged-clerk.kmscene'),'failed').data.next).toBe('drowned-rat');
  const scene=await saved(page,'scenes/hanged-clerk.kmscene');
  expect(Object.keys(node(scene,'failed').data)).toEqual(['kind','title','description','closing','result','exitKind','next','effects','lore'].filter(k=>k in node(scene,'failed').data));
  expect({...scene,nodes:scene.nodes.map((n:any)=>n.id==='failed'?{...n,data:{...n.data,next:undefined}}:n)}).toEqual({...clerk,nodes:clerk.nodes.map((n:any)=>n.id==='failed'?{...n,data:{...n.data,next:undefined}}:n)});
  await expect(page.locator('.react-flow__edge')).toHaveCount(39);
  // Drawn: the same ending dragged on to the wharves after dark instead.
  const from=card(page,'scene:hanged-clerk').locator('[data-port="ending:failed"] .react-flow__handle');
  const to=card(page,'scene:wharf-night').locator('.react-flow__handle.target');
  const a=(await from.boundingBox())!,b=(await to.boundingBox())!;
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.up();
  await expect.poll(async()=>node(await saved(page,'scenes/hanged-clerk.kmscene'),'failed').data.next).toBe('wharf-night');
  // The town's palace gate leads to the Heron, landing just inside its way back to the town.
  await card(page,'map:caerwyn').locator('h3').click();
  await inspector(page).getByLabel('Through the palace gate: to',{exact:true}).selectOption('map:heron');
  await expect.poll(async()=>(await saved(page,'maps/caerwyn.kmmap')).exits[0].to.map).toBe('heron');
  let map=await saved(page,'maps/caerwyn.kmmap');
  const heron=await original('maps/heron.kmmap'),back=heron.exits.find((e:any)=>e.to.map==='caerwyn').at;
  expect(Math.max(Math.abs(map.exits[0].to.at.x-back.x),Math.abs(map.exits[0].to.at.y-back.y))).toBe(1);
  expect({...map,exits:town.exits}).toEqual(town);
  // A region set to play a scene, with neither a place laid nor a trigger: the campaign check says so, at the map.
  await inspector(page).getByLabel('the cart shed: plays',{exact:true}).selectOption('scene:drowned-rat');
  await expect.poll(async()=>(await saved(page,'maps/caerwyn.kmmap')).regions.find((r:any)=>r.id==='cart-shed').sceneId).toBe('drowned-rat');
  await expect(page.getByRole('tab',{name:'Problems (1)'})).toBeVisible();
  await page.getByRole('tab',{name:'Problems (1)'}).click();
  await expect(page.locator('.problems-view .problem')).toHaveText([/region cart-shed names the scene drowned-rat, but neither lays its place there \(worldOrigin\) nor opens it \(trigger\).*maps\/caerwyn\.kmmap/]);
  map=await saved(page,'maps/caerwyn.kmmap');
  expect(Object.keys(map.regions.find((r:any)=>r.id==='cart-shed'))).toEqual(['id','name','rect','sceneId','description']);
  // A way out selected (its port clicked: its edge is selected too) and deleted takes the destination away in its owner, after asking: the Rat's first ending ends the story.
  await view(page,'Diagram').click();
  await card(page,'scene:drowned-rat').locator('[data-port="ending:hobb-talks"]').click();
  await expect(card(page,'scene:drowned-rat').locator('[data-port="ending:hobb-talks"]')).toHaveClass(/chosen/);
  await expect(page.locator('.react-flow__edge.selected')).toHaveAttribute('aria-label',/^scene:drowned-rat What Big Hobb knows to scene:wharf-night/);
  await expect(inspector(page).getByLabel('What Big Hobb knows: next scene',{exact:true})).toHaveValue('scene:wharf-night');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alertdialog')).toContainText('won\'t go on to a scene');
  await page.getByRole('button',{name:'End the story here'}).click();
  await expect.poll(async()=>node(await saved(page,'scenes/drowned-rat.kmscene'),'hobb-talks').data.next).toBeUndefined();
  // Undo, a step at a time, puts each file back as it was, byte for byte.
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(()=>savedText(page,'scenes/drowned-rat.kmscene')).toBe(await text('scenes/drowned-rat.kmscene'));
  await expect.poll(()=>savedText(page,'scenes/hanged-clerk.kmscene')).toBe(await text('scenes/hanged-clerk.kmscene'));
  await expect.poll(()=>savedText(page,'maps/caerwyn.kmmap')).toBe(await text('maps/caerwyn.kmmap'));
  await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
  expect(await savedText(page,'caerwyn.kmscenario')).toBe(await text('caerwyn.kmscenario'));
});

test('the scenario\'s own fields: the start, the story\'s order, a new map made and listed, the purse and a quest; a card dragged keeps its place',async({page})=>{
  await openScenario(page);
  const scenario=await original('caerwyn.kmscenario');
  await view(page,'Scenario').click();
  const own=page.locator('.scenario-view');
  // The start: the time of day, and the map it's on (the tile, a standable one just inside the palace's way to the town).
  await own.getByLabel('Time',{exact:true}).selectOption('afternoon');
  await own.getByLabel('Start map',{exact:true}).selectOption('palace');
  let doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.start.time).toBe('afternoon');
  expect(doc.start.map).toBe('palace');
  expect(Object.keys(doc.start)).toEqual(['day','time','map','at']);
  // The story's order: the wharves after dark before the Rat.
  await view(page,'Files').click();
  const listed=page.locator('.files-view');
  await listed.getByRole('button',{name:'Move Scene wharf-night up'}).click();
  doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.scenes).toEqual(['kings-road','toll-bridge','kings-thanks','hanged-clerk','caerwyn-afternoon','wharf-night','drowned-rat','heron-warehouse','kings-morning']);
  // A new map: made in maps/ from the default legend, and listed.
  const maps=listed.locator('[data-section="maps"]');
  await maps.getByRole('button',{name:'Add map',exact:true}).click();
  await maps.getByLabel('New map: its title',{exact:true}).fill('The Cooperage');
  await maps.getByRole('button',{name:'Make the map'}).click();
  await expect(maps.locator('[data-field="maps.5"]')).toContainText('The Cooperage');
  doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.maps).toEqual([...scenario.maps,'the-cooperage']);
  const made=await saved(page,'maps/the-cooperage.kmmap');
  expect([made.id,made.title,made.grid.length,Object.keys(made.legend).length]).toEqual(['the-cooperage','The Cooperage',24,20]);
  // A new scene: made in scenes/ as the format's skeleton and listed last in the story; its card, at the end of the story's row past the diagram's edge, is brought into view.
  const scenes=listed.locator('[data-section="scenes"]');
  await scenes.getByRole('button',{name:'Add scene',exact:true}).click();
  await scenes.getByLabel('New scene: its title',{exact:true}).fill('The Lamplighter');
  await scenes.getByRole('button',{name:'Make the scene'}).click();
  await expect.poll(async()=>(await saved(page,'caerwyn.kmscenario')).scenes.at(-1)).toBe('the-lamplighter');
  expect((await saved(page,'scenes/the-lamplighter.kmscene')).nodes.map((n:any)=>n.id)).toEqual(['start','discovery','ending']);
  // Back on the diagram, the new cards are there, the scene's (at the end of the story's row, past the diagram's edge) brought into view.
  await view(page,'Diagram').click();
  await expect(card(page,'map:the-cooperage')).toBeVisible();
  await expect(card(page,'scene:the-lamplighter')).toBeVisible();
  await expect.poll(()=>inView(page,'scene:the-lamplighter')).toBe(true);
  await expect(card(page,'start').locator('.scenario-port').first()).toContainText('Starts on The Palace');
  // The purse and a quest.
  await view(page,'Scenario').click();
  const purse=page.locator('.scenario-view [data-section="startingPurse"]');
  await purse.getByLabel('How many',{exact:true}).first().fill('3');
  await view(page,'Quests').click();
  const quests=page.locator('.quests-view');
  await quests.getByRole('button',{name:'Add quest',exact:true}).click();
  await quests.getByLabel('New quest\'s title').fill('The Cooper\'s Debt');
  await quests.getByRole('button',{name:'Add quest'}).click();
  doc=await saved(page,'caerwyn.kmscenario');
  expect(doc.startingPurse[0]).toEqual({...scenario.startingPurse[0],quantity:3});
  expect(doc.quests).toEqual({...scenario.quests,'the-coopers-debt':'The Cooper\'s Debt'});
  // A card dragged on the diagram keeps its place, in the scenario's layout.
  await view(page,'Diagram').click();
  const palace=card(page,'map:palace');
  await settled(palace);
  const box=(await palace.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width/2+120,box.y+80,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Object.keys((await saved(page,'caerwyn.kmscenario')).layout??{})).toEqual(['maps/palace']);
  doc=await saved(page,'caerwyn.kmscenario');
  expect(Object.keys(doc).at(-1)).toBe('layout');
  expect(Number.isInteger(doc.layout['maps/palace'].x)&&Number.isInteger(doc.layout['maps/palace'].y)).toBe(true);
  // Opened again, the card is where it was put.
  await page.reload();
  await openScenario(page);
  const again=(await card(page,'map:palace').boundingBox())!;
  expect(again.width).toBeGreaterThan(0);
  expect((await saved(page,'caerwyn.kmscenario')).layout).toEqual(doc.layout);
});

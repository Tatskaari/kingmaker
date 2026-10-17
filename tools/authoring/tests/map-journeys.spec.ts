import {test,expect,type Page} from '@playwright/test';
import {harbourMap} from '../src/map-model';
const path='Maps/Test map.kmmap';
const blank={format:'kingmaker',version:1,kind:'map',id:'test-map',title:'The harbour',description:'',nodes:[{id:'entry',type:'story',position:{x:0,y:0},data:{kind:'start',title:'From town',description:'',lore:[]}}],edges:[],lore:[],source:{kept:true}};
const saved=(page:Page)=>page.evaluate(path=>JSON.parse(window.__kingmakerHarness.files[path]),path);
const canvas=(page:Page)=>page.locator('.map-stage canvas');
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const renderStats=(page:Page)=>canvas(page).evaluate(el=>({...((el as any).__kmPixi.stats)}));
test('Pixi hover and pan do zero per-tile CPU work at both small and maximum map sizes',async({page})=>{
  for(const length of [16,64]){
    const doc={...blank,terrain:{version:1,width:length,height:length,tiles:Array(length*length).fill('grass')}};
    await page.evaluate(({path,doc})=>window.__kingmakerHarness.writeDocument(path,doc as any),{path,doc});
    await expect(canvas(page)).toHaveAttribute('data-width',String(length));await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');await page.getByRole('button',{name:/^Fit/}).click();await settle(page);
    const before=await renderStats(page),box=(await canvas(page).boundingBox())!;
    for(let i=0;i<12;i++)await page.mouse.move(box.x+box.width/2+i*3,box.y+box.height*.56+i);
    await settle(page);const hovered=await renderStats(page);
    for(const key of ['fullSyncs','tileChecks','tileUpdates','tileTransforms','tileCollections'])expect(hovered[key]-before[key],`${length}: hover ${key}`).toBe(0);
    await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width/2+130,box.y+box.height*.56+70,{steps:18});await page.mouse.up({button:'middle'});await settle(page);const panned=await renderStats(page);
    for(const key of ['fullSyncs','tileChecks','tileUpdates','tileTransforms','tileCollections'])expect(panned[key]-hovered[key],`${length}: pan ${key}`).toBe(0);
    expect(panned.viewUpdates).toBeGreaterThan(hovered.viewUpdates);expect(panned.frames).toBeGreaterThan(hovered.frames);
    const previousZoom=await canvas(page).getAttribute('data-zoom');await canvas(page).hover();await page.mouse.wheel(0,-100);await expect(canvas(page)).not.toHaveAttribute('data-zoom',previousZoom!);await settle(page);const zoomed=await renderStats(page);
    for(const key of ['fullSyncs','tileChecks','tileUpdates','tileTransforms','tileCollections'])expect(zoomed[key]-panned[key],`${length}: zoom ${key}`).toBe(0);
    const idle=await renderStats(page);await settle(page);expect((await renderStats(page)).frames).toBe(idle.frames);expect(await saved(page)).toEqual(doc);
  }
});
test('Pixi brush updates only changed tiles; cancellation and undo restore the visual data',async({page})=>{
  await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');await settle(page);
  const before=await renderStats(page);await stroke(page,{x:12,y:12},{x:14,y:12});await settle(page);const after=await renderStats(page);
  expect(after.tileUpdates-before.tileUpdates).toBe(3);expect(after.tileChecks-before.tileChecks).toBe(3);expect(after.fullSyncs).toBe(before.fullSyncs);
  expect(after.tileCollections-before.tileCollections).toBe(0);expect(after.tileTransforms-before.tileTransforms).toBeLessThanOrEqual(6);
  const original=await saved(page);await page.getByRole('button',{name:'Paint Water',exact:true}).click();const a=await point(page,12,12),b=await point(page,14,12);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();expect(await saved(page)).toEqual(original);
  await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect((await saved(page)).terrain).toBeUndefined();await page.getByRole('button',{name:'Redo map edit',exact:true}).click();expect(await saved(page)).toEqual(original);
});
test('preview keeps rendering and picking after fractional left and middle drags and view switches',async({page})=>{
  const original=await saved(page);await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','preview');
  for(const button of ['left','middle'] as const){
    const box=(await canvas(page).boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down({button});await page.mouse.move(box.x+box.width/2+77,box.y+box.height/2+35,{steps:7});await page.mouse.up({button});
    await expect(page.locator('.map-error')).toHaveCount(0);
    const filled=await canvas(page).evaluate(el=>{const c=el as HTMLCanvasElement,rgba=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]!==21||rgba[i+1]!==22||rgba[i+2]!==25)count++;return count});expect(filled).toBeGreaterThan(1000);
    await canvas(page).hover();await expect(page.locator('.map-hover-tile')).toContainText('Hover:');
  }
  await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');await canvas(page).press('Tab');await expect(page.locator('.map-error')).toHaveCount(0);expect(await saved(page)).toEqual(original);
});
test('Pixi camera keeps markers and tile picking aligned; view switches dispose the previous renderer',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await tileMenu(page);await page.getByRole('menuitem',{name:'Add spawn point…'}).click();await page.getByLabel('Spawn point name').fill('Gate');await page.getByRole('button',{name:'Save spawn point',exact:true}).click();
  const marker=page.getByRole('button',{name:'Edit spawn point Gate',exact:true}),before=(await marker.boundingBox())!,start=await point(page,16,12);
  await page.mouse.move(start.x,start.y);await page.mouse.down({button:'middle'});await page.mouse.move(start.x+90,start.y+40,{steps:8});const during=(await marker.boundingBox())!;expect(during.x-before.x).toBeCloseTo(90,0);expect(during.y-before.y).toBeCloseTo(40,0);await page.mouse.up({button:'middle'});const after=(await marker.boundingBox())!;expect(after.x).toBeCloseTo(during.x,0);expect(after.y).toBeCloseTo(during.y,0);
  const at=await point(page,12,12);await page.mouse.move(at.x,at.y);await expect(page.locator('.map-hover-tile')).toContainText('(12, 12)');
  for(let i=0;i<4;i++){const previous=(await canvas(page).elementHandle())!;await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','preview');expect(await previous.evaluate(el=>Boolean((el as any).__kmPixi))).toBe(false);await previous.dispose();await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-renderer','pixi');await expect(page.locator('.map-error')).toHaveCount(0)}
  expect(errors).toEqual([]);
});
async function tileMenu(page:Page,x=12,y=12){const p=await point(page,x,y);await page.mouse.click(p.x,p.y,{button:'right'});await expect(page.getByRole('menu')).toBeVisible()}
test('tile and marker context menus share dynamic actions; targeted deletion confirms and supports undo',async({page})=>{
  await page.getByRole('button',{name:'Paint clutter Lamp',exact:true}).click();await stroke(page,{x:12,y:12});
  await tileMenu(page);await page.getByRole('menuitem',{name:'Add spawn point…'}).click();await page.getByLabel('Spawn point name').fill('Gate');await page.getByRole('button',{name:'Save spawn point',exact:true}).click();
  await tileMenu(page);await page.getByRole('menuitem',{name:'Add interaction…'}).click();await page.getByLabel('Interaction name').fill('Open gate');await page.getByLabel('Exit port',{exact:true}).fill('Outside');await page.getByRole('button',{name:'Save interaction',exact:true}).click();
  const original=await saved(page);
  await tileMenu(page);const actions=await page.getByRole('menuitem').allTextContents();expect(actions).toEqual(['Edit Gate…','Delete Gate…','Edit Open gate…','Delete Open gate…','Delete Lamp clutter…','Add spawn point…','Add interaction…']);await page.keyboard.press('Escape');
  for(const name of ['Edit spawn point Gate','Edit interaction Open gate']){
    await page.getByRole('button',{name,exact:true}).click({button:'right'});await expect(page.getByRole('menu',{name:'Tile 12, 12',exact:true})).toBeVisible();expect(await page.getByRole('menuitem').allTextContents()).toEqual(actions);await expect(page.locator('.map-feature-dialog')).toHaveCount(0);await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'Edit spawn point Gate',exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Delete Gate…',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('Scenario transitions');await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();expect(await saved(page)).toEqual(original);await page.keyboard.press('Escape');expect(await saved(page)).toEqual(original);await expect(canvas(page)).toBeFocused();
  await tileMenu(page);await page.getByRole('menuitem',{name:'Delete Gate…',exact:true}).click();await page.getByRole('button',{name:'Delete spawn point',exact:true}).click();const removed=await saved(page);expect(removed.nodes).toEqual(original.nodes.filter((n:any)=>n.data.title!=='Gate'));expect(removed.terrain).toEqual(original.terrain);
  await canvas(page).press('Control+z');expect(await saved(page)).toEqual(original);await canvas(page).press('Control+Shift+z');expect(await saved(page)).toEqual(removed);
  await tileMenu(page);await expect(page.getByRole('menuitem',{name:'Delete Gate…',exact:true})).toHaveCount(0);await page.getByRole('menuitem',{name:'Delete Open gate…',exact:true}).click();await page.getByRole('button',{name:'Delete interaction',exact:true}).click();expect((await saved(page)).nodes).toEqual(blank.nodes);await canvas(page).press('Control+z');expect(await saved(page)).toEqual(removed);
  await tileMenu(page);await page.getByRole('menuitem',{name:'Delete Lamp clutter…'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await saved(page)).toEqual(removed);
  await tileMenu(page);await page.getByRole('menuitem',{name:'Delete Lamp clutter…'}).click();await page.getByRole('button',{name:'Delete clutter',exact:true}).click();const uncluttered=await saved(page);expect(uncluttered.terrain.clutter[12*32+12]).toBeNull();expect(uncluttered.terrain.tiles).toEqual(removed.terrain.tiles);expect(uncluttered.nodes).toEqual(removed.nodes);await canvas(page).press('Control+z');expect(await saved(page)).toEqual(removed);
  await tileMenu(page,15,12);expect(await page.getByRole('menuitem').allTextContents()).toEqual(['Add spawn point…','Add interaction…']);await page.keyboard.press('End');await expect(page.getByRole('menuitem',{name:'Add interaction…'})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);expect(await saved(page)).toEqual(removed);
});
async function point(page:Page,x:number,y:number){return canvas(page).evaluate((el,{x,y})=>{const c=el as HTMLCanvasElement,b=c.getBoundingClientRect(),z=Number(c.dataset.zoom),cx=Number(c.dataset.cameraX),cy=Number(c.dataset.cameraY);return {x:b.x+b.width/2+(x-cx+y-cy)*18*z,y:b.y+b.height*.56+(y-cy-x+cx)*9*z}},{x,y})}
async function stroke(page:Page,from:{x:number;y:number},to=from){const a=await point(page,from.x,from.y),b=await point(page,to.x,to.y);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up()}
test.beforeEach(async({page})=>{await page.goto('/');await page.evaluate(({path,blank})=>{localStorage.setItem('kingmaker-authoring-test-files-v2',JSON.stringify({[path]:JSON.stringify(blank)}));localStorage.setItem('kingmaker-authoring-test-active-v2',path)},{path,blank});await page.reload();await expect(canvas(page)).toBeVisible()});
test('right-click authors real spawn and interaction ports, editable and visible on the scenario card',async({page})=>{
  await tileMenu(page);await page.getByRole('menuitem',{name:'Add spawn point…'}).click();await page.getByLabel('Spawn point name').fill('From the lane');await page.getByRole('button',{name:'Save spawn point',exact:true}).click();
  let doc=await saved(page),spawn=doc.nodes.find((n:any)=>n.data.mapFeature==='spawn');expect(spawn.data.mapAt).toEqual({x:12,y:12});expect(spawn.data.kind).toBe('start');
  await tileMenu(page,13,12);await page.getByRole('menuitem',{name:'Add interaction…'}).click();await page.getByLabel('Interaction name').fill('Open door');await page.getByLabel('Event log message').fill('The door creaks open.');await page.getByLabel('Exit port',{exact:true}).fill('To tavern');await page.getByLabel('Script notes').fill('Eventually unlock the door here.');
  await page.screenshot({path:'dist/screenshots/map-interaction-editor.png'});
  await page.getByRole('button',{name:'Save interaction',exact:true}).click();doc=await saved(page);const interaction=doc.nodes.find((n:any)=>n.data.mapFeature==='interaction');expect(interaction.data).toMatchObject({title:'Open door',exitPort:'To tavern',eventMessage:'The door creaks open.',kind:'exit',mapAt:{x:13,y:12}});
  await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect((await saved(page)).nodes).toHaveLength(2);await page.getByRole('button',{name:'Redo map edit',exact:true}).click();expect(await saved(page)).toEqual(doc);
  await tileMenu(page,13,12);await page.getByRole('menuitem',{name:'Edit Open door…'}).click();await page.getByLabel('Interaction name').fill('Push door');await page.getByRole('button',{name:'Save interaction',exact:true}).click();expect((await saved(page)).nodes.find((n:any)=>n.id===interaction.id).data.title).toBe('Push door');
  const scenarioPath='Scenarios/Test.kmscenario';await page.evaluate(({scenarioPath,path})=>window.__kingmakerHarness.writeDocument(scenarioPath,{format:'kingmaker',version:1,kind:'scenario',id:'scenario',title:'Test',description:'',nodes:[],edges:[],lore:[],scenario:{files:[path]}}),{scenarioPath,path});
  await page.getByLabel('Test file',{exact:true}).selectOption(scenarioPath);const card=page.locator('.scenario-card').filter({has:page.locator(`[data-port-id="${spawn.id}"]`)});await expect(card.locator('.scenario-port-input')).toContainText(['From town','From the lane']);await expect(card.locator('.scenario-port-output')).toHaveText('exitTo tavern');
  await page.getByLabel('Test file',{exact:true}).selectOption(path);await page.reload();await expect(page.getByRole('button',{name:'Edit interaction Push door',exact:true})).toBeVisible();expect((await saved(page)).nodes.find((n:any)=>n.id===interaction.id).data.script).toBe('Eventually unlock the door here.');
});
test('interaction without an exit stays local; removing an exit and deleting a spawn require confirmation',async({page})=>{
  await tileMenu(page);await page.getByRole('menuitem',{name:'Add interaction…'}).click();await page.getByLabel('Interaction name').fill('Read sign');await page.getByLabel('Event log message').fill('No trespassing.');await page.getByRole('button',{name:'Save interaction',exact:true}).click();expect((await saved(page)).nodes.at(-1).data.kind).toBe('beat');
  await page.getByRole('button',{name:'Edit interaction Read sign',exact:true}).click();await page.getByLabel('Exit port',{exact:true}).fill('Continue');await page.getByRole('button',{name:'Save interaction',exact:true}).click();const before=await saved(page);
  await page.getByRole('button',{name:'Edit interaction Read sign',exact:true}).click();await page.getByLabel('Exit port',{exact:true}).fill('');await page.getByRole('button',{name:'Save interaction',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Remove this exit port?');expect(await saved(page)).toEqual(before);await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Edit interaction Read sign',exact:true}).click();await page.getByLabel('Exit port',{exact:true}).fill('');await page.getByRole('button',{name:'Save interaction',exact:true}).click();await page.getByRole('button',{name:'Remove port and save',exact:true}).click();expect((await saved(page)).nodes.at(-1).data.kind).toBe('beat');
  await tileMenu(page,14,12);await page.getByRole('menuitem',{name:'Add spawn point…'}).click();await page.getByLabel('Spawn point name').fill('Arrival');await page.getByRole('button',{name:'Save spawn point',exact:true}).click();const withSpawn=await saved(page);
  await page.getByRole('button',{name:'Edit spawn point Arrival',exact:true}).click();await page.getByRole('button',{name:'Delete…',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Delete this spawn point?');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await saved(page)).toEqual(withSpawn);
  await page.getByRole('button',{name:'Edit spawn point Arrival',exact:true}).click();await page.getByRole('button',{name:'Delete…',exact:true}).click();await page.getByRole('button',{name:'Delete spawn point',exact:true}).click();expect((await saved(page)).nodes).toHaveLength(2);await canvas(page).press('Control+z');expect(await saved(page)).toEqual(withSpawn);
});
test('clutter paints above terrain, erases independently, resizes and persists into the real preview',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Paint Boards',exact:true}).click();await stroke(page,{x:12,y:12},{x:16,y:12});const terrain=(await saved(page)).terrain.tiles;
  await page.getByRole('button',{name:'Paint clutter Lamp',exact:true}).click();await stroke(page,{x:12,y:12},{x:16,y:12});let doc=await saved(page);expect(doc.terrain.clutter.filter(Boolean)).toHaveLength(5);expect(doc.terrain.tiles).toEqual(terrain);
  await page.keyboard.down('Control');await stroke(page,{x:14,y:12});await page.keyboard.up('Control');expect((await saved(page)).terrain.clutter[12*32+14]).toBeNull();expect((await saved(page)).terrain.tiles).toEqual(terrain);
  await page.getByRole('button',{name:'Paint clutter Sign',exact:true}).click();await stroke(page,{x:14,y:12});await page.getByRole('button',{name:'Resize',exact:true}).click();await dragEdge(page,'west',2);doc=await saved(page);expect(doc.terrain.clutter[12*34+16]).toBe('sign');expect(doc.terrain.tiles[12*34+16]).toBe('boards');
  await page.getByRole('button',{name:'Brush',exact:true}).click();await page.screenshot({path:'dist/screenshots/map-clutter-authoring.png'});await canvas(page).press('Tab');await expect(page.locator('.map-error')).toHaveCount(0);await page.screenshot({path:'dist/screenshots/map-clutter-preview.png'});expect(await saved(page)).toEqual(doc);
  await page.reload();await expect(canvas(page)).toBeVisible();expect(await saved(page)).toEqual(doc);expect(errors).toEqual([]);
});
test('opens a blank map without silently saving dummy data; stroke saves once and undo/redo survives view switches',async({page})=>{
  expect((await saved(page)).terrain).toBeUndefined();
  await page.getByRole('button',{name:'Paint Water',exact:true}).click();
  await stroke(page,{x:12,y:12},{x:17,y:12});
  let doc=await saved(page);expect(doc.terrain.tiles.filter((t:string)=>t==='water')).toHaveLength(6);expect(doc.nodes).toEqual(blank.nodes);expect(doc.source).toEqual(blank.source);
  await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','preview');
  await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','edit');
  await canvas(page).press('Control+z');expect((await saved(page)).terrain).toBeUndefined();
  await canvas(page).press('Control+Shift+z');expect((await saved(page)).terrain.tiles).toEqual(doc.terrain.tiles);
  await page.reload();await expect(canvas(page)).toBeVisible();expect((await saved(page)).terrain.tiles).toEqual(doc.terrain.tiles);
});
test('rectangle, fill, sampling, erase and cancelled drag use the right tiles',async({page})=>{
  await page.getByRole('button',{name:'Paint Water',exact:true}).click();await canvas(page).press('r');await stroke(page,{x:11,y:10},{x:13,y:12});expect((await saved(page)).terrain.tiles.filter((t:string)=>t==='water')).toHaveLength(9);
  await page.getByRole('button',{name:'Paint Boards',exact:true}).click();await canvas(page).press('g');await stroke(page,{x:12,y:11});expect((await saved(page)).terrain.tiles.filter((t:string)=>t==='boards')).toHaveLength(9);
  await canvas(page).press('i');await stroke(page,{x:12,y:11});await expect(page.getByRole('button',{name:'Paint Boards',exact:true})).toHaveAttribute('aria-pressed','true');
  await canvas(page).press('e');await stroke(page,{x:12,y:11});expect((await saved(page)).terrain.tiles[11*32+12]).toBe('grass');
  const before=await saved(page),a=await point(page,12,12),b=await point(page,15,12);await canvas(page).press('b');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.keyboard.press('Escape');await page.mouse.up();expect(await saved(page)).toEqual(before);
});
test('bulk replacement actions are absent; real game preview renders without editing terrain or ports',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByRole('button',{name:'Load harbour example',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Clear terrain…',exact:true})).toHaveCount(0);await expect(page.locator('.map-palette-bottom')).toHaveCount(0);
  await page.evaluate(({path,document})=>window.__kingmakerHarness.writeDocument(path,document as any),{path,document:{...blank,terrain:harbourMap()}});await expect(canvas(page)).toBeVisible();const example=await saved(page);expect(example.terrain.tiles).toContain('roof');expect(example.nodes).toEqual(blank.nodes);
  await page.getByRole('button',{name:/^Fit/}).click();await page.screenshot({path:'dist/screenshots/map-isometric-authoring.png'});
  await canvas(page).focus();await canvas(page).press('Tab');await page.getByRole('button',{name:/^Fit/}).click();
  await expect(page.locator('.map-error')).toHaveCount(0);
  // A real render contains hundreds of differently coloured cells, not an error message on a blank canvas.
  const colors=await canvas(page).evaluate(el=>{const c=el as HTMLCanvasElement,data=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data,s=new Set<string>();for(let i=0;i<data.length;i+=4)s.add(`${data[i]},${data[i+1]},${data[i+2]}`);return s.size});expect(colors).toBeGreaterThan(100);
  await page.screenshot({path:'dist/screenshots/map-isometric-game-preview.png'});
  await page.getByLabel('Night lighting').check();await page.getByLabel('Lift roofs').check();expect(await saved(page)).toEqual(example);
  await expect(page.getByRole('button',{name:'Ports',exact:true})).toHaveCount(0);expect((await saved(page)).nodes).toEqual(blank.nodes);
  await page.getByRole('button',{name:'Paint',exact:true}).click();expect(await saved(page)).toEqual(example);
  expect(await saved(page)).toEqual(example);expect(errors).toEqual([]);
});
test('pan/zoom are view-only and shortcuts do not hijack controls',async({page})=>{
  await page.getByRole('button',{name:'Pan',exact:true}).click();const a=await point(page,15,12);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+80,a.y+30);await page.mouse.up();expect((await saved(page)).terrain).toBeUndefined();
  const old=await canvas(page).getAttribute('data-zoom');await canvas(page).hover();await page.mouse.wheel(0,-160);await expect(canvas(page)).not.toHaveAttribute('data-zoom',old!);
  await page.getByLabel('Brush size').focus();await page.keyboard.press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','edit');
});
test('external file reload replaces terrain and preview does not replace the host process',async({page})=>{
  await page.addInitScript(()=>{(window as any).process={sentinel:'host-process',env:{SENTINEL:'keep'}}});
  await page.reload();await expect(canvas(page)).toBeVisible();
  const terrain={version:1,width:8,height:8,tiles:Array(64).fill('water')};
  await page.evaluate(({path,blank,terrain})=>window.__kingmakerHarness.writeDocument(path,{...blank,terrain} as any),{path,blank,terrain});
  await expect(canvas(page)).toHaveAttribute('data-width','8');await canvas(page).press('Tab');await expect(page.locator('.map-error')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).process)).toEqual({sentinel:'host-process',env:{SENTINEL:'keep'}});
  expect((await saved(page)).terrain).toEqual(terrain);
});
test('bottom-left identifies hovered terrain independently of the brush, including raised preview walls',async({page})=>{
  await page.getByRole('button',{name:'Paint Water',exact:true}).click();await stroke(page,{x:12,y:12});
  await page.getByRole('button',{name:'Paint Boards',exact:true}).click();const at=await point(page,12,12);await page.mouse.move(at.x,at.y);
  await expect(page.locator('.map-hover-tile')).toHaveText(' · Hover: Water (12, 12)');
  const grass=await point(page,13,12);await page.mouse.move(grass.x,grass.y);await expect(page.locator('.map-hover-tile')).toHaveText(' · Hover: Grass (13, 12)');
  await page.getByRole('button',{name:'Paint Stone wall',exact:true}).click();await stroke(page,{x:12,y:12});
  await canvas(page).press('Tab');await expect(canvas(page)).toHaveAttribute('data-mode','preview');
  const wall=await canvas(page).evaluate(el=>{const c=el as HTMLCanvasElement,b=c.getBoundingClientRect(),z=Number(c.dataset.zoom),cx=Number(c.dataset.cameraX),cy=Number(c.dataset.cameraY),cw=6*z,ch=12*z,w=Math.min(400,Math.ceil(b.width/cw)),h=Math.min(220,Math.ceil(b.height/ch));return {x:b.x+(b.width-w*cw)/2+(Math.floor(w/2)-2*(cx+cy)+48+.5)*cw,y:b.y+(b.height-h*ch)*.56+(Math.floor(h*.56)-(cy-cx)-3+.5)*ch}});
  await page.mouse.move(wall.x,wall.y);await expect(page.locator('.map-hover-tile')).toHaveText(' · Hover: Stone wall (12, 12)');
  const before=await saved(page);await page.getByRole('button',{name:'Paint',exact:true}).hover();await expect(page.locator('.map-hover-tile')).toHaveCount(0);expect(await saved(page)).toEqual(before);
});
const edgeHandle=(page:Page,edge:string)=>page.getByRole('button',{name:`Resize ${edge} edge`,exact:true});
async function dragEdge(page:Page,edge:string,amount:number,release=true){
  const handle=edgeHandle(page,edge),b=(await handle.boundingBox())!,z=Number(await canvas(page).getAttribute('data-zoom'));
  const dx=(edge==='east'?amount:edge==='west'?-amount:0),dy=(edge==='south'?amount:edge==='north'?-amount:0);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+(dx+dy)*18*z,b.y+b.height/2+(dy-dx)*9*z,{steps:6});if(release)await page.mouse.up();
}
test('four isometric handles extend the map; north/west keep terrain in place and resize is one undo step',async({page})=>{
  await page.getByRole('button',{name:'Paint Water',exact:true}).click();await stroke(page,{x:12,y:12});
  await page.getByRole('button',{name:'Resize',exact:true}).click();await expect(page.locator('.map-resize-handle')).toHaveCount(4);
  let marker={x:12,y:12};
  for(const edge of ['east','south','west','north']){
    const before=await saved(page),position=await point(page,marker.x,marker.y);
    await dragEdge(page,edge,2,false);expect(await saved(page)).toEqual(before);await expect(page.locator('.map-resize-guide')).toContainText(`+2 ${edge}`);await page.mouse.up();
    const after=await saved(page),horizontal=edge==='east'||edge==='west';expect(after.terrain.width).toBe(before.terrain.width+(horizontal?2:0));expect(after.terrain.height).toBe(before.terrain.height+(horizontal?0:2));
    const shifted={x:marker.x+(edge==='west'?2:0),y:marker.y+(edge==='north'?2:0)};expect(after.terrain.tiles[shifted.y*after.terrain.width+shifted.x]).toBe('water');expect(after.nodes).toEqual(before.nodes);expect(after.source).toEqual(before.source);
    const nextPosition=await point(page,shifted.x,shifted.y);expect(nextPosition.x).toBeCloseTo(position.x,1);expect(nextPosition.y).toBeCloseTo(position.y,1);
    await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect(await saved(page)).toEqual(before);await page.getByRole('button',{name:'Redo map edit',exact:true}).click();expect(await saved(page)).toEqual(after);marker=shifted;
  }
  await page.getByRole('button',{name:/^Fit/}).click();await page.screenshot({path:'dist/screenshots/map-resize-handles.png'});
  const resized=await saved(page);await page.reload();await expect(canvas(page)).toBeVisible();expect(await saved(page)).toEqual(resized);
});
test('crop requires confirmation; Escape and pointer cancellation leave content unchanged',async({page})=>{
  await page.getByRole('button',{name:'Resize',exact:true}).click();const before=await saved(page);
  await dragEdge(page,'west',-2);await expect(page.getByRole('alertdialog')).toContainText('48 tiles from the west edge');expect(await saved(page)).toEqual(before);await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await saved(page)).toEqual(before);
  await dragEdge(page,'west',-2);await page.getByRole('button',{name:'Crop map',exact:true}).click();expect((await saved(page)).terrain.width).toBe(30);await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect(await saved(page)).toEqual(before);
  await dragEdge(page,'north',3,false);await page.keyboard.press('Escape');await page.mouse.up();expect(await saved(page)).toEqual(before);await expect(canvas(page)).toHaveAttribute('data-height','24');
  await dragEdge(page,'east',3,false);await edgeHandle(page,'east').dispatchEvent('pointercancel');await page.mouse.up();expect(await saved(page)).toEqual(before);
  await edgeHandle(page,'south').focus();await page.keyboard.press('+');expect((await saved(page)).terrain.height).toBe(25);
});
test('paint/erase swatches, temporary secondary painting, eraser and swap share undoable terrain edits',async({page})=>{
  const untouched=await saved(page),paintSlot=page.getByRole('button',{name:'Choose paint material',exact:true}),eraseSlot=page.getByRole('button',{name:'Choose erase material',exact:true});
  await page.getByRole('button',{name:'Paint Water',exact:true}).click();await eraseSlot.click();await page.getByRole('button',{name:'Erase Dirt',exact:true}).click();
  await expect(paintSlot).toContainText('Water');await expect(eraseSlot).toContainText('Dirt');expect(await saved(page)).toEqual(untouched);
  await stroke(page,{x:12,y:12});expect((await saved(page)).terrain.tiles[12*32+12]).toBe('water');
  await page.keyboard.down('Control');await stroke(page,{x:13,y:12},{x:15,y:12});await page.keyboard.up('Control');
  let doc=await saved(page);for(let x=13;x<=15;x++)expect(doc.terrain.tiles[12*32+x]).toBe('dirt');await expect(page.getByRole('button',{name:'Brush',exact:true})).toHaveAttribute('aria-pressed','true');
  await canvas(page).press('Control+z');expect((await saved(page)).terrain.tiles[12*32+13]).toBe('grass');await canvas(page).press('Control+Shift+z');expect(await saved(page)).toEqual(doc);
  await stroke(page,{x:16,y:12});expect((await saved(page)).terrain.tiles[12*32+16]).toBe('water');
  await canvas(page).press('e');await stroke(page,{x:12,y:12});expect((await saved(page)).terrain.tiles[12*32+12]).toBe('dirt');
  const beforeSwap=await saved(page);await canvas(page).press('x');await expect(paintSlot).toContainText('Dirt');await expect(eraseSlot).toContainText('Water');expect(await saved(page)).toEqual(beforeSwap);
  await canvas(page).press('b');await stroke(page,{x:12,y:11});expect((await saved(page)).terrain.tiles[11*32+12]).toBe('dirt');
  await page.keyboard.down('Meta');await stroke(page,{x:13,y:11});await page.keyboard.up('Meta');expect((await saved(page)).terrain.tiles[11*32+13]).toBe('water');
  await page.screenshot({path:'dist/screenshots/map-paint-erase-swatches.png'});
  const beforeReset=await saved(page);await canvas(page).press('d');await expect(paintSlot).toContainText('Cobbles');await expect(eraseSlot).toContainText('Grass');expect(await saved(page)).toEqual(beforeReset);
});
test('secondary material works with rectangle/fill and sampling targets the selected swatch',async({page})=>{
  const eraseSlot=page.getByRole('button',{name:'Choose erase material',exact:true});await eraseSlot.click();await page.getByRole('button',{name:'Erase Water',exact:true}).click();
  await canvas(page).press('r');await page.keyboard.down('Control');await stroke(page,{x:11,y:10},{x:13,y:12});await page.keyboard.up('Control');expect((await saved(page)).terrain.tiles.filter((t:string)=>t==='water')).toHaveLength(9);
  await eraseSlot.click();await page.getByRole('button',{name:'Erase Boards',exact:true}).click();await canvas(page).press('g');await page.keyboard.down('Control');await stroke(page,{x:12,y:11});await page.keyboard.up('Control');expect((await saved(page)).terrain.tiles.filter((t:string)=>t==='boards')).toHaveLength(9);
  const before=await saved(page);await eraseSlot.click();await page.keyboard.down('Alt');await stroke(page,{x:14,y:11});await page.keyboard.up('Alt');await expect(eraseSlot).toContainText('Grass');expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Choose paint material',exact:true}).click();await canvas(page).press('i');await stroke(page,{x:12,y:11});await expect(page.getByRole('button',{name:'Choose paint material',exact:true})).toContainText('Boards');expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Swap paint and erase materials',exact:true}).click();await expect(eraseSlot).toContainText('Boards');expect(await saved(page)).toEqual(before);
});

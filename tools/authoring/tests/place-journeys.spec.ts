import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// A place on its own grid (the place editor): its areas, things and where its people start, edited
// there. The journey asserts the file as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const text=(path:string)=>readFile(new URL(path,CAMPAIGN),'utf8');
const original=async(path:string)=>JSON.parse(await text(path));
const savedText=(page:Page,path:string)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path:string)=>JSON.parse(await savedText(page,path));
const open=async(page:Page,path:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  await expect(page.locator('.file-path')).toHaveText(path);
};
/** Where a spot of the place (feet) is on the page. */
const feet=(page:Page,x:number,y:number)=>page.locator('svg.place-grid').evaluate((svg,{x,y})=>{const m=(svg as SVGSVGElement).getScreenCTM()!;return {x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}},{x,y});
const drag=async(page:Page,from:{x:number;y:number},to:{x:number;y:number})=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up()};
const thing=(doc:any,id:string)=>doc.things.find((t:any)=>t.id===id);

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
});

test('a place on its own grid: its things where they stand, one moved, one added and its fields set, each in the place\'s file',async({page})=>{
  const path='places/granary-yard.kmplace',yard=await original(path);
  await open(page,path);
  await expect(page.locator('.km-place[data-campaign="read"]')).toBeVisible();
  await expect(page.locator('.place-thing')).toHaveCount(yard.things.filter((t:any)=>t.at).length);
  await expect(page.locator('.place-person')).toHaveCount(Object.keys(yard.people).length);
  // Where it's laid, by the names an author knows them by (the map's title and the region's name).
  await expect(page.locator('.place-layers')).toContainText('On Caerwyn, over “the yard behind the King\'s Granary” (40, 9)');
  await expect(page.getByRole('tab',{name:'Problems (0)'})).toBeVisible();
  // Prout's satchel, dragged from the gate across the yard: moved in feet, still in the yard.
  await drag(page,await feet(page,14,10),await feet(page,24,30));
  await expect.poll(async()=>thing(await saved(page,path),'satchel').at).toEqual([24,30]);
  let doc=await saved(page,path);
  expect(thing(doc,'satchel')).toEqual({...thing(yard,'satchel'),at:[24,30]});
  expect({...doc,things:doc.things.filter((t:any)=>t.id!=='satchel')}).toEqual({...yard,things:yard.things.filter((t:any)=>t.id!=='satchel')});
  // Into the loft, it's in the loft.
  await drag(page,await feet(page,24,30),await feet(page,44,30));
  await expect.poll(async()=>thing(await saved(page,path),'satchel').in).toBe('loft');
  // A ladder, added where the grid was right-clicked, and its fields set.
  const at=await feet(page,6,20);
  await page.mouse.click(at.x,at.y,{button:'right'});
  await page.getByRole('menuitem',{name:'Add a thing here…'}).click();
  const dialog=page.getByRole('dialog',{name:'New thing'});
  await dialog.getByLabel('Name',{exact:true}).fill('a ladder');
  await dialog.getByRole('button',{name:'Add thing'}).click();
  doc=await saved(page,path);
  expect(doc.things.at(-1)).toEqual({id:'a-ladder',name:'a ladder',in:'yard',at:[6,20]});
  const inspector=page.locator('.place-inspector[data-place-part="thing:a-ladder"]');
  await inspector.getByLabel('Kind',{exact:true}).selectOption('object');
  await inspector.getByLabel('Size',{exact:true}).selectOption('large');
  await inspector.getByLabel('Material',{exact:true}).selectOption('wood');
  await inspector.getByLabel('Description',{exact:true}).fill('A ladder long enough for the hoist beam.');
  await inspector.getByRole('button',{name:'Add a state',exact:true}).click();
  await inspector.getByLabel('New: States',{exact:true}).fill('leaning');
  await inspector.getByLabel('New: States',{exact:true}).press('Enter');
  doc=await saved(page,path);
  expect(doc.things.at(-1)).toEqual({id:'a-ladder',name:'a ladder',kind:'object',in:'yard',at:[6,20],size:'large',material:'wood',states:['leaning'],description:'A ladder long enough for the hoist beam.'});
  // The ladder dragged past the place's west edge stays on its floor, and off the floor nothing is offered to add.
  await drag(page,await feet(page,6,20),await feet(page,-8,20));
  await expect.poll(async()=>thing(await saved(page,path),'a-ladder').at).toEqual([0,20]);
  const off=await feet(page,-6,30);
  await page.mouse.click(off.x,off.y,{button:'right'});
  await expect(page.getByRole('menu')).toContainText('off the place, which is 52 × 40 feet');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  const away=await feet(page,26,-6);
  await page.mouse.click(away.x,away.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // The lane dragged five feet south takes its elm with it.
  await drag(page,await feet(page,4,4),await feet(page,4,9));
  await expect.poll(async()=>(await saved(page,path)).areas.find((a:any)=>a.id==='lane').rect).toEqual({x:0,y:5,w:40,h:8});
  expect(thing(await saved(page,path),'elm').at).toEqual([34,8]);
  // What's in a thing is its contents: the beam holds the rope, the rope the body.
  await page.locator('.place-thing[data-thing="hoist-beam"]').click();
  await expect(page.locator('.place-inspector[data-place-part="thing:hoist-beam"] [data-field="contents"]')).toContainText('the hoist rope');
  // Undo, a step at a time, back to the file as it was.
  const undo=page.getByRole('button',{name:'Undo place edit'});
  for(let i=0;i<20&&await undo.isEnabled();i++)await undo.click();
  await expect(undo).toBeDisabled();
  await expect.poll(()=>savedText(page,path)).toBe(await text(path));
});

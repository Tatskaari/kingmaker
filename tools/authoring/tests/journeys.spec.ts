import {test,expect,type Page,type Locator} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// The scene editor on the game's own campaign: the browser harness's vault is campaigns/caerwyn (its
// scenes, places, campaign.json and lore), and every journey asserts the scene file as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const clerkPath='scenes/hanged-clerk.kmscene';
const clerkText=await readFile(new URL(clerkPath,CAMPAIGN),'utf8');
const SCENES=['caerwyn-afternoon','drowned-rat','hanged-clerk','heron-warehouse','kings-morning','talk','wharf-night'];

const files=(page:Page)=>page.evaluate(()=>({...(window as any).__kingmakerHarness.files}) as Record<string,string>);
const savedText=(page:Page,path=clerkPath)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path=clerkPath)=>JSON.parse(await savedText(page,path));
const node=(scene:any,id:string)=>scene.nodes.find((n:any)=>n.id===id);
const route=(scene:any,id:string)=>scene.edges.find((e:any)=>e.id===id);
const card=(page:Page,id:string)=>page.locator(`.scene-card[data-node-id="${id}"]`);
const inspector=(page:Page)=>page.locator('.scene-inspector .inspector-body');
const tab=(page:Page,name:RegExp)=>page.getByRole('tab',{name});
const problemsTab=(page:Page)=>tab(page,/^Problems/);
const open=async(page:Page,path:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  await expect(page.locator('.file-path')).toHaveText(path);
};
/** Click a node's card once the graph has settled where it'll stay. */
const select=async(page:Page,id:string)=>{
  const target=card(page,id);
  await expect(target).toBeVisible();
  await settled(target);
  await target.click();
  await expect(page.locator(`.node-inspector[data-node="${id}"]`)).toBeVisible();
};
const settled=async(locator:Locator)=>{
  await locator.evaluate(element=>new Promise<void>(resolve=>{
    let previous='',stable=0;
    const sample=()=>{const box=element.getBoundingClientRect(),position=[box.x,box.y,box.width,box.height].join(',');stable=position===previous?stable+1:0;previous=position;if(stable>=5)resolve();else requestAnimationFrame(sample)};
    sample();
  }));
};
/** A route's card in the inspector, opened for editing (by way of a ways-in link or the problems, or its connection). */
const editRoute=async(page:Page,id:string)=>{
  const routeCard=page.locator(`.route-card[data-route-id="${id}"]`);
  await expect(routeCard).toBeVisible();
  const toggle=routeCard.getByRole('button',{name:'Edit route'});
  if(await toggle.count())await toggle.click();
  await expect(routeCard.getByLabel('Condition',{exact:true})).toBeVisible();
  return routeCard;
};

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText(clerkPath);
  await expect(problemsTab(page)).toHaveText(/^Problems0$/);
});

test('every real scene opens as its graph, with no problems, and opening saves nothing',async({page})=>{
  const before=await files(page);
  for(const id of SCENES){
    const path=`scenes/${id}.kmscene`;
    const scene=JSON.parse(before[path]);
    await open(page,path);
    await expect(page.getByRole('heading',{level:1})).toHaveText(scene.title);
    await expect(page.locator('.scene-card')).toHaveCount(scene.nodes.length);
    await expect(page.locator('.react-flow__edge')).toHaveCount(new Set(scene.edges.map((e:any)=>`${e.source}>${e.target}`)).size);
    await expect(problemsTab(page)).toHaveText(/^Problems0$/);
    await expect(page.locator('.statusbar')).toContainText(`${scene.nodes.length} nodes`);
  }
  await page.screenshot({path:'dist/screenshots/scene-the-rat.png'});
  expect(await files(page)).toEqual(before);
  expect(before[clerkPath]).toBe(clerkText);
});

test('a glance tells the kinds apart: a discovery\'s paths and required mark, an event\'s arrivals, an ending\'s result and where it goes',async({page})=>{
  await expect(card(page,'start')).toHaveClass(/\bstart\b/);
  await expect(card(page,'hobb')).toHaveClass(/\bdiscovery\b.*\brequired\b/);
  await expect(card(page,'hobb')).toContainText('Required');
  await expect(card(page,'hobb')).toContainText('4 paths');
  await expect(card(page,'murder')).toContainText('5 paths');
  await expect(card(page,'cart-arrives')).toHaveClass(/\bevent\b/);
  await expect(card(page,'cart-arrives')).toContainText('Corporal Abner Tull arrives');
  await expect(card(page,'murder-unknown')).toHaveClass(/\bending\b.*\bresult-good\b/);
  await expect(card(page,'murder-unknown')).toContainText('→ caerwyn-afternoon');
  await expect(card(page,'suspicious')).toHaveClass(/result-mixed/);
  await expect(card(page,'failed')).toHaveClass(/result-bad/);
  await expect(card(page,'failed')).toContainText('the story ends');
  await page.screenshot({path:'dist/screenshots/scene-hanged-clerk.png'});
});

test('edit a discovery\'s path and its check',async({page})=>{
  await select(page,'murder');
  const path=inspector(page).getByRole('article',{name:'Path 2'});
  await path.getByLabel('Clue',{exact:true}).fill('Rope burn on the wrists, and the knot is a docker\'s.');
  await path.getByLabel('Strength',{exact:true}).selectOption('proof');
  await path.getByRole('checkbox',{name:'A roll suits it'}).check();
  await path.getByLabel('Check skill',{exact:true}).selectOption('medicine');
  await path.getByLabel('Check DC',{exact:true}).fill('14');
  await expect.poll(async()=>node(await saved(page),'murder').data.paths[1].check).toEqual({skill:'medicine',dc:14});
  const scene=await saved(page);
  const edited=node(scene,'murder').data.paths[1];
  expect(Object.keys(edited)).toEqual(['via','clue','earn','strength','check']);
  expect(edited).toMatchObject({clue:'Rope burn on the wrists, and the knot is a docker\'s.',strength:'proof'});
  const original=JSON.parse(clerkText);
  expect(node(scene,'murder').data.paths[0]).toEqual(node(original,'murder').data.paths[0]);
  expect({...scene,nodes:scene.nodes.filter((n:any)=>n.id!=='murder')}).toEqual({...original,nodes:original.nodes.filter((n:any)=>n.id!=='murder')});
  // Taking the check off takes the key out.
  await path.getByRole('checkbox',{name:'A roll suits it'}).uncheck();
  await expect.poll(async()=>'check' in node(await saved(page),'murder').data.paths[1]).toBe(false);
  // Typing in one field is one step of undo.
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).first().click();
  await expect.poll(async()=>node(await saved(page),'murder').data.paths[1].check).toEqual({skill:'medicine',dc:14});
});

test('add a discovery and route it from the start, its ids slugs of its title',async({page})=>{
  await select(page,'start');
  await page.getByRole('button',{name:/^Add node/}).click();
  const dialog=page.getByRole('dialog',{name:'Add a node'});
  await dialog.getByRole('radio',{name:/Discovery/}).check();
  await dialog.getByLabel('Title',{exact:true}).fill('The tally loft');
  await expect(dialog).toContainText('the-tally-loft');
  await dialog.getByRole('button',{name:'Add discovery'}).click();
  await expect(card(page,'the-tally-loft')).toBeVisible();
  await inspector(page).getByLabel('Revelation',{exact:true}).fill('Someone dragged Prout across the loft to the hoist.');
  await inspector(page).getByLabel('Title',{exact:true}).fill('Up in the tally loft');
  const scene=await saved(page);
  expect(node(scene,'the-tally-loft')).toEqual({id:'the-tally-loft',type:'story',position:node(scene,'the-tally-loft').position,data:{kind:'beat',title:'Up in the tally loft',description:'',revelation:'Someone dragged Prout across the loft to the hoist.',paths:[],lore:[]}});
  expect(route(scene,'find-the-tally-loft')).toEqual({id:'find-the-tally-loft',source:'start',target:'the-tally-loft',type:'smoothstep',label:'Find The tally loft',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  await expect(card(page,'the-tally-loft')).toContainText('Up in the tally loft');
  // What the new discovery still needs, the problems say.
  await expect(problemsTab(page)).toHaveText(/^Problems2$/);
  await problemsTab(page).click();
  await expect(inspector(page).locator('.problem')).toHaveText([/the-tally-loft has no description/,/discovery the-tally-loft has 0 paths/]);
});

test('set an ending\'s requires and next',async({page})=>{
  await select(page,'suspicious');
  await inspector(page).getByLabel('Next scene',{exact:true}).selectOption('drowned-rat');
  await inspector(page).locator('.way-in').filter({hasText:'Suicide, under protest'}).click();
  const routeCard=await editRoute(page,'signed-suicide');
  await routeCard.getByRole('checkbox',{name:'Motive: supplies are being embezzled (motive)'}).check();
  await expect.poll(async()=>route(await saved(page),'signed-suicide').data.requires).toEqual(['motive','hobb']);
  const scene=await saved(page);
  expect(node(scene,'suspicious').data.next).toBe('drowned-rat');
  expect(Object.keys(route(scene,'signed-suicide').data)).toEqual(['condition','phase','requires','skill','dc']);
  // Requiring nothing takes the key out, and a good ending that needs nothing found is a problem.
  await select(page,'murder-unknown');
  await inspector(page).locator('.way-in').filter({hasText:'Signed in as murder'}).click();
  const signed=await editRoute(page,'signed-murder');
  for(const name of ['The victim was murdered (murder)','Hobb was spotted at the scene (hobb)'])await signed.getByRole('checkbox',{name}).uncheck();
  await expect.poll(async()=>'requires' in route(await saved(page),'signed-murder').data).toBe(false);
  await expect(problemsTab(page)).toHaveText(/^Problems2$/);
});

test('edit a cast card\'s roles and limits, and link their lore note by the game\'s path',async({page})=>{
  await tab(page,/^Cast/).click();
  const cob=page.locator('article[data-cast="cob"]');
  await cob.locator('.cast-summary').click();
  await cob.getByLabel('Hooks',{exact:true}).fill('Stamps so the boot crackles. Looks up at the loft door.');
  await cob.getByLabel('Limits',{exact:true}).fill('Coin buys boasts, never the look in his boot.');
  await cob.getByLabel('Inconsistency',{exact:true}).fill('');
  await expect.poll(async()=>(await saved(page)).cast.find((c:any)=>c.id==='cob').limits).toBe('Coin buys boasts, never the look in his boot.');
  const scene=await saved(page),member=scene.cast.find((c:any)=>c.id==='cob');
  expect(member.roles).toEqual({characterise:JSON.parse(clerkText).cast[1].roles.characterise,hooks:'Stamps so the boot crackles. Looks up at the loft door.'});
  expect(Object.keys(member)).toEqual(Object.keys(JSON.parse(clerkText).cast[1]));
  // The lore note: offered by its path under the campaign's lore/, opened in the host.
  await cob.getByRole('button',{name:'Choose another note'}).click();
  const picker=page.getByRole('dialog',{name:'Lore library'});
  await picker.getByLabel('Search lore').fill('Moll');
  await picker.getByRole('button',{name:'Link Cast/Moll/public.md'}).click();
  await expect.poll(async()=>(await saved(page)).cast.find((c:any)=>c.id==='cob').lore).toBe('Cast/Moll/public.md');
  await cob.getByRole('button',{name:'Open Cast/Moll/public.md'}).click();
  await expect(page.getByRole('dialog',{name:'Host opened lore note'})).toContainText('lore/Cast/Moll/public.md');
});

test('see a problem appear and clear, each taking you to where it is',async({page})=>{
  await tab(page,/^Scene/).click();
  await inspector(page).getByLabel('Premise',{exact:true}).fill('');
  await expect(problemsTab(page)).toHaveText(/^Problems1$/);
  await problemsTab(page).click();
  await inspector(page).locator('.problem',{hasText:'it has no premise'}).click();
  await expect(inspector(page).getByLabel('Premise',{exact:true})).toBeFocused();
  await page.keyboard.type('Murder or suicide, before the noon cart?');
  await expect(problemsTab(page)).toHaveText(/^Problems0$/);
  expect((await saved(page)).premise).toBe('Murder or suicide, before the noon cart?');

  // A route's problem takes you to the route.
  await select(page,'failed');
  await inspector(page).locator('.way-in').filter({hasText:'Last resort'}).click();
  const lastResort=await editRoute(page,'case-lost');
  await lastResort.getByLabel('Condition',{exact:true}).fill('');
  await expect(problemsTab(page)).toHaveText(/^Problems1$/);
  await problemsTab(page).click();
  await inspector(page).locator('.problem',{hasText:'route case-lost has no condition'}).click();
  await expect(page.locator('.route-card[data-route-id="case-lost"]').getByLabel('Condition',{exact:true})).toBeVisible();
  await page.locator('.route-card[data-route-id="case-lost"]').getByLabel('Condition',{exact:true}).fill('Last resort only.');
  await expect(problemsTab(page)).toHaveText(/^Problems0$/);
  // And a person's problem takes you to their card.
  await tab(page,/^Cast/).click();
  await page.locator('article[data-cast="tull"] .cast-summary').click();
  await page.locator('article[data-cast="tull"]').getByLabel('Why here',{exact:true}).fill('');
  await problemsTab(page).click();
  await inspector(page).locator('.problem',{hasText:'tull has no whyHere'}).click();
  await expect(page.locator('article[data-cast="tull"]').getByLabel('Why here',{exact:true})).toBeVisible();
});

test('reload and find it all saved, the file the game\'s still',async({page})=>{
  await select(page,'cart-arrives');
  await inspector(page).getByLabel('Pressure',{exact:true}).fill('Tull starts loading the body himself.');
  await inspector(page).getByRole('checkbox',{name:'Moll (moll)'}).check();
  await tab(page,/^Scene/).click();
  await inspector(page).getByLabel('Clock',{exact:true}).fill('Noon, and the cart.');
  const before=await savedText(page);
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(clerkPath);
  expect(await savedText(page)).toBe(before);
  const scene=JSON.parse(before);
  expect(node(scene,'cart-arrives').data.pressure).toBe('Tull starts loading the body himself.');
  expect(scene.cast.find((c:any)=>c.id==='moll').enters).toBe('cart-arrives');
  expect(scene.clock).toBe('Noon, and the cart.');
  expect(before).toBe(JSON.stringify(scene,null,2)+'\n');
  await expect(card(page,'cart-arrives')).toContainText('Moll, Corporal Abner Tull arrive');
  await select(page,'cart-arrives');
  await expect(inspector(page).getByLabel('Pressure',{exact:true})).toHaveValue('Tull starts loading the body himself.');
  await expect(problemsTab(page)).toHaveText(/^Problems0$/);
});

test('an ending\'s effects: a form for the story\'s ops, JSON for the rest, kept only once it\'s whole',async({page})=>{
  await select(page,'failed');
  const effects=inspector(page).locator('fieldset.effects');
  const before=node(JSON.parse(clerkText),'failed').data.effects.length;
  await effects.getByLabel('New effects op').selectOption('journal');
  await effects.getByRole('button',{name:'Add effect'}).click();
  const added=effects.getByRole('article',{name:`Effects ${before+1}`});
  await added.getByLabel('Text',{exact:true}).fill('The case went in the pit with Prout.');
  await added.locator('summary').click();
  await added.getByRole('group',{name:'If established'}).getByRole('checkbox',{name:'hobb-at-granary'}).check();
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'journal',text:'The case went in the pit with Prout.',if:{established:'hobb-at-granary'}});
  await effects.getByLabel('New effects op').selectOption('other');
  await effects.getByRole('button',{name:'Add effect'}).click();
  const raw=effects.getByRole('article',{name:`Effects ${before+2}`}).getByLabel('JSON',{exact:true});
  await raw.fill('{"op": "give", "what": ');
  await expect(effects.getByRole('alert')).toContainText('Not JSON yet');
  expect(node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'note',what:'',text:''});
  await raw.fill('{"op": "give", "what": "boots", "to": "$player"}');
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'give',what:'boots',to:'$player'});
});

test('a version 1 scene opens read-only: the format has moved on, and the file is left as it is',async({page})=>{
  const path='Scenes/The Hanged Clerk.kmscene',before=await savedText(page,path);
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  const note=page.getByRole('note',{name:'A version 1 scene file'});
  await expect(note).toContainText('the scene format has moved on');
  await expect(note).toContainText('campaigns/caerwyn/scenes/hanged-clerk.kmscene');
  await expect(page.locator('.scene-card')).toHaveCount(0);
  expect(await savedText(page,path)).toBe(before);
});

test('scene lore links by the game\'s paths, and an ending\'s next scene opens',async({page})=>{
  await tab(page,/^Scene/).click();
  await inspector(page).locator('[data-section="lore"]').getByRole('button',{name:'Link lore'}).click();
  const picker=page.getByRole('dialog',{name:'Lore library'});
  await picker.getByRole('button',{name:'World',exact:true}).click();
  await picker.getByRole('button',{name:'Link World/Centennial Assembly.md'}).click();
  await expect.poll(async()=>(await saved(page)).lore).toEqual(['Places/Granary Yard.md','World/Caerwyn now.md','World/Centennial Assembly.md']);
  await select(page,'murder-unknown');
  await inspector(page).getByRole('button',{name:'Open caerwyn-afternoon'}).click();
  await expect(page.locator('.file-path')).toHaveText('scenes/caerwyn-afternoon.kmscene');
});

test('deleting a node takes its routes and what required it, after asking; undo brings it all back',async({page})=>{
  await select(page,'hobb');
  await inspector(page).getByRole('button',{name:'Delete node'}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Delete node?'});
  await expect(confirmation.getByRole('button',{name:'Cancel'})).toBeFocused();
  await confirmation.getByRole('button',{name:'Delete node'}).click();
  await expect(card(page,'hobb')).toHaveCount(0);
  const scene=await saved(page);
  expect(route(scene,'find-hobb')).toBeUndefined();
  expect(route(scene,'signed-murder').data.requires).toEqual(['murder']);
  expect(route(scene,'signed-suicide').data.requires).toBeUndefined();
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).first().click();
  await expect.poll(()=>savedText(page)).toBe(clerkText);
});

test('several routes between the same two nodes: one connection on the graph, each route its own, with dice and where a failure goes',async({page})=>{
  await select(page,'failed');
  await inspector(page).locator('.route-list button').filter({hasText:'Last resort'}).click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  await inspector(page).getByRole('button',{name:'Add route'}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  const added=await editRoute(page,'to-failed');
  await added.getByLabel('Label',{exact:true}).fill('Caught red-handed');
  await added.getByLabel('Condition',{exact:true}).fill('The player is caught doing what ends the case.');
  await added.getByLabel('Dice',{exact:true}).selectOption('insight');
  await added.getByLabel('DC',{exact:true}).fill('13');
  await added.getByLabel('On failure',{exact:true}).selectOption('cart-arrives');
  await added.getByRole('group',{name:'Establishes'}).getByRole('checkbox',{name:'hobb-at-granary'}).check();
  await expect.poll(async()=>route(await saved(page),'to-failed')).toEqual({id:'to-failed',source:'start',target:'failed',type:'smoothstep',label:'Caught red-handed',
    data:{condition:'The player is caught doing what ends the case.',phase:'outcome',skill:'insight',dc:13,onFailure:'cart-arrives',establishes:['hobb-at-granary']}});
  expect(route(await saved(page),'case-lost')).toEqual(route(JSON.parse(clerkText),'case-lost'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'2 routes · dice'})).toHaveCount(1);
  // No dice, no failure: taking the dice off takes onFailure with it.
  await added.getByLabel('Dice',{exact:true}).selectOption('');
  await expect.poll(async()=>Object.keys(route(await saved(page),'to-failed').data)).toEqual(['condition','phase','skill','dc','establishes']);
  // Removing one route keeps the other, and the connection.
  await page.locator('.route-card[data-route-id="case-lost"]').getByRole('button',{name:'Edit route'}).click();
  await page.locator('.route-card[data-route-id="case-lost"]').getByRole('button',{name:'Remove route'}).click();
  await page.getByRole('alertdialog',{name:'Remove route?'}).getByRole('button',{name:'Remove route'}).click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  expect(route(await saved(page),'case-lost')).toBeUndefined();
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).first().click();
  await expect.poll(async()=>route(await saved(page),'case-lost')).toEqual(route(JSON.parse(clerkText),'case-lost'));
});

test('drawing a route between two nodes adds one, its id made from where it goes',async({page})=>{
  const from=card(page,'motive').locator('.react-flow__handle.source'),to=card(page,'failed').locator('.react-flow__handle.target');
  await settled(card(page,'motive'));
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
  await expect.poll(async()=>route(await saved(page),'to-failed')).toEqual({id:'to-failed',source:'motive',target:'failed',type:'smoothstep',label:'Failed',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  await expect(problemsTab(page)).toHaveText(/^Problems1$/);
  await expect(page.locator('.route-card[data-route-id="to-failed"]').getByLabel('Condition',{exact:true})).toBeVisible();
});

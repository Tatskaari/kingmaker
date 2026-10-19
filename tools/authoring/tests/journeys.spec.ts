import {test,expect,type Page,type Locator} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// The scene editor on the game's own campaign: the browser harness's vault is campaigns/caerwyn (its
// scenes, places, scenario and lore), and every journey asserts the scene file as saved.
const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const clerkPath='scenes/hanged-clerk.kmscene';
const clerkText=await readFile(new URL(clerkPath,CAMPAIGN),'utf8');
const clerk=()=>JSON.parse(clerkText);
const SCENES=['caerwyn-afternoon','drowned-rat','hanged-clerk','heron-warehouse','kings-morning','talk','wharf-night'];
/** The via warnings on each real scene (nine in four scenes: scene-model.test.mjs has them). */
const WARNINGS:Record<string,number>={'hanged-clerk':2,'drowned-rat':4,'heron-warehouse':1,'kings-morning':1};

const files=(page:Page)=>page.evaluate(()=>({...(window as any).__kingmakerHarness.files}) as Record<string,string>);
const savedText=(page:Page,path=clerkPath)=>page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,path);
const saved=async(page:Page,path=clerkPath)=>JSON.parse(await savedText(page,path));
const node=(scene:any,id:string)=>scene.nodes.find((n:any)=>n.id===id);
const route=(scene:any,id:string)=>scene.edges.find((e:any)=>e.id===id);
const person=(scene:any,id:string)=>scene.cast.find((c:any)=>c.id===id);
const card=(page:Page,id:string)=>page.locator(`.scene-card[data-node-id="${id}"]`);
const inspector=(page:Page)=>page.locator('.scene-inspector .inspector-body');
/** One of the views under the scene's title: Graph, Scene, Cast, Facts, Problems. */
const view=(page:Page,name:string)=>page.getByRole('tablist',{name:'Views of the scene'}).getByRole('tab',{name:new RegExp(`^${name}`)});
const problems=(page:Page,count:number)=>expect(view(page,'Problems')).toHaveAttribute('aria-label',`Problems (${count})`);
const undo=(page:Page)=>page.getByRole('button',{name:'Undo',exact:true}).click();
const open=async(page:Page,path:string)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(path);
  await expect(page.locator('.file-path')).toHaveText(path);
};
/** Click a node's card once the graph has settled where it'll stay. */
const select=async(page:Page,id:string)=>{
  if(await view(page,'Graph').getAttribute('aria-selected')!=='true')await view(page,'Graph').click();
  const target=card(page,id);
  await expect(target).toBeVisible();
  await settled(target);
  // On its header, clear of the result badge, wherever the graph's zoom has put it.
  const box=(await target.boundingBox())!;
  await target.click({position:{x:box.width/2,y:Math.min(10,box.height/5)}});
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
/** [+ Add …] opened, and an option of it picked. */
const pick=async(within:Locator,add:string,option:RegExp|string)=>{
  await within.getByRole('button',{name:add,exact:true}).click();
  await within.locator('.add-picker').getByRole('button',{name:option}).click();
};

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText(clerkPath);
  await problems(page,0);
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
    await problems(page,0);
    // The via warnings (M4's: a path via something the scene's place hasn't got) are counted beside the problems.
    const warned=WARNINGS[id]??0;
    await expect(page.locator('.problems-link')).toHaveText(`No problems${warned?` · ${warned} warning${warned===1?'':'s'}`:''}`);
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

test('the inspector is what\'s selected on the graph and nothing else; the scene\'s own views are in the bar under its title',async({page})=>{
  await expect(inspector(page)).toContainText('Select a node or a route on the graph');
  await expect(page.locator('.scene-inspector [role=tab]')).toHaveCount(0);
  await expect(page.getByRole('tablist',{name:'Views of the scene'}).getByRole('tab')).toHaveText(['Graph','Scene','Cast5','Facts3','Problems0']);
  await select(page,'cart-arrives');
  await expect(page.locator('.inspector-top')).toHaveText('Event');
  // Each view has the main area; the inspector is the graph's.
  for(const [name,within] of [['Scene','.scene-view'],['Cast','.cast-view'],['Facts','.facts-view'],['Problems','.problems-view']]){
    await view(page,name).click();
    await expect(page.locator(within)).toBeVisible();
    await expect(page.locator('.scene-inspector')).toHaveCount(0);
  }
  // The bar is keyboard-reachable: the chosen view is a tab stop, and the arrows move along it.
  await view(page,'Problems').focus();
  await page.keyboard.press('ArrowRight');
  await expect(view(page,'Graph')).toBeFocused();
  await expect(view(page,'Graph')).toHaveAttribute('aria-selected','true');
  await expect(page.locator(`.node-inspector[data-node="cart-arrives"]`)).toBeVisible();
  await page.keyboard.press('End');
  await expect(view(page,'Problems')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowLeft');
  await expect(view(page,'Facts')).toHaveAttribute('aria-selected','true');
  // The view is remembered for the file while it's open: another file and back, and it's still the Facts.
  await view(page,'Cast').click();
  await open(page,'scenes/drowned-rat.kmscene');
  await expect(view(page,'Graph')).toHaveAttribute('aria-selected','true');
  await open(page,clerkPath);
  await expect(view(page,'Cast')).toHaveAttribute('aria-selected','true');
  expect(await savedText(page)).toBe(clerkText);
});

test('in a pane half a screen wide the inspector lies over the graph: what\'s selected slides clear of it, a fit fits beside it, and the minimap is put away',async({page})=>{
  await page.setViewportSize({width:700,height:900});
  await page.getByRole('button',{name:'Fit graph'}).click();
  await expect(page.locator('.react-flow__minimap')).toBeHidden();
  await expect(page.locator('.scene-inspector')).toBeHidden();
  // An ending at the graph's right edge, clicked where it is, slides into the strip beside the inspector, at the zoom it was.
  const ending=card(page,'murder-unknown');
  await settled(ending);
  const zoom=await page.locator('.react-flow__viewport').evaluate(element=>getComputedStyle(element).transform);
  await ending.click({position:{x:30,y:10}});
  await expect(page.locator('.node-inspector[data-node="murder-unknown"]')).toBeVisible();
  const aside=(await page.locator('.scene-inspector').boundingBox())!;
  await expect.poll(async()=>{await settled(ending);const box=(await ending.boundingBox())!;return box.x>=0&&box.x+box.width<=aside.x}).toBe(true);
  expect((await page.locator('.react-flow__viewport').evaluate(element=>getComputedStyle(element).transform)).split(',')[0]).toBe(zoom.split(',')[0]);
  // A fit, from the bar or the graph's own controls, fits every card beside it.
  for(const button of [page.getByRole('button',{name:'Fit graph'}),page.getByRole('button',{name:'Fit View'})]){
    await page.getByRole('button',{name:'Zoom In'}).click();
    await button.click();
    for(const id of clerk().nodes.map((n:any)=>n.id)){
      await settled(card(page,id));
      const each=(await card(page,id).boundingBox())!;
      expect(each.x,id).toBeGreaterThanOrEqual(0);
      expect(each.x+each.width,id).toBeLessThanOrEqual(aside.x);
    }
  }
  // While a route is drawn it stands aside, so the node it goes to can be clicked wherever it is; then it's the new route's.
  await page.getByRole('button',{name:'Zoom In'}).click();
  await select(page,'start');
  await inspector(page).getByRole('button',{name:'Add route to…'}).click();
  await expect(page.locator('.scene-inspector')).toBeHidden();
  await settled(card(page,'murder-unknown'));
  await card(page,'murder-unknown').click({position:{x:30,y:10}});
  await expect.poll(async()=>(await saved(page)).edges.at(-1).id).toBe('to-murder-unknown');
  await expect(page.locator('.scene-inspector .route-card[data-route-id="to-murder-unknown"]')).toBeVisible();
  // Put away by a click on the graph's background, it covers nothing.
  await page.locator('.react-flow__pane').click({position:{x:5,y:5}});
  await expect(page.locator('.scene-inspector')).toBeHidden();
  await page.screenshot({path:'dist/screenshots/scene-narrow.png'});
  // A double-click on a node where the inspector will lie still opens its larger editor: its second click finds the node where it was.
  await page.getByRole('button',{name:'Fit graph'}).click();
  await settled(card(page,'failed'));
  await card(page,'failed').dblclick({position:{x:30,y:10}});
  await expect(page.getByRole('dialog',{name:'Edit node'})).toBeVisible();
});

test('an ending\'s result and exit kind are at the top of its inspector, and its badge on the graph opens them',async({page})=>{
  await select(page,'failed');
  const body=inspector(page);
  const result=body.getByRole('group',{name:'Result'});
  await expect(result.getByRole('radio',{name:'Bad'})).toBeChecked();
  await expect(result).toContainText('A last resort');
  // Result and exit kind come before the ending's prose.
  const [resultBox,proseBox]=await Promise.all([result.boundingBox(),body.getByLabel('What\'s true',{exact:true}).boundingBox()]);
  expect(resultBox!.y).toBeLessThan(proseBox!.y);
  await result.getByRole('radio',{name:'Mixed'}).check();
  await expect.poll(async()=>node(await saved(page),'failed').data.result).toBe('mixed');
  await expect(result).toContainText('They got some of it');
  await expect(card(page,'failed')).toHaveClass(/result-mixed/);
  await expect(body.getByLabel('Exit kind',{exact:true}).locator('option')).toContainText(['Combat: it ends in a fight','Persuaded: someone is talked round','Progress: the story moves on','Leave: the player walks away, or is sent away','Other: none of these']);
  await body.getByLabel('Exit kind',{exact:true}).selectOption('leave');
  await expect.poll(async()=>node(await saved(page),'failed').data.exitKind).toBe('leave');
  // From the badge: another ending, its result focused.
  await card(page,'murder-unknown').getByRole('button',{name:'Result: good. Change it'}).click();
  await expect(page.locator('.node-inspector[data-node="murder-unknown"]')).toBeVisible();
  await expect(inspector(page).getByRole('radio',{name:'Good'})).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async()=>node(await saved(page),'murder-unknown').data.result).toBe('mixed');
  await expect(card(page,'murder-unknown').getByRole('button',{name:/^Result: mixed/})).toHaveText('mixed');
  const scene=await saved(page),original=clerk();
  expect(Object.keys(node(scene,'failed').data)).toEqual(Object.keys(node(original,'failed').data));
  expect({...scene,nodes:scene.nodes.map((n:any)=>({...n,data:{...n.data,result:undefined,exitKind:undefined}}))}).toEqual({...original,nodes:original.nodes.map((n:any)=>({...n,data:{...n.data,result:undefined,exitKind:undefined}}))});
});

test('an event: add an arrival, a role and a pressure, and remove them',async({page})=>{
  await select(page,'cart-arrives');
  const body=inspector(page);
  // Who arrives here: chips, each removable; a person picked from the cast, one arriving elsewhere moved.
  const arrivals=body.locator('[data-field="arrivals"]');
  await expect(arrivals.getByRole('list',{name:'Who arrives here'}).getByRole('listitem')).toHaveText(['Corporal Abner Tull']);
  await arrivals.getByRole('button',{name:'Add person',exact:true}).click();
  await expect(arrivals.locator('.add-picker')).toContainText('Here from the start now');
  await arrivals.locator('.add-picker').getByRole('button',{name:/^Moll \(moll\)/}).click();
  await expect.poll(async()=>person(await saved(page),'moll').enters).toBe('cart-arrives');
  await arrivals.getByRole('button',{name:'Remove Corporal Abner Tull'}).click();
  await expect.poll(async()=>'enters' in person(await saved(page),'tull')).toBe(false);
  await expect(card(page,'cart-arrives')).toContainText('Moll arrives');
  // Conversation roles: only the people with one; [+ Add role] for anyone else, written once it has words.
  const roles=body.locator('[data-field="cast"]');
  await expect(roles.getByRole('article')).toHaveCount(4);
  await roles.getByRole('button',{name:'Remove Cob\'s role'}).click();
  await expect.poll(async()=>Object.keys(node(await saved(page),'cart-arrives').data.cast)).toEqual(['tull','kell','moll']);
  await pick(roles,'Add role',/^Cob \(cob\)/);
  const cob=roles.getByLabel('Cob (cob)',{exact:true});
  await expect(cob).toBeFocused();
  expect(Object.keys(node(await saved(page),'cart-arrives').data.cast)).toEqual(['tull','kell','moll']);
  await cob.fill('Sidles up to the cart to look at the boots.');
  await expect.poll(async()=>node(await saved(page),'cart-arrives').data.cast).toEqual({...node(clerk(),'cart-arrives').data.cast,cob:undefined,...{cob:'Sidles up to the cart to look at the boots.'}});
  expect(Object.keys(node(await saved(page),'cart-arrives').data.cast)).toEqual(['tull','kell','moll','cob']);
  // A role emptied is taken out as it's left.
  await cob.fill('');
  await body.getByLabel('Title',{exact:true}).focus();
  await expect(roles.getByRole('article')).toHaveCount(3);
  await expect.poll(async()=>'cob' in node(await saved(page),'cart-arrives').data.cast).toBe(false);
  // Pressure: an optional part, removed and added again.
  await body.getByRole('button',{name:'Remove pressure'}).click();
  await expect.poll(async()=>'pressure' in node(await saved(page),'cart-arrives').data).toBe(false);
  await body.getByRole('button',{name:'Add pressure'}).click();
  await expect(body.getByRole('textbox',{name:'Pressure',exact:true})).toBeFocused();
  await page.keyboard.type('Tull starts loading the body himself.');
  await expect.poll(async()=>node(await saved(page),'cart-arrives').data.pressure).toBe('Tull starts loading the body himself.');
  expect(Object.keys(node(await saved(page),'cart-arrives').data)).toEqual(Object.keys(node(clerk(),'cart-arrives').data));
  await page.screenshot({path:'dist/screenshots/scene-event.png'});
});

test('the porters\' noon break, its cue and Old Wat, as the others are: an event with its arrival, roles and pressure, a cue whose outer limit counts from the cart until the lead, and a person renamed everywhere',async({page})=>{
  // On the graph: an event card, clear of the others, saying who arrives; its cue a connection from the cart.
  await settled(card(page,'porters-break'));
  const boxes=await page.locator('.scene-card').evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return {id:(card as HTMLElement).dataset.nodeId,left:box.left,top:box.top,right:box.right,bottom:box.bottom}}));
  const mine=boxes.find(box=>box.id==='porters-break')!;
  expect(boxes.filter(box=>box!==mine&&box.left<mine.right&&mine.left<box.right&&box.top<mine.bottom&&mine.top<box.bottom).map(box=>box.id)).toEqual([]);
  await expect(card(page,'porters-break')).toHaveClass(/\bevent\b/);
  await expect(card(page,'porters-break')).toContainText('Old Wat arrives');
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'The porters\' break'})).toHaveCount(1);
  await select(page,'porters-break');
  const body=inspector(page);
  await expect(page.locator('.inspector-top')).toHaveText('Event');
  await expect(body.locator('[data-field="arrivals"]').getByRole('list',{name:'Who arrives here'}).getByRole('listitem')).toHaveText(['Old Wat']);
  const roles=body.locator('[data-field="cast"]');
  await expect(roles.getByRole('article')).toHaveCount(5);
  await expect(roles.getByLabel('Old Wat (wat)',{exact:true})).toHaveValue(node(clerk(),'porters-break').data.cast.wat);
  await expect(body.getByRole('textbox',{name:'Pressure',exact:true})).toHaveValue(node(clerk(),'porters-break').data.pressure);
  await body.getByRole('textbox',{name:'Pressure',exact:true}).fill('The porters drift back to the far gate.');
  await expect.poll(async()=>node(await saved(page),'porters-break').data.pressure).toBe('The porters drift back to the far gate.');
  // Its cue: a route card with its outer limit, four exchanges after the cart, until the lead.
  await body.locator('[data-field="routes"] button').filter({hasText:'The porters\' break'}).click();
  const cue=await editRoute(page,'porters-come');
  await expect(cue.getByRole('radio',{name:'Cue'})).toBeChecked();
  await expect(cue.locator('.way-badges')).toContainText('By 4 exchanges after The dead-cart arrives (until Hobb was spotted at the scene)');
  const count=cue.locator('section[data-field="limit"]').getByRole('article',{name:'Count 1'});
  await expect(count.getByLabel('Exchanges',{exact:true})).toHaveValue('4');
  await expect(count.getByLabel('Counted from',{exact:true})).toHaveValue('cart-arrives');
  await expect(count.locator('[data-field="until"]').getByRole('listitem')).toHaveText([/^Hobb was spotted at the scene/]);
  await count.getByLabel('Exchanges',{exact:true}).fill('5');
  await expect.poll(async()=>route(await saved(page),'porters-come').data.limit).toEqual([{exchanges:5,after:'cart-arrives',until:['hobb']}]);
  // Old Wat in the Cast view: what the player calls him, where the scene uses him, and his id renamed everywhere it's named.
  await view(page,'Cast').click();
  const pick_=page.locator('.cast-pick',{hasText:'Old Wat'});
  await expect(pick_).toContainText('“the old porter”');
  await expect(pick_).toContainText('Arrives at The porters\' noon break');
  await pick_.click();
  const wat=page.locator('section[data-cast="wat"]');
  await expect(wat.locator('.cast-uses')).toContainText('Arrives at The porters\' noon break');
  await expect(wat.locator('.cast-uses')).toContainText('Has a conversation role at The porters\' noon break');
  await expect(wat.locator('.cast-uses')).toContainText('Holds 1 path: Hobb was spotted at the scene (path 3)');
  await wat.getByRole('button',{name:'Rename id wat'}).click();
  await wat.getByLabel('New id',{exact:true}).fill('old-wat');
  await wat.getByRole('button',{name:'Rename',exact:true}).click();
  await expect(page.locator('section[data-cast="old-wat"]')).toBeVisible();
  const after=await saved(page);
  expect(person(after,'old-wat').enters).toBe('porters-break');
  expect(Object.keys(node(after,'porters-break').data.cast)).toEqual(['old-wat','kell','tull','cob','moll']);
  expect(node(after,'hobb').data.paths.map((path:any)=>path.via)).toEqual(['cob','moll','old-wat','kell']);
  await problems(page,0);
  // Undone a step at a time, the file is the clerk's again.
  await undo(page);
  await undo(page);
  await undo(page);
  await expect.poll(()=>savedText(page)).toBe(clerkText);
});

test('a fact made in place from an event, then in the Facts view with where it\'s settled; one undo takes both',async({page})=>{
  await select(page,'cart-arrives');
  const facts=inspector(page).locator('[data-field="establishes"]');
  await facts.getByRole('button',{name:'Add fact',exact:true}).click();
  const picker=facts.getByRole('group',{name:'Add a fact'});
  await expect(picker.getByRole('button',{name:/^killed-not-suicide/})).toBeVisible();
  const form=picker.getByRole('group',{name:'A new fact'});
  await form.getByLabel('Sentence',{exact:true}).fill('Tull has the Captain\'s written order to close it as a suicide.');
  await expect(form).toContainText('tull-has-the-captains-written-order');
  await form.getByLabel('Id',{exact:true}).fill('captains-order');
  await form.getByRole('button',{name:'Add new fact'}).click();
  await expect.poll(async()=>(await saved(page)).facts['captains-order']).toBe('Tull has the Captain\'s written order to close it as a suicide.');
  expect(node(await saved(page),'cart-arrives').data.establishes).toEqual(['captains-order']);
  expect(Object.keys((await saved(page)).facts)).toEqual(['killed-not-suicide','motive-known','hobb-at-granary','captains-order']);
  await expect(facts.locator('.fact-row')).toHaveText([/captains-order.*Tull has the Captain's written order/]);
  // The Facts view: the sentence, and where it's settled, which opens it on the graph.
  await facts.getByRole('button',{name:/^captains-order/}).click();
  await expect(view(page,'Facts')).toHaveAttribute('aria-selected','true');
  const fact=page.locator('.facts-view [data-fact="captains-order"]');
  await expect(fact.getByLabel('Sentence',{exact:true})).toBeFocused();
  await expect(fact.getByRole('list',{name:'Where captains-order is settled'})).toHaveText(['Event · The dead-cart arrives']);
  await expect(fact).toContainText('No effect tests it.');
  await page.screenshot({path:'dist/screenshots/scene-facts.png'});
  await fact.getByRole('button',{name:'Event · The dead-cart arrives'}).click();
  await expect(view(page,'Graph')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.node-inspector[data-node="cart-arrives"]')).toBeVisible();
  await expect(inspector(page).locator('[data-field="establishes"] .fact-open')).toBeFocused();
  // Made and settled in one edit: one undo takes both.
  await undo(page);
  await expect.poll(()=>savedText(page)).toBe(clerkText);
});

test('a fact renamed follows everywhere it\'s named; removed, after asking, it leaves them',async({page})=>{
  await view(page,'Facts').click();
  const motive=page.locator('.facts-view [data-fact="motive-known"]');
  await expect(motive.getByRole('list',{name:'Where motive-known is tested'}).getByRole('listitem')).toHaveText([
    'Ending · Murder by persons unknown · effect 2 (quest), only if settled',
    'Ending · Suicide, under suspicious circumstances · effect 2 (quest), only if settled',
  ]);
  await motive.getByRole('button',{name:'Rename fact id motive-known'}).click();
  await motive.getByLabel('New fact id',{exact:true}).fill('Motive found');
  await expect(motive).toContainText('An id is a slug');
  await expect(motive.getByRole('button',{name:'Rename',exact:true})).toBeDisabled();
  await motive.getByLabel('New fact id',{exact:true}).fill('hobb-at-granary');
  await expect(motive).toContainText('hobb-at-granary is taken.');
  await motive.getByLabel('New fact id',{exact:true}).fill('motive-found');
  await page.keyboard.press('Enter');
  await expect.poll(async()=>Object.keys((await saved(page)).facts)).toEqual(['killed-not-suicide','motive-found','hobb-at-granary']);
  let scene=await saved(page);
  expect(node(scene,'motive').data.establishes).toEqual(['motive-found']);
  expect(node(scene,'murder-unknown').data.effects[1].if).toEqual({established:'motive-found'});
  expect(node(scene,'suspicious').data.effects[1].if).toEqual({established:'motive-found'});
  await expect(page.locator('.facts-view [data-fact="motive-found"] [data-field="sentence"] textarea')).toBeFocused();
  // Its test opens the effect.
  await page.locator('.facts-view [data-fact="motive-found"]').getByRole('button',{name:/^Ending · Suicide, under suspicious circumstances · effect 2/}).click();
  await expect(page.locator('.node-inspector[data-node="suspicious"] [data-field="effects.1"]')).toBeVisible();
  await expect(page.locator('.node-inspector[data-node="suspicious"] [data-field="effects.1"] [data-field="if"]')).toContainText('motive-found');
  // Removed: out of the facts, its establishes and its conditions.
  await view(page,'Facts').click();
  await page.getByRole('button',{name:'Remove fact motive-found'}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Remove fact?'});
  await expect(confirmation).toContainText('Motive: supplies are being embezzled settles it');
  await expect(confirmation).toContainText('2 effects test it');
  await confirmation.getByRole('button',{name:'Remove fact'}).click();
  await expect.poll(async()=>Object.keys((await saved(page)).facts)).toEqual(['killed-not-suicide','hobb-at-granary']);
  scene=await saved(page);
  expect('establishes' in node(scene,'motive').data).toBe(false);
  expect('if' in node(scene,'murder-unknown').data.effects[1]).toBe(false);
  await problems(page,0);
  await undo(page);
  await undo(page);
  await expect.poll(()=>savedText(page)).toBe(clerkText);
});

test('the Scene view: the scene\'s own fields, grouped, each edited where it is',async({page})=>{
  await view(page,'Scene').click();
  const scene=page.locator('.scene-view');
  await expect(scene.getByRole('region')).toHaveText([/^The scene/,/^What the player knows/,/^The prep/,/^When and where/,/^Music/,/^The world/,/^The story/,/^Lore/]);
  await expect(scene.getByRole('region',{name:'What the player knows'}).getByLabel('Hook',{exact:true})).toHaveValue(clerk().hook);
  await scene.getByRole('region',{name:'The prep'}).getByLabel('Premise',{exact:true}).fill('Murder or suicide, before the noon cart?');
  await scene.getByRole('region',{name:'When and where'}).getByLabel('Time',{exact:true}).selectOption('afternoon');
  await scene.getByRole('region',{name:'When and where'}).getByRole('checkbox',{name:'Milestone'}).check();
  const world=scene.getByRole('region',{name:'The world'});
  await world.getByRole('button',{name:'Add what locals know'}).click();
  await expect(world.getByLabel('Known 1',{exact:true})).toBeFocused();
  await page.keyboard.type('The noon bell is the Assembly bell.');
  await expect.poll(async()=>(await saved(page)).known.at(-1)).toBe('The noon bell is the Assembly bell.');
  const after=await saved(page);
  expect(after.premise).toBe('Murder or suicide, before the noon cart?');
  expect(after.time).toBe('afternoon');
  expect(after.known).toEqual(['The noon bell is the Assembly bell.']);
  expect(after.milestone).toBe(true);
  // Keys new to the file go where the format puts them.
  expect(Object.keys(after)).toEqual(['format','version','kind','id','title','description','lore','time','place','milestone','hook','setting','premise','truth','clock','limits','known','cast','facts','onStart','onEnd','afterwards','fronts','nodes','edges']);
  await page.screenshot({path:'dist/screenshots/scene-view.png'});
  // The effects as it starts are forms, as the endings' are: the clerk starts its quest with the King's request.
  const story=scene.getByRole('region',{name:'The story'});
  const start=story.locator('[data-field="onStart"]');
  const quest=start.getByRole('article',{name:'As it starts 1'});
  await expect(quest.getByLabel('Op',{exact:true})).toHaveValue('quest');
  await expect(quest.getByLabel('Quest',{exact:true})).toHaveValue('hanged-clerk');
  await expect(quest.getByLabel('Step',{exact:true})).toHaveValue('start');
  await expect(quest.getByLabel('Journal text',{exact:true})).toHaveValue(clerk().onStart[0].text);
  await quest.getByLabel('Journal text',{exact:true}).fill('The King asked you to see Wendell Prout done right by.');
  await expect.poll(async()=>(await saved(page)).onStart).toEqual([{...clerk().onStart[0],text:'The King asked you to see Wendell Prout done right by.'}]);
  await pick(start,'Add effect',/^Journal/);
  await start.getByRole('article',{name:'As it starts 2'}).getByLabel('Text',{exact:true}).fill('Kell is waiting in the yard.');
  await expect.poll(async()=>(await saved(page)).onStart.at(-1)).toEqual({op:'journal',text:'Kell is waiting in the yard.'});
  await start.getByRole('button',{name:'Remove effect 2'}).click();
  await expect.poll(async()=>(await saved(page)).onStart).toHaveLength(1);
  // Taken out whole, the key goes; given again, it goes back before onEnd; two undos bring the quest back.
  await start.getByRole('button',{name:'Remove effect 1'}).click();
  await expect.poll(async()=>'onStart' in await saved(page)).toBe(false);
  await expect(start).toContainText('None.');
  await pick(start,'Add effect',/^Journal/);
  await expect.poll(async()=>(await saved(page)).onStart).toEqual([{op:'journal',text:''}]);
  expect(Object.keys(await saved(page))).toEqual(Object.keys(after));
  await undo(page);
  await undo(page);
  await expect.poll(async()=>(await saved(page)).onStart).toEqual([{...clerk().onStart[0],text:'The King asked you to see Wendell Prout done right by.'}]);
  // The effects on every ending are forms here too, and the world ops afterwards a draft until they say what they act on.
  await expect(story.locator('[data-field="onEnd"]').getByLabel('Who',{exact:true})).toHaveValue('kell');
  const afterwards=story.locator('[data-field="afterwards"]');
  await pick(afterwards,'Add world op',/^Destroy/);
  await expect(afterwards.getByRole('article',{name:'New afterwards'})).toContainText('It\'s saved once it says what it acts on.');
  expect((await saved(page)).afterwards).toEqual(clerk().afterwards);
  await afterwards.getByRole('article',{name:'New afterwards'}).getByLabel('What',{exact:true}).fill('smashed-lantern');
  await expect.poll(async()=>(await saved(page)).afterwards.at(-1)).toEqual({op:'destroy',what:'smashed-lantern'});
  await expect(afterwards.getByRole('article',{name:'Afterwards 2'}).getByLabel('What',{exact:true})).toBeFocused();
});

test('click a problem and land on it: the scene\'s field, a node\'s, a route\'s and a person\'s, focused',async({page})=>{
  await view(page,'Scene').click();
  await page.locator('.scene-view').getByLabel('Premise',{exact:true}).fill('');
  await problems(page,1);
  await expect(page.locator('.problems-link')).toHaveText('1 problem · 2 warnings');
  await page.locator('.problems-link').click();
  await expect(view(page,'Problems')).toHaveAttribute('aria-selected','true');
  await page.locator('.problem',{hasText:'it has no premise'}).click();
  await expect(page.locator('.scene-view').getByLabel('Premise',{exact:true})).toBeFocused();
  await page.keyboard.type('Murder or suicide, before the noon cart?');
  await problems(page,0);
  // An ending's closing: the node selected on the graph, the field focused.
  await select(page,'failed');
  await inspector(page).getByLabel('Closing',{exact:true}).fill('');
  await view(page,'Problems').click();
  await expect(page.locator('.problem',{hasText:'ending failed has no closing'})).toContainText('Node · Failed · Closing');
  await page.locator('.problem',{hasText:'ending failed has no closing'}).click();
  await expect(page.locator('.node-inspector[data-node="failed"]').getByLabel('Closing',{exact:true})).toBeFocused();
  await page.keyboard.type('Kell shrugs.');
  // A route's condition.
  await inspector(page).locator('.way-in').filter({hasText:'Last resort'}).click();
  const lastResort=await editRoute(page,'case-lost');
  await lastResort.getByLabel('Condition',{exact:true}).fill('');
  await view(page,'Problems').click();
  await page.locator('.problem',{hasText:'route case-lost has no condition'}).click();
  await expect(page.locator('.route-card[data-route-id="case-lost"]').getByLabel('Condition',{exact:true})).toBeFocused();
  await page.keyboard.type('Last resort only.');
  // A person's why here: their card in the Cast view.
  await view(page,'Cast').click();
  await page.locator('.cast-pick',{hasText:'Corporal Abner Tull'}).click();
  await page.locator('section[data-cast="tull"]').getByLabel('Why here',{exact:true}).fill('');
  await view(page,'Problems').click();
  await page.locator('.problem',{hasText:'tull has no whyHere'}).click();
  await expect(page.locator('section[data-cast="tull"]').getByLabel('Why here',{exact:true})).toBeFocused();
  await page.keyboard.type('The Captain sent him.');
  await problems(page,0);
});

test('a discovery\'s path and its roll, as a card with [+ Add a roll]',async({page})=>{
  await select(page,'murder');
  const path=inspector(page).getByRole('article',{name:'Path 3'});
  await path.getByLabel('Clue',{exact:true}).fill('Rope burn on the wrists, and the knot is a docker\'s.');
  await path.getByRole('radio',{name:'Proof'}).check();
  await path.getByRole('button',{name:'Add a roll'}).click();
  await expect(path.getByLabel('Skill',{exact:true})).toBeFocused();
  expect('check' in node(await saved(page),'murder').data.paths[2]).toBe(false);
  await path.getByLabel('Skill',{exact:true}).selectOption('medicine');
  await path.getByLabel('DC',{exact:true}).fill('14');
  await expect.poll(async()=>node(await saved(page),'murder').data.paths[2].check).toEqual({skill:'medicine',dc:14});
  const scene=await saved(page),edited=node(scene,'murder').data.paths[2];
  expect(Object.keys(edited)).toEqual(['via','clue','earn','strength','check']);
  expect(edited).toMatchObject({clue:'Rope burn on the wrists, and the knot is a docker\'s.',strength:'proof'});
  const original=clerk();
  expect(node(scene,'murder').data.paths[0]).toEqual(node(original,'murder').data.paths[0]);
  expect({...scene,nodes:scene.nodes.filter((n:any)=>n.id!=='murder')}).toEqual({...original,nodes:original.nodes.filter((n:any)=>n.id!=='murder')});
  // Taking the roll off takes the key out; typing in one field is one step of undo.
  await path.getByRole('button',{name:'Remove roll'}).click();
  await expect.poll(async()=>'check' in node(await saved(page),'murder').data.paths[2]).toBe(false);
  await undo(page);
  await expect.poll(async()=>node(await saved(page),'murder').data.paths[2].check).toEqual({skill:'medicine',dc:14});
  // Paths move up and down, and a new one comes with its via focused.
  await inspector(page).getByRole('button',{name:'Move Path 3 up'}).click();
  await expect.poll(async()=>node(await saved(page),'murder').data.paths[1].clue).toBe('Rope burn on the wrists, and the knot is a docker\'s.');
  await inspector(page).getByRole('button',{name:'Add path'}).click();
  await expect(inspector(page).getByRole('article',{name:'Path 6'}).getByLabel('Via',{exact:true})).toBeFocused();
  await expect.poll(async()=>node(await saved(page),'murder').data.paths.at(-1)).toEqual({via:'',clue:'',earn:'',strength:'suggestive'});
});

test('add a discovery and route it from the start, its ids slugs of its title; a beat becomes an event and back',async({page})=>{
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
  // The route into it was labelled from its title, and keeps up with it.
  expect(route(scene,'find-the-tally-loft')).toEqual({id:'find-the-tally-loft',source:'start',target:'the-tally-loft',type:'smoothstep',label:'Find Up in the tally loft',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  await expect(card(page,'the-tally-loft')).toContainText('Up in the tally loft');
  await problems(page,2);
  await view(page,'Problems').click();
  await expect(page.locator('.problems-view .problem')).toHaveText([/the-tally-loft has no description/,/discovery the-tally-loft has 0 paths/]);
  // Its kind: an event, after asking (its revelation goes), and a discovery again.
  await select(page,'the-tally-loft');
  await inspector(page).getByRole('radio',{name:'Event'}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Make it an event?'});
  await expect(confirmation).toContainText('Its revelation goes');
  await confirmation.getByRole('button',{name:'Make it an event'}).click();
  await expect.poll(async()=>node(await saved(page),'the-tally-loft').data).toEqual({kind:'beat',title:'Up in the tally loft',description:'',lore:[]});
  await expect(card(page,'the-tally-loft')).toHaveClass(/\bevent\b/);
  await inspector(page).getByRole('radio',{name:'Discovery'}).check();
  await expect.poll(async()=>node(await saved(page),'the-tally-loft').data).toEqual({kind:'beat',title:'Up in the tally loft',description:'',revelation:'',paths:[],lore:[]});
  // An ending too, and back: nothing written goes, so nothing's asked.
  await inspector(page).getByRole('radio',{name:'Ending'}).check();
  await expect.poll(async()=>node(await saved(page),'the-tally-loft').data).toEqual({kind:'exit',title:'Up in the tally loft',description:'',closing:'',result:'good',exitKind:'progress',lore:[]});
  await expect(card(page,'the-tally-loft')).toHaveClass(/\bending\b/);
  await expect(inspector(page).getByRole('radio',{name:'Good'})).toBeChecked();
  await inspector(page).getByRole('radio',{name:'Discovery'}).check();
  await expect.poll(async()=>node(await saved(page),'the-tally-loft').data).toEqual({kind:'beat',title:'Up in the tally loft',description:'',revelation:'',paths:[],lore:[]});
  // Its id, renamed only by asking: the route into it follows.
  await inspector(page).getByRole('button',{name:'Rename id the-tally-loft'}).click();
  await inspector(page).getByLabel('New id',{exact:true}).fill('loft');
  await inspector(page).getByRole('button',{name:'Rename',exact:true}).click();
  await expect.poll(async()=>route(await saved(page),'find-the-tally-loft').target).toBe('loft');
  await expect(page.locator('.node-inspector[data-node="loft"]')).toBeVisible();
  await expect(card(page,'loft')).toBeVisible();
});

test('an ending made a beat, and a beat an ending: asked first, what the new kind has no use for goes, and what named it as the old one',async({page})=>{
  // The failed ending made an event: its closing and effects go.
  await select(page,'failed');
  await inspector(page).getByRole('radio',{name:'Event'}).click();
  const asked=page.getByRole('alertdialog',{name:'Make it an event?'});
  await expect(asked).toContainText('Its closing and its 4 effects go: only an ending has them.');
  await asked.getByRole('button',{name:'Make it an event'}).click();
  await expect.poll(async()=>node(await saved(page),'failed').data).toEqual({kind:'beat',title:'Failed',description:node(clerk(),'failed').data.description,lore:[]});
  await expect(card(page,'failed')).toHaveClass(/\bevent\b/);
  await undo(page);
  await expect.poll(async()=>node(await saved(page),'failed').data).toEqual(node(clerk(),'failed').data);
  // The dead-cart made an ending: its stage goes, and its routes out with it (no route leaves an ending).
  await select(page,'cart-arrives');
  await inspector(page).getByRole('radio',{name:'Ending'}).click();
  const ending=page.getByRole('alertdialog',{name:'Make it an ending?'});
  await expect(ending).toContainText('Its pressure, its 4 conversation roles, its 1 arrival (they\'re here from the start instead) and its 3 routes out (no route leaves an ending) go');
  await ending.getByRole('button',{name:'Make it an ending'}).click();
  await expect(card(page,'cart-arrives')).toHaveClass(/\bending\b/);
  const after=await saved(page);
  expect(node(after,'cart-arrives').data).toMatchObject({kind:'exit',closing:'',result:'good',exitKind:'progress'});
  expect(after.edges.map((e:any)=>e.id)).toEqual(['find-murder','find-motive','find-hobb','cart-comes','case-lost']);
  expect(person(after,'tull').enters).toBeUndefined();
  await expect(inspector(page).locator('[data-field="result"]')).toBeVisible();
});

test('a route\'s requires, roll and facts, each with [+ Add …]; and an ending\'s next',async({page})=>{
  await select(page,'suspicious');
  await inspector(page).getByLabel('Next scene',{exact:true}).selectOption('drowned-rat');
  await inspector(page).locator('.way-in').filter({hasText:'Suicide, under protest'}).click();
  const routeCard=await editRoute(page,'signed-suicide');
  const requires=routeCard.locator('[data-field="requires"]');
  await expect(requires.getByRole('list',{name:'Requires'}).getByRole('listitem')).toHaveText(['Hobb was spotted at the scene']);
  await pick(requires,'Add beat',/^Motive: supplies are being embezzled \(motive\)/);
  await expect.poll(async()=>route(await saved(page),'signed-suicide').data.requires).toEqual(['hobb','motive']);
  let scene=await saved(page);
  expect(node(scene,'suspicious').data.next).toBe('drowned-rat');
  expect(Object.keys(route(scene,'signed-suicide').data)).toEqual(['condition','phase','requires','skill','dc']);
  // The roll: [+ Add a roll], a skill chosen, where a failure goes; removed, it takes the failure with it.
  await routeCard.getByRole('button',{name:'Add a roll'}).click();
  await routeCard.getByLabel('Skill',{exact:true}).selectOption('insight');
  await routeCard.getByLabel('DC',{exact:true}).fill('13');
  await routeCard.getByLabel('On failure',{exact:true}).selectOption('failed');
  await pick(routeCard.locator('[data-field="establishes"]'),'Add fact',/^hobb-at-granary/);
  await expect.poll(async()=>route(await saved(page),'signed-suicide').data).toEqual({...route(clerk(),'signed-suicide').data,requires:['hobb','motive'],skill:'insight',dc:13,onFailure:'failed',establishes:['hobb-at-granary']});
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'Suicide, under protest · dice'})).toHaveCount(1);
  await routeCard.getByRole('button',{name:'Remove roll'}).click();
  await expect.poll(async()=>Object.keys(route(await saved(page),'signed-suicide').data)).toEqual(['condition','phase','requires','skill','dc','establishes']);
  await routeCard.getByRole('radio',{name:'Cue'}).check();
  await expect.poll(async()=>route(await saved(page),'signed-suicide').data.phase).toBe('cue');
  // Requiring nothing takes the key out, and a good ending that needs nothing found is a problem.
  await select(page,'murder-unknown');
  await inspector(page).locator('.way-in').filter({hasText:'Signed in as murder'}).click();
  const signed=await editRoute(page,'signed-murder');
  for(const name of ['Remove The victim was murdered','Remove Hobb was spotted at the scene'])await signed.getByRole('button',{name}).click();
  await expect.poll(async()=>'requires' in route(await saved(page),'signed-murder').data).toBe(false);
  await problems(page,2);
});

test('a cue\'s outer limit: its counts, each from the start or a beat and until beats, added, changed and taken out',async({page})=>{
  await select(page,'cart-arrives');
  await inspector(page).locator('[data-field="routes"] button').filter({hasText:'The noon bell'}).click();
  const routeCard=await editRoute(page,'cart-comes');
  const limit=routeCard.locator('section[data-field="limit"]');
  const first=limit.getByRole('article',{name:'Count 1'});
  await expect(first.getByLabel('Exchanges',{exact:true})).toHaveValue('12');
  await expect(first.getByLabel('Counted from',{exact:true})).toHaveValue('');
  await first.getByLabel('Exchanges',{exact:true}).fill('10');
  await expect.poll(async()=>route(await saved(page),'cart-comes').data.limit).toEqual([{exchanges:10}]);
  // A second count, after a beat and until another: whichever runs out first.
  await limit.getByRole('button',{name:'Add count'}).click();
  const second=limit.getByRole('article',{name:'Count 2'});
  await second.getByLabel('Counted from',{exact:true}).selectOption('murder');
  await pick(second.locator('[data-field="until"]'),'Add beat',/^Hobb was spotted at the scene \(hobb\)/);
  await expect.poll(async()=>route(await saved(page),'cart-comes').data.limit).toEqual([{exchanges:10},{exchanges:8,after:'murder',until:['hobb']}]);
  await expect(routeCard.locator('.way-badges')).toContainText('By 10 exchanges in, or 8 exchanges after The victim was murdered (until Hobb was spotted at the scene)');
  // Taken out a part at a time, then whole; one undo brings it back.
  await second.getByRole('button',{name:'Remove Hobb was spotted at the scene'}).click();
  await limit.getByRole('button',{name:'Remove count 2'}).click();
  await expect.poll(async()=>route(await saved(page),'cart-comes').data.limit).toEqual([{exchanges:10}]);
  await routeCard.getByRole('button',{name:'Remove outer limit'}).click();
  await expect.poll(async()=>'limit' in route(await saved(page),'cart-comes').data).toBe(false);
  await undo(page);
  await expect.poll(async()=>route(await saved(page),'cart-comes').data.limit).toEqual([{exchanges:10}]);
  await routeCard.getByRole('button',{name:'Remove outer limit'}).click();
  await routeCard.getByRole('button',{name:'Add an outer limit'}).click();
  await expect.poll(async()=>route(await saved(page),'cart-comes').data.limit).toEqual([{exchanges:8}]);
  expect(Object.keys(route(await saved(page),'cart-comes').data)).toEqual(['condition','phase','skill','dc','limit']);
  // An outcome has none to add.
  await select(page,'murder-unknown');
  await inspector(page).locator('.way-in').filter({hasText:'Signed in as murder'}).click();
  const outcome=await editRoute(page,'signed-murder');
  await expect(outcome.getByRole('button',{name:'Add an outer limit'})).toHaveCount(0);
  await problems(page,0);
});

test('an effect\'s conditions are picked from the facts, or a new fact made there and then',async({page})=>{
  await select(page,'failed');
  const effects=inspector(page).locator('fieldset.effects');
  const before=node(clerk(),'failed').data.effects.length;
  await pick(effects,'Add effect',/^Journal/);
  const added=effects.getByRole('article',{name:`Effects ${before+1}`});
  await added.getByLabel('Text',{exact:true}).fill('The case went in the pit with Prout.');
  await pick(added.locator('[data-field="if"]'),'Only if a fact is settled',/^hobb-at-granary/);
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'journal',text:'The case went in the pit with Prout.',if:{established:'hobb-at-granary'}});
  const unless=added.locator('[data-field="unless"]');
  await unless.getByRole('button',{name:'Unless a fact is settled'}).click();
  const form=unless.getByRole('group',{name:'A new fact'});
  await form.getByLabel('Sentence',{exact:true}).fill('Kell wrote her objection in the book.');
  await form.getByRole('button',{name:'Add new fact'}).click();
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1).unless).toEqual({established:'kell-wrote-her-objection-in-the-book'});
  expect((await saved(page)).facts['kell-wrote-her-objection-in-the-book']).toBe('Kell wrote her objection in the book.');
  await pick(added.locator('[data-field="if"]'),'Add fact',/^killed-not-suicide/);
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1).if).toEqual({established:['hobb-at-granary','killed-not-suicide']});
  await added.locator('[data-field="if"]').getByRole('button',{name:'Remove hobb-at-granary'}).click();
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1).if).toEqual({established:'killed-not-suicide'});
  // A world op is a form too; an op it has no form for is JSON, kept only once it's whole.
  await pick(effects,'Add effect',/^Give/);
  const give=effects.getByRole('article',{name:`Effects ${before+2}`});
  await give.getByLabel('What',{exact:true}).fill('boots');
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'give',what:'boots',to:'$player'});
  // A fight's set-up: its enemies, and its allies and where only once they're given.
  await pick(effects,'Add effect',/^Start a fight/);
  const fight=effects.getByRole('article',{name:`Effects ${before+3}`});
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'startFight',enemies:[]});
  await fight.getByRole('button',{name:'Add enemies'}).click();
  await pick(fight,'Add person',/^Sergeant Agnes Kell/);
  await fight.getByLabel('Where',{exact:true}).fill('yard');
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'startFight',enemies:[{asset:'bandit',count:1}],allies:['kell'],at:'yard'});
  await fight.getByRole('button',{name:'Remove Sergeant Agnes Kell (kell)'}).click();
  await fight.getByLabel('Where',{exact:true}).fill('');
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'startFight',enemies:[{asset:'bandit',count:1}]});
  await fight.getByRole('button',{name:`Remove effect ${before+3}`}).click();
  await pick(effects,'Add effect',/^Another op, as JSON/);
  const raw=effects.getByRole('article',{name:'New effects'}).getByLabel('JSON',{exact:true});
  await raw.fill('{"op": "chant", "what": ');
  await expect(effects.getByRole('alert')).toContainText('Not JSON yet');
  expect(node(await saved(page),'failed').data.effects).toHaveLength(before+2);
  await raw.fill('{"op": "chant", "what": "boots"}');
  await expect.poll(async()=>node(await saved(page),'failed').data.effects.at(-1)).toEqual({op:'chant',what:'boots'});
  await problems(page,1);
});

test('the cast: a person picked from the list, their card grouped, their roles and limits, and their lore note by the game\'s path',async({page})=>{
  await view(page,'Cast').click();
  await page.locator('.cast-pick',{hasText:'Cob'}).click();
  const cob=page.locator('section[data-cast="cob"]');
  await expect(cob.getByRole('region')).toHaveText([/^Who they are/,/^How they come across/,/^What drives them/,/^What they know/,/^Playing them/,/^In the scene/]);
  await expect(cob.locator('.cast-uses')).toContainText('Holds 4 paths');
  await cob.getByLabel('Hooks',{exact:true}).fill('Stamps so the boot crackles. Looks up at the loft door.');
  await cob.getByLabel('Limits',{exact:true}).fill('Coin buys boasts, never the look in his boot.');
  await cob.getByLabel('Inconsistency',{exact:true}).fill('');
  await expect.poll(async()=>person(await saved(page),'cob').limits).toBe('Coin buys boasts, never the look in his boot.');
  const member=person(await saved(page),'cob');
  expect(member.roles).toEqual({characterise:clerk().cast[1].roles.characterise,hooks:'Stamps so the boot crackles. Looks up at the loft door.'});
  expect(Object.keys(member)).toEqual(Object.keys(clerk().cast[1]));
  // The lore note: offered by its path under the campaign's lore/, opened in the host.
  await cob.getByRole('button',{name:'Choose another note'}).click();
  const picker=page.getByRole('dialog',{name:'Lore library'});
  await picker.getByLabel('Search lore').fill('Moll');
  await picker.getByRole('button',{name:'Link Cast/Moll/public.md'}).click();
  await expect.poll(async()=>person(await saved(page),'cob').lore).toBe('Cast/Moll/public.md');
  await cob.getByRole('button',{name:'Open Cast/Moll/public.md'}).click();
  await expect(page.getByRole('dialog',{name:'Host opened lore note'})).toContainText('lore/Cast/Moll/public.md');
  await page.getByRole('button',{name:'Close note'}).click();
  // Someone new, with [+ Add person].
  await page.getByRole('button',{name:'Add person',exact:true}).click();
  await page.getByLabel('New person\'s name').fill('Saul the sentry');
  await page.getByRole('group',{name:'Add a person'}).getByRole('button',{name:'Add person'}).click();
  await expect(page.locator('section[data-cast="saul-the-sentry"]')).toBeVisible();
  await expect.poll(async()=>person(await saved(page),'saul-the-sentry')).toEqual({id:'saul-the-sentry',name:'Saul the sentry',look:'',voice:'',wants:'',whyHere:'',knows:[],attitude:''});
  await page.screenshot({path:'dist/screenshots/scene-cast.png'});
});

test('reload and find it all saved, the file the game\'s still',async({page})=>{
  await select(page,'cart-arrives');
  await inspector(page).getByRole('textbox',{name:'Pressure',exact:true}).fill('Tull starts loading the body himself.');
  await pick(inspector(page).locator('[data-field="arrivals"]'),'Add person',/^Moll \(moll\)/);
  await view(page,'Scene').click();
  await page.locator('.scene-view').getByLabel('Clock',{exact:true}).fill('Noon, and the cart.');
  const before=await savedText(page);
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(clerkPath);
  expect(await savedText(page)).toBe(before);
  const scene=JSON.parse(before);
  expect(node(scene,'cart-arrives').data.pressure).toBe('Tull starts loading the body himself.');
  expect(person(scene,'moll').enters).toBe('cart-arrives');
  expect(scene.clock).toBe('Noon, and the cart.');
  expect(before).toBe(JSON.stringify(scene,null,2)+'\n');
  await expect(card(page,'cart-arrives')).toContainText('Moll, Corporal Abner Tull arrive');
  await select(page,'cart-arrives');
  await expect(inspector(page).getByRole('textbox',{name:'Pressure',exact:true})).toHaveValue('Tull starts loading the body himself.');
  await problems(page,0);
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
  await view(page,'Scene').click();
  await page.locator('.scene-view [data-field="lore"]').getByRole('button',{name:'Link lore'}).click();
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
  await undo(page);
  await expect.poll(()=>savedText(page)).toBe(clerkText);
});

test('several routes between the same two nodes: one connection on the graph, each route its own',async({page})=>{
  await select(page,'failed');
  await inspector(page).locator('.route-list button').filter({hasText:'Last resort'}).click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  await inspector(page).getByRole('button',{name:'Add route'}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  const added=await editRoute(page,'to-failed');
  await added.getByLabel('Label',{exact:true}).fill('Caught red-handed');
  await added.getByLabel('Condition',{exact:true}).fill('The player is caught doing what ends the case.');
  await expect.poll(async()=>route(await saved(page),'to-failed')).toEqual({id:'to-failed',source:'start',target:'failed',type:'smoothstep',label:'Caught red-handed',data:{condition:'The player is caught doing what ends the case.',phase:'outcome',skill:'',dc:12}});
  expect(route(await saved(page),'case-lost')).toEqual(route(clerk(),'case-lost'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'2 routes'})).toHaveCount(1);
  // Its id renamed, by asking.
  await added.getByRole('button',{name:'Rename id to-failed'}).click();
  await added.getByLabel('New id',{exact:true}).fill('caught');
  await added.getByRole('button',{name:'Rename',exact:true}).click();
  await expect.poll(async()=>route(await saved(page),'caught')?.label).toBe('Caught red-handed');
  await expect(page.locator('.route-card[data-route-id="caught"]').getByLabel('Condition',{exact:true})).toBeVisible();
  // Removing one route keeps the other, and the connection.
  await page.locator('.route-card[data-route-id="case-lost"]').getByRole('button',{name:'Edit route'}).click();
  await page.locator('.route-card[data-route-id="case-lost"]').getByRole('button',{name:'Remove route'}).click();
  await page.getByRole('alertdialog',{name:'Remove route?'}).getByRole('button',{name:'Remove route'}).click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  expect(route(await saved(page),'case-lost')).toBeUndefined();
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await undo(page);
  await expect.poll(async()=>route(await saved(page),'case-lost')).toEqual(route(clerk(),'case-lost'));
});

test('drawing a route between two nodes adds one, its id made from where it goes',async({page})=>{
  const from=card(page,'motive').locator('.react-flow__handle.source'),to=card(page,'failed').locator('.react-flow__handle.target');
  await settled(card(page,'motive'));
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
  await expect.poll(async()=>route(await saved(page),'to-failed')).toEqual({id:'to-failed',source:'motive',target:'failed',type:'smoothstep',label:'Failed',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  await problems(page,1);
  await expect(page.locator('.route-card[data-route-id="to-failed"]').getByLabel('Condition',{exact:true})).toBeVisible();
});

test('a connection\'s routes move to other ends together, ids kept, merging with the routes already there',async({page})=>{
  await select(page,'failed');
  await inspector(page).locator('.route-list button').filter({hasText:'Last resort'}).click();
  await inspector(page).getByText('Move these routes').click();
  await inspector(page).getByLabel('From',{exact:true}).selectOption('cart-arrives');
  await expect.poll(async()=>route(await saved(page),'case-lost').source).toBe('cart-arrives');
  const moved=route(await saved(page),'case-lost'),original=route(clerk(),'case-lost');
  expect(moved).toEqual({...original,source:'cart-arrives'});
  expect(Object.keys(moved)).toEqual(Object.keys(original));
  await expect(page.locator('.route-card[data-route-id="case-lost"]')).toBeVisible();
  await expect(page.locator('.route-path')).toContainText('The dead-cart arrives');
  await inspector(page).getByText('Move these routes').click();
  await inspector(page).getByLabel('To',{exact:true}).selectOption('suspicious');
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'2 routes'})).toHaveCount(1);
  expect(route(await saved(page),'case-lost').target).toBe('suspicious');
});

test('a clue path\'s via picked from its scene\'s place\'s things, and one naming something the scene hasn\'t got a warning in the Problems view',async({page})=>{
  const path=clerkPath;
  // The warnings are counted under the title beside the problems, not in the view's count (the campaign check's).
  await problems(page,0);
  await expect(page.locator('.problems-link')).toHaveText('No problems · 2 warnings');
  await view(page,'Problems').click();
  const panel=page.locator('.problems-view');
  await expect(panel.locator('.warning')).toHaveText([/murder's path 1 is via “the body”/,/murder's path 2 is via “the body”/]);
  await expect(panel.locator('.problem')).toHaveCount(0);
  // A warning takes you to its discovery; the path's via picked from the yard's things.
  await panel.locator('.warning').first().click();
  const first=page.locator('.node-inspector[data-node="murder"] article.path').first();
  await expect(first.locator('.via-warning')).toBeVisible();
  await first.getByLabel('Pick via',{exact:true}).selectOption('Wendell Prout\'s body');
  await expect(first.getByLabel('Via',{exact:true})).toHaveValue('Wendell Prout\'s body');
  await expect(first.locator('.via-warning')).toHaveCount(0);
  const scene=await saved(page,path);
  expect(scene.nodes.find((n:any)=>n.id==='murder').data.paths[0].via).toBe('Wendell Prout\'s body');
  await expect(page.locator('.problems-link')).toHaveText('No problems · 1 warning');
  // The Scene view shows its place's things, and opens the place.
  await view(page,'Scene').click();
  const things=page.locator('[data-field="place.things"]');
  await things.locator('summary').click();
  await expect(things.locator('li')).toHaveCount(JSON.parse(await readFile(new URL('places/granary-yard.kmplace',CAMPAIGN),'utf8')).things.length);
  await things.getByRole('button',{name:'Open the place'}).click();
  await expect(page.locator('.file-path')).toHaveText('places/granary-yard.kmplace');
});

import {test,expect,type Page,type Locator} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {connectionId,serializeDocument,type GraphDocument,type Kind} from '../src/model';
const scenePath='Scenes/The Hanged Clerk.kmscene';
const scenarioPath='Scenarios/Caerwyn.kmscenario';
const flowSourcePath='Scenes/First Scene.kmscene';
const flowTargetPath='Scenes/Second Scene.kmscene';
const flowMapPath='Maps/Travelling the river.kmmap';
const fixtureNode=(id:string,title:string,kind:Kind,x=0,y=0)=>({id,type:'story',position:{x,y},data:{kind,title,description:'',lore:[] as string[]}});
const fixtureDocument=(kind:GraphDocument['kind'],id:string,title:string,nodes:GraphDocument['nodes']=[]):GraphDocument=>({format:'kingmaker',version:1,kind,id,title,description:'A test of real file-backed scenario flow.',nodes,edges:[],lore:[]});
const flowDocuments=()=>({
  [scenarioPath]:{...fixtureDocument('scenario','scenario-fixture','Caerwyn'),scenario:{files:[flowSourcePath,flowTargetPath],positions:{[flowSourcePath]:{x:420,y:0},[flowTargetPath]:{x:880,y:0}}}},
  [flowSourcePath]:fixtureDocument('scene','first-scene','First Scene',[fixtureNode('arrival','Arrival','start'),fixtureNode('quiet','Leave quietly','exit',400,0),fixtureNode('guard','Leave with the guard','exit',400,240)]),
  [flowTargetPath]:fixtureDocument('scene','second-scene','Second Scene',[fixtureNode('road','By road','start'),fixtureNode('river','By river','start',0,240),fixtureNode('onward','Continue the journey','exit',400,0)]),
  [flowMapPath]:fixtureDocument('map','river-map','Travelling the river',[fixtureNode('upstream','From upstream','start'),fixtureNode('downstream','Continue downstream','exit',400,0)]),
});
const seedDocuments=async(page:Page,documents:Record<string,GraphDocument>,active=scenarioPath)=>{
  const serialized=Object.fromEntries(Object.entries(documents).map(([path,document])=>[path,serializeDocument(document)]));
  await page.evaluate(({serialized,active})=>{
    const files=JSON.parse(localStorage.getItem('kingmaker-authoring-test-files-v2')??'{}');
    localStorage.setItem('kingmaker-authoring-test-files-v2',JSON.stringify({...files,...serialized}));
    localStorage.setItem('kingmaker-authoring-test-active-v2',active);
  },{serialized,active});
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(active);
};
const scenarioCard=(page:Page,path:string)=>page.locator(`.scenario-card[data-file=${JSON.stringify(path)}]`);
const scenarioInput=(page:Page,path:string,entry:string)=>scenarioCard(page,path).locator(`.react-flow__handle[data-handleid=${JSON.stringify('entry:'+entry)}]`);
const scenarioOutput=(page:Page,path:string,exit:string)=>scenarioCard(page,path).locator(`.react-flow__handle[data-handleid=${JSON.stringify('exit:'+exit)}]`);
const waitForStableGeometry=async(locator:Locator)=>{
  await locator.evaluate(element=>new Promise<void>(resolve=>{
    let previous='',stable=0;
    const sample=()=>{const box=element.getBoundingClientRect(),position=[box.x,box.y,box.width,box.height].join(',');stable=position===previous?stable+1:0;previous=position;if(stable>=6)resolve();else requestAnimationFrame(sample)};
    sample();
  }));
};
const dragHandle=async(page:Page,from:Locator,to:Locator)=>{
  // A source-file write temporarily disables sockets until the catalog refreshes.
  await expect(page.locator('.statusbar')).not.toContainText(/Saving…|Loading…/);
  await expect(from).toHaveClass(/\bconnectablestart\b/);
  await expect(to).toHaveClass(/\bconnectableend\b/);
  // Initial fitting waits for asynchronous file loading and port measurements.
  // Do not press at a source position that is still moving with that animation.
  await waitForStableGeometry(from);
  await from.hover();
  await page.mouse.down();
  try{
    await to.hover();
    // React Flow resolves the hovered connection target on an animation frame.
    await expect(to).toHaveClass(/\bconnectingto\b/);
    await expect(to).toHaveClass(/\bvalid\b/);
  }finally{await page.mouse.up()}
};
const card=(page:Page,title:string)=>page.locator('.story-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
const saved=(page:Page,path:string)=>page.evaluate(path=>JSON.parse((window as any).__kingmakerHarness.files[path]),path);
const status=(page:Page,nodes:number,connections:number,ways:number)=>expect(page.locator('.statusbar')).toContainText(`${nodes} nodes · ${connections} node pairs · ${ways} transitions`);
const way=(page:Page,id:string)=>page.locator(`.transition-way[data-route-id="${id}"]`);
const connection=(page:Page,source:string,target:string)=>page.locator(`.react-flow__edge[data-id=${JSON.stringify(connectionId(source,target))}]`);
const confirmAction=async(page:Page,title:string,action:string)=>{
  const confirmation=page.getByRole('alertdialog',{name:title,exact:true});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:action,exact:true}).click();
  await expect(confirmation).toHaveCount(0);
};
const openScene=async(page:Page)=>{
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(scenePath);
  await expect(page.locator('.file-path')).toHaveText(scenePath);
  await status(page,10,24,51);
};
// Hit the actual SVG stroke, not its rectangular bounding box or a sidebar proxy.
const clickConnection=async(page:Page,source:string,target:string)=>{
  const edge=connection(page,source,target);
  await expect(edge).toBeVisible();
  await waitForStableGeometry(edge);
  await expect.poll(async()=>edge.evaluate(el=>Boolean((el.querySelector('.react-flow__edge-interaction') as SVGPathElement|null)?.getScreenCTM()))).toBe(true);
  const point=await edge.evaluate(el=>{
    const path=el.querySelector('.react-flow__edge-interaction') as SVGPathElement;
    const matrix=path.getScreenCTM()!;
    for(const fraction of [.5,.4,.6,.3,.7,.2,.8,.1,.9]){
      const p=path.getPointAtLength(path.getTotalLength()*fraction).matrixTransform(matrix);
      if(document.elementFromPoint(p.x,p.y)?.closest('.react-flow__edge')===el)return {x:p.x,y:p.y};
    }
    return null;
  });
  expect(point,`Connection ${source} → ${target} has a clickable visible stroke`).not.toBeNull();
  await page.mouse.click(point!.x,point!.y);
};
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('.file-path')).toHaveText(scenarioPath)});

test('opens actual files with one canvas edge per directed connection',async({page})=>{
  await openScene(page);
  await expect(page.getByRole('heading',{level:1})).toHaveText('The Hanged Clerk');
  await expect(page.locator('.story-card')).toHaveCount(10);
  await expect(page.locator('.react-flow__edge')).toHaveCount(24);
  await expect(page.getByRole('button',{name:'Show whole scene'})).toHaveCount(0);
  const document=await saved(page,scenePath);
  expect(document.source.scene.start).toBe('yard');
  expect(document.source.scene.cast).toHaveLength(4);
  expect(document.edges).toHaveLength(51);
  expect(document.edges.filter((edge:any)=>edge.data.scope==='anytime')).toHaveLength(5);
  const ids=await page.locator('.react-flow__edge').evaluateAll(edges=>edges.map(edge=>edge.getAttribute('data-id')));
  expect(new Set(ids).size).toBe(24);
  await page.screenshot({path:'dist/screenshots/grouped-full-scene.png'});
  await card(page,'Stones at a hanged man').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(24);
});

test('edits persist to the current file across reload, not plugin-wide data',async({page})=>{
  await openScene(page);
  await page.getByLabel('Title',{exact:true}).fill('The Hanged Clerk — revised');
  await card(page,'Stones at a hanged man').click();
  await page.getByLabel('Name',{exact:true}).fill('At the granary hoist');
  await page.getByRole('textbox',{name:'Direction',exact:true}).fill('Kell waits under the hoist. Ask what she saw.');
  const before=await saved(page,scenePath);
  expect(before.title).toBe('The Hanged Clerk — revised');
  expect(before.nodes.find((node:any)=>node.id==='yard').data.description).toContain('Kell waits');
  expect((await saved(page,scenarioPath)).title).toBe('Caerwyn');
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(scenePath);
  await expect(card(page,'At the granary hoist')).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('The Hanged Clerk — revised');
  expect((await saved(page,scenePath)).source.scene.title).toBe('The Hanged Clerk');
});

test('keyboard add creates a connected beat, with delete undo and redo',async({page})=>{
  await openScene(page);
  await card(page,'Stones at a hanged man').click();
  await page.keyboard.press('a');
  await page.getByRole('button',{name:'Beat A situation the player can change'}).click();
  await status(page,11,25,52);
  await page.getByLabel('Name',{exact:true}).fill('Follow the muddy footprints');
  await page.getByTitle('Delete node',{exact:true}).click();
  await confirmAction(page,'Delete node?','Delete node');
  await status(page,10,24,51);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await status(page,11,25,52);
  await expect(card(page,'Follow the muddy footprints')).toBeVisible();
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  await status(page,10,24,51);
});

test('clicking a canvas connection exposes every full condition, check and outcome',async({page})=>{
  await openScene(page);
  await clickConnection(page,'yard','doubt');
  await expect(page.locator('.inspector')).toContainText('TRANSITIONS');
  await expect(page.locator('.inspector')).toContainText('Stones at a hanged man → Not by his own hand');
  await expect(page.locator('.inspector')).toContainText(/6 transitions/);
  await expect(page.locator('.transition-way')).toHaveCount(6);
  const routes=(await saved(page,scenePath)).edges.filter((edge:any)=>edge.source==='yard'&&edge.target==='doubt');
  for(const route of routes){
    await expect(way(page,route.id).getByRole('heading',{level:3})).toHaveText(route.label);
    await expect(way(page,route.id).locator('.way-condition')).toHaveText(route.data.condition);
  }
  await expect(way(page,'beat:yard:examine-body:success')).toContainText('medicine');
  await expect(way(page,'beat:yard:examine-body:success')).toContainText('12');
  await expect(way(page,'beat:yard:examine-body:success')).toContainText('thin, level cord mark');
  await expect(way(page,'beat:yard:promise-cob:direct')).toContainText('he holds the left one out himself');
});

test('edits one transition way without changing siblings or original source metadata',async({page})=>{
  await openScene(page);
  const before=await saved(page,scenePath);
  await card(page,'Stones at a hanged man').click();
  await page.locator('.route-list').getByRole('button',{name:/Not by his own hand/}).click();
  const routeId='beat:yard:examine-body:success';
  await way(page,routeId).getByRole('button',{name:'Edit transition',exact:true}).click();
  await expect(way(page,routeId).getByLabel('Skill check',{exact:true})).toHaveValue('medicine');
  await expect(way(page,routeId).getByLabel('DC',{exact:true})).toHaveValue('12');
  await expect(way(page,routeId).getByRole('textbox',{name:'Outcome',exact:true})).toHaveValue(/thin, level cord mark/);
  await way(page,routeId).getByLabel('Transition label',{exact:true}).fill('Read the marks on his neck');
  await way(page,routeId).getByLabel('DC',{exact:true}).fill('15');
  await way(page,routeId).getByRole('textbox',{name:'When can this happen?',exact:true}).fill('The player examines the body up close.');
  const after=await saved(page,scenePath);
  const route=after.edges.find((edge:any)=>edge.id===routeId);
  expect(route.label).toBe('Read the marks on his neck');
  expect(route.data.dc).toBe(15);
  expect(route.data.condition).toBe('The player examines the body up close.');
  expect(route.data.sourceRoute.check.dc).toBe(12);
  expect(after.edges.filter((edge:any)=>edge.id!==routeId)).toEqual(before.edges.filter((edge:any)=>edge.id!==routeId));
  await expect(page.locator('.react-flow__edge')).toHaveCount(24);
});

test('adding a way keeps one canvas connection and persists all alternatives across reload',async({page})=>{
  await openScene(page);
  await clickConnection(page,'yard','doubt');
  const before=await saved(page,scenePath);
  await page.getByRole('button',{name:'Add transition',exact:true}).click();
  await status(page,10,24,52);
  await expect(page.locator('.react-flow__edge')).toHaveCount(24);
  await expect(page.locator('.transition-way')).toHaveCount(7);
  const after=await saved(page,scenePath);
  const route=after.edges.find((edge:any)=>!before.edges.some((old:any)=>old.id===edge.id));
  expect(route.source).toBe('yard');expect(route.target).toBe('doubt');
  const added=way(page,route.id);
  if(await added.getByRole('button',{name:'Edit transition',exact:true}).isVisible())await added.getByRole('button',{name:'Edit transition',exact:true}).click();
  await added.getByLabel('Transition label',{exact:true}).fill('Follow the drag marks');
  await added.getByRole('textbox',{name:'When can this happen?',exact:true}).fill('Fresh drag marks lead from the loft to the hoist.');
  await page.reload();
  await status(page,10,24,52);
  await clickConnection(page,'yard','doubt');
  await expect(page.locator('.transition-way')).toHaveCount(7);
  await expect(way(page,route.id)).toContainText('Follow the drag marks');
  await expect(way(page,route.id).locator('.way-condition')).toHaveText('Fresh drag marks lead from the loft to the hoist.');
  expect((await saved(page,scenePath)).edges.filter((edge:any)=>edge.id!==route.id)).toEqual(before.edges);
});

test('removing ways retains a connection until the last way, and undo restores it',async({page})=>{
  await openScene(page);
  await clickConnection(page,'yard','doubt');
  const ids=(await saved(page,scenePath)).edges.filter((edge:any)=>edge.source==='yard'&&edge.target==='doubt').map((edge:any)=>edge.id);
  for(let index=0;index<ids.length;index++){
    const item=way(page,ids[index]);
    await item.getByRole('button',{name:'Edit transition',exact:true}).click();
    await item.getByRole('button',{name:'Remove transition',exact:true}).click();
    if(index===ids.length-1){
      const confirmation=page.getByRole('alertdialog',{name:'Remove transition?',exact:true});
      await expect(confirmation).toContainText(/last transition/i);
      await expect(confirmation).toContainText(/graph edge/i);
      await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
      await status(page,10,24,46);
      await expect(connection(page,'yard','doubt')).toHaveCount(1);
      await item.getByRole('button',{name:'Remove transition',exact:true}).click();
    }
    await confirmAction(page,'Remove transition?','Remove transition');
    await status(page,10,index===ids.length-1?23:24,50-index);
  }
  await expect(connection(page,'yard','doubt')).toHaveCount(0);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await status(page,10,24,46);
  await clickConnection(page,'yard','doubt');
  await expect(page.locator('.transition-way')).toHaveCount(1);
});

test('deleting a connection removes all its ways together and undo restores them exactly',async({page})=>{
  await openScene(page);
  const before=await saved(page,scenePath);
  await clickConnection(page,'yard','doubt');
  await page.getByRole('button',{name:'Delete transitions',exact:true}).click();
  await expect(page.getByRole('alertdialog',{name:'Delete transitions?',exact:true})).toContainText(/6 transitions/i);
  expect(await saved(page,scenePath)).toEqual(before);
  await confirmAction(page,'Delete transitions?','Delete transitions');
  await status(page,10,23,45);
  expect((await saved(page,scenePath)).edges.filter((edge:any)=>edge.source==='yard'&&edge.target==='doubt')).toHaveLength(0);
  await page.keyboard.press('Control+z');
  await status(page,10,24,51);
  expect((await saved(page,scenePath)).edges).toEqual(before.edges);
});

test('cancelling node deletion preserves the document and undo history',async({page})=>{
  await openScene(page);
  const original=await saved(page,scenePath);
  await card(page,'Stones at a hanged man').click();
  await page.getByLabel('Name',{exact:true}).fill('Under the granary hoist');
  const before=await saved(page,scenePath);
  await page.getByTitle('Delete node',{exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Delete node?',exact:true});
  await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  const affected=before.edges.filter((edge:any)=>edge.source==='yard'||edge.target==='yard');
  const connections=new Set(affected.map((edge:any)=>connectionId(edge.source,edge.target))).size;
  await expect(confirmation).toContainText(`${connections} graph edges`);
  await expect(confirmation).toContainText(`${affected.length} transitions`);
  expect(await saved(page,scenePath)).toEqual(before);
  await page.keyboard.press('a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('dialog',{name:'Add to graph',exact:true})).toHaveCount(0);
  expect(await saved(page,scenePath)).toEqual(before);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(before);
  await expect(page.getByTitle('Delete node',{exact:true})).toBeFocused();
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(original);
});

test('expanded node deletion supports Escape and backdrop cancellation, then confirm and undo',async({page})=>{
  await openScene(page);
  const before=await saved(page,scenePath);
  await card(page,'Stones at a hanged man').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  await editor.getByTitle('Delete node',{exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Delete node?',exact:true});
  await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.screenshot({path:'dist/screenshots/destructive-confirmation.png'});
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.getByTitle('Delete node',{exact:true})).toBeFocused();
  expect(await saved(page,scenePath)).toEqual(before);
  await editor.getByTitle('Delete node',{exact:true}).click();
  const bounds=await confirmation.boundingBox();
  await page.mouse.click(bounds!.x-10,bounds!.y+10);
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await saved(page,scenePath)).toEqual(before);
  await editor.getByTitle('Delete node',{exact:true}).click();
  await confirmAction(page,'Delete node?','Delete node');
  await expect(editor).toHaveCount(0);
  const after=await saved(page,scenePath);
  expect(after.nodes).toHaveLength(9);
  expect(after.edges).toEqual(before.edges.filter((edge:any)=>edge.source!=='yard'&&edge.target!=='yard'));
  await page.keyboard.press('Control+z');
  expect(await saved(page,scenePath)).toEqual(before);
});

test('Delete and Backspace keyboard deletion require confirmation for single and multiple nodes',async({page})=>{
  await openScene(page);
  const before=await saved(page,scenePath);
  await card(page,'Stones at a hanged man').click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alertdialog',{name:'Delete node?',exact:true})).toBeVisible();
  expect(await saved(page,scenePath)).toEqual(before);
  await page.keyboard.press('Escape');
  await card(page,'Not by his own hand').click({modifiers:['Shift']});
  await expect(page.locator('.story-card.chosen')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  const confirmation=page.getByRole('alertdialog',{name:'Delete 2 nodes?',exact:true});
  await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  expect(await saved(page,scenePath)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  expect(await saved(page,scenePath)).toEqual(before);
  await page.locator('.km-workshop').focus();
  await page.keyboard.press('Backspace');
  await confirmAction(page,'Delete 2 nodes?','Delete 2 nodes');
  const after=await saved(page,scenePath);
  expect(after.nodes).toHaveLength(8);
  expect(after.edges).toEqual(before.edges.filter((edge:any)=>!['yard','doubt'].includes(edge.source)&&!['yard','doubt'].includes(edge.target)));
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(before);
});

test('unlink confirmation removes only the reference and never changes the lore file',async({page})=>{
  await openScene(page);
  const notePath=new URL('../examples/Objects/Wendell Prout.md',import.meta.url);
  const noteBytes=await readFile(notePath);
  const before=await saved(page,scenePath);
  await card(page,'Stones at a hanged man').click();
  await page.getByTitle("Open Wendell Prout's body",{exact:true}).click();
  const note=page.getByRole('dialog',{name:'Host opened lore note'});
  const originalText=await note.locator('pre').textContent();
  await note.getByRole('button',{name:'Close note',exact:true}).click();
  await page.getByTitle("Unlink Wendell Prout's body",{exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Unlink lore?',exact:true});
  await expect(confirmation).toContainText('The original note will not be deleted');
  await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  expect(await saved(page,scenePath)).toEqual(before);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(before);
  await page.getByTitle("Unlink Wendell Prout's body",{exact:true}).click();
  await confirmAction(page,'Unlink lore?','Unlink');
  const after=await saved(page,scenePath);
  expect(after.nodes.find((node:any)=>node.id==='yard').data.lore).not.toContain('Objects/Wendell Prout.md');
  expect(after.lore).toEqual(before.lore);
  expect(await readFile(notePath)).toEqual(noteBytes);
  await page.getByTitle('Clear selection',{exact:true}).click();
  await page.getByTitle("Open Wendell Prout's body",{exact:true}).click();
  await expect(note.locator('pre')).toHaveText(originalText!);
  await note.getByRole('button',{name:'Close note',exact:true}).click();
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(before);
});

test('changing a connection destination moves every way and merges with an existing connection',async({page})=>{
  await openScene(page);
  const before=await saved(page,scenePath);
  await clickConnection(page,'yard','doubt');
  await page.getByText('Change transition endpoints',{exact:true}).click();
  await page.getByRole('combobox',{name:'To node',exact:true}).selectOption('motive');
  await status(page,10,23,51);
  await expect(page.locator('.transition-way')).toHaveCount(9);
  const after=await saved(page,scenePath);
  const movedIds=before.edges.filter((edge:any)=>edge.source==='yard'&&edge.target==='doubt').map((edge:any)=>edge.id);
  expect(after.edges.filter((edge:any)=>movedIds.includes(edge.id)).every((edge:any)=>edge.target==='motive')).toBe(true);
  expect(after.edges.filter((edge:any)=>!movedIds.includes(edge.id))).toEqual(before.edges.filter((edge:any)=>!movedIds.includes(edge.id)));
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await status(page,10,24,51);
  expect((await saved(page,scenePath)).edges).toEqual(before.edges);
});

test('self-loop connection is clickable and exposes all ways of remaining at the beat',async({page})=>{
  await openScene(page);
  await clickConnection(page,'yard','yard');
  await expect(page.locator('.inspector')).toContainText('Stones at a hanged man → Stones at a hanged man');
  await expect(page.locator('.transition-way')).toHaveCount(7);
  await expect(way(page,'beat:yard:examine-body:failure')).toContainText('Examine body · failure');
  await expect(way(page,'beat:yard:bribe-cob:direct')).toContainText('Bribe cob');
});

test('connection inspector expands into a modal with the same editable alternatives',async({page})=>{
  await openScene(page);
  await clickConnection(page,'yard','doubt');
  await page.getByTitle('Open transitions in modal editor',{exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit transitions',exact:true});
  await expect(editor).toBeVisible();
  await expect(editor.locator('.transition-way')).toHaveCount(6);
  await page.screenshot({path:'dist/screenshots/grouped-connection-editor.png'});
  const item=editor.locator('.transition-way[data-route-id="beat:yard:examine-body:success"]');
  await expect(item.locator('.way-condition')).toContainText('The player examines');
  await item.getByRole('button',{name:'Edit transition',exact:true}).click();
  await item.getByLabel('Transition label',{exact:true}).fill('Read the ligature marks');
  await editor.getByRole('button',{name:'Close transitions editor',exact:true}).click();
  await expect(editor).toHaveCount(0);
  expect((await saved(page,scenePath)).edges.find((edge:any)=>edge.id==='beat:yard:examine-body:success').label).toBe('Read the ligature marks');
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect((await saved(page,scenePath)).edges.find((edge:any)=>edge.id==='beat:yard:examine-body:success').label).toBe('Examine body · success');
});

test('links a real lore object, opens its original note, and persists the reference',async({page})=>{
  await openScene(page);
  await card(page,'The case is made').click();
  await page.getByRole('button',{name:'Add from lore',exact:true}).click();
  await page.getByPlaceholder('Search characters, objects, places…').fill('Wendell Prout');
  await page.getByRole('button',{name:'objects',exact:true}).click();
  await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByTitle("Open Wendell Prout's body",{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Host opened lore note'})).toContainText('Objects/Wendell Prout.md');
  await expect(page.getByRole('dialog',{name:'Host opened lore note'})).toContainText('level cord mark');
  expect(await page.evaluate(()=>(window as any).__kingmakerHarness.openedFiles.at(-1))).toBe('Objects/Wendell Prout.md');
  await page.getByRole('button',{name:'Close note',exact:true}).click();
  await page.reload();
  await card(page,'The case is made').click();
  await expect(page.getByTitle("Open Wendell Prout's body",{exact:true})).toBeVisible();
  expect((await saved(page,scenePath)).nodes.find((node:any)=>node.id==='case-made').data.lore).toContain('Objects/Wendell Prout.md');
});

test('creates a separate scene file from scenario then opens and edits that file',async({page})=>{
  await page.getByRole('button',{name:/^Add scene or map/}).click();
  page.once('dialog',dialog=>void dialog.accept('The Quiet Gate'));
  await page.getByRole('button',{name:'Create scene file',exact:true}).click();
  await expect(scenarioCard(page,'Scenes/The Quiet Gate.kmscene')).toBeVisible();
  await page.getByRole('button',{name:'Open source file',exact:true}).click();
  await expect(page.locator('.file-path')).toHaveText('Scenes/The Quiet Gate.kmscene');
  await page.getByRole('button',{name:/Add first node/}).click();
  await page.getByRole('button',{name:'Beat A situation the player can change'}).click();
  await page.getByLabel('Name',{exact:true}).fill('A watchman at the gate');
  await status(page,1,0,0);
  expect((await saved(page,'Scenes/The Quiet Gate.kmscene')).nodes[0].data.title).toBe('A watchman at the gate');
  const scenario=await saved(page,scenarioPath);
  expect(scenario.scenario.files).toContain('Scenes/The Quiet Gate.kmscene');
  expect(scenario.nodes).toHaveLength(2);
  expect((await saved(page,scenePath)).nodes).toHaveLength(10);
});

test('expanded node editor can add a lore link through the nested picker and return to editing',async({page})=>{
  await openScene(page);
  await card(page,'The case is made').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  await editor.getByRole('button',{name:'Add from lore',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Lore library',exact:true});
  await expect(picker).toBeVisible();
  await picker.getByPlaceholder('Search characters, objects, places…').fill('Wendell Prout');
  await picker.getByRole('button',{name:'objects',exact:true}).click();
  await picker.getByRole('button',{name:'Add',exact:true}).click();
  await picker.getByRole('button',{name:'Done',exact:true}).click();
  await expect(picker).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.getByTitle("Open Wendell Prout's body",{exact:true})).toBeVisible();
  await editor.getByLabel('Name',{exact:true}).fill('Prout receives justice');
  await editor.getByRole('button',{name:'Close node editor',exact:true}).click();
  await expect(card(page,'Prout receives justice')).toBeVisible();
  expect((await saved(page,scenePath)).nodes.find((node:any)=>node.id==='case-made').data.lore).toContain('Objects/Wendell Prout.md');
});

test('node double-click and inspector expand button open the same larger editor',async({page})=>{
  await openScene(page);
  const before=(await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').data;
  await card(page,'Stones at a hanged man').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Name',{exact:true})).toHaveValue('Stones at a hanged man');
  await expect(editor.getByRole('textbox',{name:'Direction',exact:true})).toHaveValue(before.description);
  await page.screenshot({path:'dist/screenshots/expanded-node-editor.png'});
  await editor.getByLabel('Name',{exact:true}).fill('Beneath the hoist');
  await editor.getByRole('textbox',{name:'Direction',exact:true}).fill('Give Kell room to speak.\n\nAsk the children what they saw last night.');
  await editor.getByRole('button',{name:'Close node editor',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await expect(card(page,'Beneath the hoist')).toBeVisible();
  expect((await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').data.description).toContain('Give Kell room');
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect((await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').data.description).toBe(before.description);
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  expect((await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').data.description).toContain('Give Kell room');
  await page.getByTitle('Open node in modal editor',{exact:true}).click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button',{name:'Close node editor',exact:true}).click();
  await page.reload();
  await card(page,'Beneath the hoist').dblclick();
  await expect(page.getByRole('dialog',{name:'Edit node',exact:true}).getByRole('textbox',{name:'Direction',exact:true})).toHaveValue('Give Kell room to speak.\n\nAsk the children what they saw last night.');
});

test('modal focus trap stays local to its file view and ignores keys from another pane',async({page})=>{
  await openScene(page);
  await card(page,'Stones at a hanged man').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  const external=page.getByRole('combobox',{name:'Test file',exact:true});
  await external.evaluate(element=>{
    (window as any).__outsideKeys=[];
    element.addEventListener('keydown',event=>{const key=event as KeyboardEvent;(window as any).__outsideKeys.push({key:key.key,prevented:key.defaultPrevented})});
  });
  await external.focus();
  await expect(external).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(external).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>(window as any).__outsideKeys)).toEqual([{key:'Escape',prevented:false},{key:'Tab',prevented:false}]);
  await expect(editor).toBeVisible();
  const first=editor.getByRole('button',{name:'Close node editor',exact:true});
  const last=editor.getByRole('button',{name:'Done',exact:true});
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await editor.getByLabel('Name',{exact:true}).focus();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('modal buttons activate with Enter without invoking linked-file or canvas shortcuts',async({page})=>{
  await openScene(page);
  await card(page,'The case is made').click();
  await page.getByLabel('Destination file (optional)',{exact:true}).fill(scenarioPath);
  await card(page,'The case is made').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  await editor.getByRole('button',{name:'Done',exact:true}).focus();
  await page.keyboard.press('Delete');
  expect((await saved(page,scenePath)).nodes).toHaveLength(10);
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog',{name:'Add to graph',exact:true})).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.file-path')).toHaveText(scenePath);
  await page.getByTitle('Open node in modal editor',{exact:true}).click();
  await editor.getByRole('button',{name:'Close node editor',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.file-path')).toHaveText(scenePath);
  expect((await saved(page,scenePath)).nodes).toHaveLength(10);
});

test('drag undo restores position and keyboard redo reapplies it',async({page})=>{
  await openScene(page);
  await page.waitForTimeout(300); // Initial fit animation, not application persistence.
  const position=async()=> (await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').position;
  const before=await position();
  const box=await card(page,'Stones at a hanged man').boundingBox();
  await page.mouse.move(box!.x+30,box!.y+10);await page.mouse.down();await page.mouse.move(box!.x+90,box!.y+70,{steps:12});await page.mouse.up();
  const after=await position();expect(after).not.toEqual(before);
  await page.keyboard.press('Control+z');await expect.poll(position).toEqual(before);
  await page.keyboard.press('Control+Shift+z');await expect.poll(position).toEqual(after);
});

test('connecting sockets adds a connection but repeating it never duplicates a way',async({page})=>{
  await openScene(page);
  const from=page.locator('.react-flow__node[data-id="motive"] .source');
  const to=page.locator('.react-flow__node[data-id="open-case"] .target');
  await dragHandle(page,from,to);
  await status(page,10,25,52);
  await expect(page.locator('.transition-way')).toHaveCount(1);
  await expect(page.locator('.transition-way')).toContainText('New transition');
  const after=await saved(page,scenePath);
  await dragHandle(page,from,to);
  await status(page,10,25,52);
  expect((await saved(page,scenePath)).edges).toEqual(after.edges);
  await expect(page.locator('.transition-way')).toHaveCount(1);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await status(page,10,24,51);
});

test('keyboard arrow movement is undoable without leaking measurements into files',async({page})=>{
  await openScene(page);
  const position=async()=> (await saved(page,scenePath)).nodes.find((node:any)=>node.id==='yard').position;
  const before=await position();
  const node=page.locator('.react-flow__node[data-id="yard"]');
  await card(page,'Stones at a hanged man').click();
  await node.focus();
  await node.press('ArrowRight');
  const after=await position();expect(after.x).toBeGreaterThan(before.x);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();await expect.poll(position).toEqual(before);
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();await expect.poll(position).toEqual(after);
  expect((await saved(page,scenePath)).nodes.every((node:any)=>!('measured' in node)&&!('selected' in node))).toBe(true);
});

test('map node editor opens the existing place note, not a fabricated map editor',async({page})=>{
  await page.locator('.scenario-missing-card').filter({hasText:'Places/Granary Yard.md'}).click();
  await page.getByRole('button',{name:'Open referenced file',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Host opened lore note'})).toContainText('Places/Granary Yard.md');
  expect(await page.evaluate(()=>(window as any).__kingmakerHarness.openedFiles.at(-1))).toBe('Places/Granary Yard.md');
  expect((await saved(page,scenarioPath)).nodes).toHaveLength(2);
});

test('exit nodes expose their real destination and persist editable destination links',async({page})=>{
  await openScene(page);
  await expect(page.locator('.story-card.exit .exit-destination')).toHaveCount(5);
  for(const destination of await page.locator('.story-card.exit .exit-destination').all()){
    await expect(destination).toContainText('Leads to');
    await expect(destination).toContainText('caerwyn-afternoon');
    await expect(destination).toContainText('No destination file linked');
  }
  await card(page,'The case is made').dblclick();
  const editor=page.getByRole('dialog',{name:'Edit node',exact:true});
  await expect(editor.getByLabel('Destination ID',{exact:true})).toHaveValue('caerwyn-afternoon');
  await expect(editor.getByLabel('Destination file (optional)',{exact:true})).toHaveValue('');
  await page.screenshot({path:'dist/screenshots/exit-destination.png'});
  await editor.getByLabel('Destination ID',{exact:true}).fill('caerwyn-court');
  await editor.getByLabel('Destination file (optional)',{exact:true}).fill(scenarioPath);
  await editor.getByRole('button',{name:'Close node editor',exact:true}).click();
  await expect(card(page,'The case is made').locator('.exit-destination')).toContainText('caerwyn-court');
  const document=await saved(page,scenePath);
  expect(document.nodes.find((node:any)=>node.id==='case-made').data.next).toBe('caerwyn-court');
  expect(document.nodes.find((node:any)=>node.id==='case-made').data.file).toBe(scenarioPath);
  expect(document.source.scene.exits['case-made'].next).toBe('caerwyn-afternoon');
  await page.reload();
  await card(page,'The case is made').click();
  await expect(page.getByLabel('Destination ID',{exact:true})).toHaveValue('caerwyn-court');
  await expect(page.getByLabel('Destination file (optional)',{exact:true})).toHaveValue(scenarioPath);
  await page.getByLabel('Destination ID',{exact:true}).fill('');
  await page.getByLabel('Destination file (optional)',{exact:true}).fill('');
  await expect(card(page,'The case is made').locator('.exit-destination')).toContainText('No destination set');
  await expect(page.getByRole('button',{name:'Open destination file',exact:true})).toHaveCount(0);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  expect(await saved(page,scenePath)).toEqual(document);
  await page.getByRole('button',{name:'Open destination file',exact:true}).click();
  await expect(page.locator('.file-path')).toHaveText(scenarioPath);
  expect(await saved(page,scenePath)).toEqual(document);
});

test('scenario opens real files without rewriting them and keeps exactly one protected Start',async({page})=>{
  const documents=flowDocuments();
  await seedDocuments(page,documents);
  const before=await page.evaluate(()=>(window as any).__kingmakerHarness.files);
  await expect(page.locator('.km-scenario')).toBeVisible();
  await expect(page.locator('.scenario-start-card')).toHaveCount(1);
  await expect(page.locator('.scenario-start-card')).toContainText('After character creation');
  await expect(scenarioInput(page,flowSourcePath,'arrival')).toHaveCount(1);
  await expect(scenarioInput(page,flowTargetPath,'road')).toHaveCount(1);
  await expect(scenarioInput(page,flowTargetPath,'river')).toHaveCount(1);
  await expect(scenarioOutput(page,flowSourcePath,'quiet')).toHaveCount(1);
  await expect(scenarioOutput(page,flowSourcePath,'guard')).toHaveCount(1);
  await page.locator('.scenario-start-card').click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('.scenario-start-card')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.scenario-start-card')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).__kingmakerHarness.files)).toEqual(before);
  expect((await saved(page,scenarioPath)).nodes).toHaveLength(0);
});

test('scenario Start connects to a named scene entry with undo and no source-file rewrite',async({page})=>{
  const documents=flowDocuments();
  await seedDocuments(page,documents);
  const originalSource=await saved(page,flowSourcePath);
  const start=page.locator('.scenario-start-card .react-flow__handle[data-handleid="start"]');
  await dragHandle(page,start,scenarioInput(page,flowSourcePath,'arrival'));
  await expect.poll(async()=>(await saved(page,scenarioPath)).scenario.entry).toEqual({file:flowSourcePath,entry:'arrival'});
  expect(await saved(page,flowSourcePath)).toEqual(originalSource);
  expect((await saved(page,scenarioPath)).nodes).toHaveLength(0);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await expect.poll(async()=>(await saved(page,scenarioPath)).scenario.entry).toBeUndefined();
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  await expect.poll(async()=>(await saved(page,scenarioPath)).scenario.entry).toEqual({file:flowSourcePath,entry:'arrival'});
  await page.reload();
  await expect(page.locator('.scenario-start-card')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('scenario wires distinct exits to named inputs and stores destinations in the owning scene',async({page})=>{
  await seedDocuments(page,flowDocuments());
  const originalScenario=await saved(page,scenarioPath);
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'quiet'),scenarioInput(page,flowTargetPath,'road'));
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data.entry).toBe('road');
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'guard'),scenarioInput(page,flowTargetPath,'river'));
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='guard').data.entry).toBe('river');
  const source=await saved(page,flowSourcePath);
  for(const [id,entry] of [['quiet','road'],['guard','river']]){
    expect(source.nodes.find((node:any)=>node.id===id).data).toMatchObject({next:'second-scene',file:flowTargetPath,entry,destinationKind:'scene'});
  }
  expect(await saved(page,scenarioPath)).toEqual(originalScenario);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  expect(await saved(page,flowSourcePath)).toEqual(source);
  await page.screenshot({path:'dist/screenshots/scenario-file-ports.png'});
});

test('rewiring an authored exit requires confirmation and undo restores the original file',async({page})=>{
  const documents=flowDocuments();
  Object.assign(documents[flowSourcePath].nodes.find(node=>node.id==='quiet')!.data,{next:'second-scene',file:flowTargetPath,entry:'road',destinationKind:'scene'});
  await seedDocuments(page,documents);
  const before=await saved(page,flowSourcePath);
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'quiet'),scenarioInput(page,flowTargetPath,'river'));
  const confirmation=page.getByRole('alertdialog',{name:'Replace exit destination?',exact:true});
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  expect(await saved(page,flowSourcePath)).toEqual(before);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await saved(page,flowSourcePath)).toEqual(before);
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'quiet'),scenarioInput(page,flowTargetPath,'river'));
  await confirmAction(page,'Replace exit destination?','Replace destination');
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data.entry).toBe('river');
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await expect.poll(async()=>saved(page,flowSourcePath)).toEqual(before);
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data.entry).toBe('river');
});

test('missing scenario destination remains an explicit unresolved file, never fabricated content',async({page})=>{
  const documents=flowDocuments(),missing='Scenes/Missing scene.kmscene';
  Object.assign(documents[flowSourcePath].nodes.find(node=>node.id==='quiet')!.data,{next:'missing-scene',file:missing,entry:'unseen',destinationKind:'scene'});
  await seedDocuments(page,documents);
  const before=await page.evaluate(()=>(window as any).__kingmakerHarness.files);
  await expect(page.locator('.scenario-missing-card')).toContainText(missing);
  await expect(page.locator('.scenario-missing-card')).toContainText(/missing|unresolved/i);
  expect(await page.evaluate(()=>(window as any).__kingmakerHarness.files)).toEqual(before);
  expect(before[missing]).toBeUndefined();
});

test('scene supports multiple named starts with output-only sockets and saved internal transitions',async({page})=>{
  await openScene(page);
  await page.getByRole('button',{name:/Add node A/}).click();
  await page.screenshot({path:'dist/screenshots/start-node-menu.png'});
  await page.getByRole('button',{name:'Start A named input port for entering this file',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('At the river gate');
  const first=(await saved(page,scenePath)).nodes.find((node:any)=>node.data.kind==='start');
  const firstNode=page.locator(`.react-flow__node[data-id=${JSON.stringify(first.id)}]`);
  await expect(firstNode.locator('.source')).toHaveCount(1);
  await expect(firstNode.locator('.target')).toHaveCount(0);
  await dragHandle(page,firstNode.locator('.source'),page.locator('.react-flow__node[data-id="yard"] .target'));
  await status(page,11,25,52);
  await card(page,'At the river gate').click();
  await page.getByRole('button',{name:/Add node A/}).click();
  await page.getByRole('button',{name:'Start A named input port for entering this file',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Under cover of darkness');
  await status(page,12,25,52);
  const document=await saved(page,scenePath);
  expect(document.nodes.filter((node:any)=>node.data.kind==='start')).toHaveLength(2);
  expect(document.nodes.find((node:any)=>node.id==='yard').data.start).toBe(true);
  expect(document.edges.some((edge:any)=>edge.source===first.id&&edge.target==='yard')).toBe(true);
  await page.reload();
  await expect(page.locator('.story-card.start')).toHaveCount(2);
  await expect(card(page,'At the river gate')).toBeVisible();
  await expect(card(page,'Under cover of darkness')).toBeVisible();
  expect(await saved(page,scenePath)).toEqual(document);
});

test('scene exit chooses a real file and named input while preserving imported source metadata',async({page})=>{
  await seedDocuments(page,{[flowTargetPath]:flowDocuments()[flowTargetPath]},scenePath);
  const before=await saved(page,scenePath);
  await card(page,'The case is made').click();
  await page.getByRole('button',{name:'Choose scene or map input',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Choose destination',exact:true});
  const result=picker.locator('.destination-result').filter({hasText:flowTargetPath});
  await expect(result.getByRole('button',{name:'By road',exact:true})).toBeVisible();
  await result.getByRole('button',{name:'By river',exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'Change destination?',exact:true});
  await expect(confirmation).toBeVisible();
  expect(await saved(page,scenePath)).toEqual(before);
  await confirmAction(page,'Change destination?','Change destination');
  const after=await saved(page,scenePath);
  expect(after.nodes.find((node:any)=>node.id==='case-made').data).toMatchObject({next:'second-scene',file:flowTargetPath,entry:'river',destinationKind:'scene'});
  expect(after.source).toEqual(before.source);
  await expect(card(page,'The case is made').locator('.source')).toHaveCount(0);
  await expect(card(page,'The case is made').locator('.target')).toHaveCount(1);
  await expect(card(page,'The case is made').locator('.exit-destination')).toContainText('Input: river');
  await page.reload();
  await card(page,'The case is made').click();
  await expect(page.getByRole('combobox',{name:'Destination input',exact:true})).toHaveValue('river');
  await page.getByRole('button',{name:'Open destination file',exact:true}).click();
  await expect(page.locator('.file-path')).toHaveText(flowTargetPath);
  await expect(card(page,'By river')).toBeVisible();
  expect(await saved(page,scenePath)).toEqual(after);
});

test('scenario refreshes names and ports from external source edits without changing its own file',async({page})=>{
  await seedDocuments(page,flowDocuments());
  await expect(scenarioCard(page,flowSourcePath)).toContainText('First Scene');
  const originalScenario=await saved(page,scenarioPath);
  const updated=await saved(page,flowSourcePath);
  updated.title='A revised arrival';
  updated.nodes.push(fixtureNode('hidden-door','Through the hidden door','start',0,400));
  await page.evaluate(async({path,document})=>(window as any).__kingmakerHarness.writeDocument(path,document),{path:flowSourcePath,document:updated});
  await expect(page.locator('.file-path')).toHaveText(scenarioPath);
  await expect(scenarioCard(page,flowSourcePath)).toContainText('A revised arrival');
  await expect(scenarioInput(page,flowSourcePath,'hidden-door')).toHaveCount(1);
  expect(await saved(page,scenarioPath)).toEqual(originalScenario);
});

test('scenario keeps map ports and wiring while the spatial editor has only Paint and Game preview',async({page})=>{
  const documents=flowDocuments();
  documents[scenarioPath].scenario.files.push(flowMapPath);
  documents[scenarioPath].scenario.positions[flowMapPath]={x:880,y:500};
  await seedDocuments(page,documents);
  await expect(scenarioInput(page,flowMapPath,'upstream')).toHaveCount(1);
  await expect(scenarioOutput(page,flowMapPath,'downstream')).toHaveCount(1);
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'quiet'),scenarioInput(page,flowMapPath,'upstream'));
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data.destinationKind).toBe('map');
  expect((await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data).toMatchObject({next:'river-map',file:flowMapPath,entry:'upstream',destinationKind:'map'});
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'guard'),scenarioInput(page,flowTargetPath,'road'));
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='guard').data.entry).toBe('road');
  await dragHandle(page,page.locator('.scenario-start-card .react-flow__handle[data-handleid="start"]'),scenarioInput(page,flowSourcePath,'arrival'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.screenshot({path:'dist/screenshots/scenario-scene-and-map-flow.png'});
  await scenarioCard(page,flowMapPath).dblclick();
  await expect(page.locator('.file-path')).toHaveText(flowMapPath);
  await expect(page.getByRole('button',{name:'Paint',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('navigation',{name:'Map views'}).getByRole('button')).toHaveText(['Paint','Game preview Tab']);
  await expect(page.getByRole('button',{name:'Ports',exact:true})).toHaveCount(0);
  const before=await saved(page,flowMapPath);
  await page.getByRole('button',{name:'Game preview Tab',exact:true}).click();await page.getByRole('button',{name:'Paint',exact:true}).click();expect(await saved(page,flowMapPath)).toEqual(before);
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(scenarioPath);
  await expect(scenarioInput(page,flowMapPath,'upstream')).toHaveCount(1);await expect(scenarioOutput(page,flowMapPath,'downstream')).toHaveCount(1);
  expect((await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data).toMatchObject({file:flowMapPath,entry:'upstream',destinationKind:'map'});
});

test('adding an existing map to a scenario keeps its source file unchanged through undo and redo',async({page})=>{
  await seedDocuments(page,flowDocuments());
  const originalMap=await saved(page,flowMapPath);
  const originalFiles=await page.evaluate(()=>Object.keys((window as any).__kingmakerHarness.files).sort());
  await expect(scenarioCard(page,flowMapPath)).toHaveCount(0);
  await page.getByRole('button',{name:/^Add scene or map/}).click();
  const picker=page.getByRole('dialog',{name:'Add scene or map',exact:true});
  await picker.getByLabel('Search files',{exact:true}).fill('Travelling the river');
  await picker.locator(`.scenario-file-choice[data-file=${JSON.stringify(flowMapPath)}]`).getByRole('button',{name:'Add to scenario',exact:true}).click();
  await expect(scenarioCard(page,flowMapPath)).toBeVisible();
  expect((await saved(page,scenarioPath)).scenario.files).toContain(flowMapPath);
  expect(await saved(page,flowMapPath)).toEqual(originalMap);
  expect(await page.evaluate(()=>Object.keys((window as any).__kingmakerHarness.files).sort())).toEqual(originalFiles);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await expect(scenarioCard(page,flowMapPath)).toHaveCount(0);
  expect(await saved(page,flowMapPath)).toEqual(originalMap);
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  await expect(scenarioCard(page,flowMapPath)).toBeVisible();
  expect(await saved(page,flowMapPath)).toEqual(originalMap);
});

test('creating a map from the scenario makes a real kmmap file ready for named ports',async({page})=>{
  await page.getByRole('button',{name:/^Add scene or map/}).click();
  page.once('dialog',dialog=>void dialog.accept('The Northern Road'));
  await page.getByRole('button',{name:'Create map file',exact:true}).click();
  const path='Maps/The Northern Road.kmmap';
  await expect(scenarioCard(page,path)).toBeVisible();
  expect((await saved(page,path)).kind).toBe('map');
  expect((await saved(page,scenarioPath)).scenario.files).toContain(path);
  await page.getByRole('button',{name:'Open source file',exact:true}).click();
  await expect(page.locator('.file-path')).toHaveText(path);
  await expect(page.locator('.map-stage canvas')).toBeVisible();
  await expect(page.getByRole('button',{name:'Ports',exact:true})).toHaveCount(0);
  await page.locator('.map-stage canvas').click({button:'right'});
  await page.getByRole('menuitem',{name:'Add spawn point…'}).click();
  await page.getByLabel('Spawn point name').fill('From the city gate');
  await page.getByRole('button',{name:'Save spawn point',exact:true}).click();
  expect((await saved(page,path)).nodes[0].data).toMatchObject({kind:'start',title:'From the city gate',mapFeature:'spawn'});
  await page.reload();
  await expect(page.getByRole('button',{name:'Edit spawn point From the city gate',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Ports',exact:true})).toHaveCount(0);
});

test('scenario keyboard movement persists layout only and is undoable',async({page})=>{
  await seedDocuments(page,flowDocuments());
  const before=await saved(page,scenarioPath),source=await saved(page,flowSourcePath);
  const node=page.locator(`.react-flow__node[data-id=${JSON.stringify('file:'+flowSourcePath)}]`);
  await scenarioCard(page,flowSourcePath).click();
  await node.focus();
  await node.press('ArrowRight');
  await expect.poll(async()=>(await saved(page,scenarioPath)).scenario.positions[flowSourcePath].x).toBeGreaterThan(before.scenario.positions[flowSourcePath].x);
  const after=await saved(page,scenarioPath);
  expect(after.nodes).toHaveLength(0);
  expect(await saved(page,flowSourcePath)).toEqual(source);
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await expect.poll(async()=>saved(page,scenarioPath)).toEqual(before);
  await page.getByTitle('Redo (Ctrl Shift Z)',{exact:true}).click();
  await expect.poll(async()=>saved(page,scenarioPath)).toEqual(after);
});

test('scenario undo refuses to overwrite a source file changed elsewhere',async({page})=>{
  await seedDocuments(page,flowDocuments());
  await dragHandle(page,scenarioOutput(page,flowSourcePath,'quiet'),scenarioInput(page,flowTargetPath,'road'));
  await expect.poll(async()=>(await saved(page,flowSourcePath)).nodes.find((node:any)=>node.id==='quiet').data.entry).toBe('road');
  const external=await saved(page,flowSourcePath);
  external.title='Externally revised first scene';
  await page.evaluate(async({path,document})=>(window as any).__kingmakerHarness.writeDocument(path,document),{path:flowSourcePath,document:external});
  await expect(scenarioCard(page,flowSourcePath)).toContainText('Externally revised first scene');
  await page.getByTitle('Undo (Ctrl Z)',{exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(/changed (outside|elsewhere)/i);
  await expect(page.getByRole('alert')).toContainText(/nothing was overwritten/i);
  expect(await saved(page,flowSourcePath)).toEqual(external);
});

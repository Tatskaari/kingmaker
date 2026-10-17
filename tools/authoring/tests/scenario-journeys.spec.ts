import {test,expect,type Page,type Locator} from '@playwright/test';
import {serializeDocument,type GraphDocument,type Kind} from '../src/model';
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
const confirmAction=async(page:Page,title:string,action:string)=>{
  const confirmation=page.getByRole('alertdialog',{name:title,exact:true});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:action,exact:true}).click();
  await expect(confirmation).toHaveCount(0);
};
// The scenario editor works on the plugin's own version 1 files (M4 replaces it): these journeys seed
// their own scenario, scenes and map, beside the game's campaign the harness holds.
test.beforeEach(async({page})=>{
  await page.goto('/');
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(scenarioPath);
  await expect(page.locator('.file-path')).toHaveText(scenarioPath);
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

import {test,expect} from '@playwright/test';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {entryPorts,groupConnections,serializeDocument,type GraphDocument} from '../src/model';
import {prototypeGame} from './prototype-game.mjs';

const scenePath='Scenes/The Hanged Clerk.kmscene',scenarioPath='Scenarios/Caerwyn.kmscenario';
let directory:string;
let prototype:{game:string;done:()=>void}|undefined;
let files:Record<string,string>;
let scenes:{file:string;document:GraphDocument}[];

test.beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'kingmaker-import-journey-'));
  const vault=path.join(directory,'vault');
  await cp(fileURLToPath(new URL('../examples/',import.meta.url)),vault,{recursive:true});
  // The retired prototype's scenes: a checkout of them, or by default its last commit out of git history.
  prototype=prototypeGame();
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/import-main-campaign.mjs',import.meta.url)),prototype.game,vault,'--write'],{encoding:'utf8',timeout:30000});
  expect(result.status,result.stderr).toBe(0);
  const report=JSON.parse(result.stdout);
  scenes=await Promise.all([scenePath,...report.scenes.map((scene:{file:string})=>scene.file)].map(async(file:string)=>({file,document:JSON.parse(await readFile(path.join(vault,file),'utf8'))})));
  const afternoon=scenes.find(scene=>scene.document.id==='caerwyn-afternoon')!;
  // Fixture-only links complete the preserved original Hanged Clerk authoring copy.
  // The importer itself must never rewrite that file or its authored edits.
  for(const node of scenes[0].document.nodes){
    if(node.data.kind==='exit'&&node.data.next===afternoon.document.id)Object.assign(node.data,{file:afternoon.file,entry:entryPorts(afternoon.document)[0].id,destinationKind:'scene'});
  }
  const scenario:GraphDocument={format:'kingmaker',version:1,kind:'scenario',id:'import-smoke',title:'Caerwyn — complete authored sequence',description:'File-backed import verification',nodes:[],edges:[],lore:[],scenario:{files:[scenePath],entry:{file:scenePath,entry:'yard'}}};
  files=Object.fromEntries([...scenes.map(scene=>[scene.file,serializeDocument(scene.document)]),[scenarioPath,serializeDocument(scenario)]]);
});
test.afterAll(async()=>{prototype?.done();if(directory)await rm(directory,{recursive:true,force:true})});

test('an imported two-node interlude renders its transition on direct open',async({page})=>{
  const scene=scenes.find(scene=>scene.document.id==='caerwyn-afternoon')!;
  await page.goto('/');
  await page.evaluate(({files,file})=>{
    localStorage.setItem('kingmaker-authoring-test-files-v2',JSON.stringify(files));
    localStorage.setItem('kingmaker-authoring-test-active-v2',file);
  },{files,file:scene.file});
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(scene.file);
  await expect(page.locator('.story-card')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('all six imported campaign scenes are reachable and open their complete file-backed graphs',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:2000,height:1200});
  await page.goto('/');
  await page.evaluate(({files,scenarioPath})=>{
    localStorage.setItem('kingmaker-authoring-test-files-v2',JSON.stringify(files));
    localStorage.setItem('kingmaker-authoring-test-active-v2',scenarioPath);
  },{files,scenarioPath});
  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(scenarioPath);
  await expect(page.locator('.scenario-card[data-file]')).toHaveCount(6);
  await expect(page.locator('.scenario-start-card')).toHaveCount(1);
  await expect(page.locator('.scenario-missing-card')).toHaveCount(0);
  const destinations=1+scenes.reduce((count,scene)=>count+scene.document.nodes.filter(node=>node.data.kind==='exit'&&node.data.file).length,0);
  await expect(page.locator('.statusbar')).toContainText(`6 source files · ${destinations} destinations`);
  await expect(page.locator('.react-flow__edge')).toHaveCount(destinations);
  for(const scene of scenes)await expect(page.locator(`.scenario-card[data-file=${JSON.stringify(scene.file)}] h3`)).toHaveText(scene.document.title);
  await page.getByTitle('Fit graph (F)',{exact:true}).click();
  await page.locator('.react-flow__viewport').evaluate(element=>new Promise<void>(resolve=>{
    let previous='',stable=0;
    const sample=()=>{const transform=(element as HTMLElement).style.transform;stable=transform===previous?stable+1:0;previous=transform;if(stable>=8)resolve();else requestAnimationFrame(sample)};
    sample();
  }));
  await page.screenshot({path:'dist/screenshots/imported-caerwyn-sequence.png'});
  for(const scene of scenes){
    await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption(scene.file);
    await expect(page.locator('.file-path')).toHaveText(scene.file);
    await expect(page.getByRole('heading',{level:1})).toHaveText(scene.document.title);
    await expect(page.locator('.story-card')).toHaveCount(scene.document.nodes.length);
    await expect(page.locator('.react-flow__edge')).toHaveCount(groupConnections(scene.document.edges).length);
    await expect(page.locator('.statusbar')).toContainText(`${scene.document.nodes.length} nodes · ${groupConnections(scene.document.edges).length} node pairs · ${scene.document.edges.length} transitions`);
    if(scene.document.id==='drowned-rat')await page.screenshot({path:'dist/screenshots/imported-drowned-rat.png'});
  }
  const after=await page.evaluate(()=>(window as any).__kingmakerHarness.files);
  for(const [file,contents] of Object.entries(files))expect(after[file],`${file} is not rewritten simply by opening it`).toBe(contents);
  expect(errors).toEqual([]);
});

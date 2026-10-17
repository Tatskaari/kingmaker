import {test,expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The plugin's bundle as Obsidian loads it: dist/plugin/main.js (or the one KINGMAKER_PLUGIN names, such
// as a vault's installed copy) evaluated as CommonJS with the obsidian module given, here a small
// implementation of the public API in a real page, over a vault of the campaign folder's files (or
// KINGMAKER_VAULT's). Every scene of the campaign opens in its scene editor with nothing written.
// This is the test host, not Obsidian's desktop UI.
const root=fileURLToPath(new URL('..',import.meta.url));
const bundlePath=path.resolve(root,process.env.KINGMAKER_PLUGIN??'dist/plugin/main.js');
const vaultPath=path.resolve(root,process.env.KINGMAKER_VAULT??'../../campaigns/caerwyn');

async function vaultFiles(){
  const entries=await readdir(vaultPath,{recursive:true,withFileTypes:true});
  const files:Record<string,string>={};
  for(const entry of entries){
    const file=path.relative(vaultPath,path.join(entry.parentPath,entry.name)).split(path.sep).join('/');
    if(!entry.isFile()||file.split('/').some(part=>part.startsWith('.')))continue;
    files[file]=await readFile(path.join(vaultPath,file),'utf8');
  }
  return files;
}

test('the plugin\'s bundle loads under the test host and opens every scene of the vault in its scene editor',async({page})=>{
  const [bundle,styles,files]=await Promise.all([readFile(bundlePath,'utf8'),readFile(path.join(path.dirname(bundlePath),'styles.css'),'utf8'),vaultFiles()]);
  const scenes=Object.keys(files).filter(file=>/^scenes\/[^/]+\.kmscene$/.test(file)).sort();
  expect(scenes.length).toBeGreaterThanOrEqual(7);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1500,height:950});
  await page.setContent(`<!doctype html><html><head><style>${styles}</style><style>html,body{margin:0;height:100%}.view{width:1500px;height:950px}</style></head><body></body></html>`);

  const results=await page.evaluate(async({bundle,files,scenes})=>{
    // ---- The public Obsidian API, as much of it as the plugin uses ----
    const writes:string[]=[],notices:string[]=[];
    class TFolder{constructor(public path:string){}name=''}
    class TFile{name:string;extension:string;basename:string;parent:TFolder;constructor(public path:string){this.name=path.split('/').at(-1)!;this.extension=this.name.split('.').at(-1)!;this.basename=this.name.replace(/\.[^.]+$/,'');this.parent=new TFolder(path.split('/').slice(0,-1).join('/'))}}
    const entries=new Map<string,TFile|TFolder>(Object.keys(files).map(file=>[file,new TFile(file)]));
    for(const folder of new Set(Object.keys(files).flatMap(file=>file.split('/').slice(0,-1).map((_,i,parts)=>parts.slice(0,i+1).join('/')))))entries.set(folder,new TFolder(folder));
    const vault={
      on:()=>({}),getRoot:()=>new TFolder(''),getAbstractFileByPath:(p:string)=>entries.get(p)??null,
      getFiles:()=>[...entries.values()].filter(e=>e instanceof TFile),getMarkdownFiles:()=>[...entries.values()].filter(e=>e instanceof TFile&&e.extension==='md'),
      cachedRead:async(f:TFile)=>files[f.path],read:async(f:TFile)=>files[f.path],
      modify:async(f:TFile,text:string)=>{writes.push(f.path);files[f.path]=text},
      process:async(f:TFile,fn:(t:string)=>string)=>{const next=fn(files[f.path]);if(next!==files[f.path]){writes.push(f.path);files[f.path]=next}return next},
      create:async(p:string,text:string)=>{writes.push(p);files[p]=text;const f=new TFile(p);entries.set(p,f);return f},
    };
    const app={vault,workspace:{on:()=>({}),getActiveFile:()=>null,getLeaf:()=>({openFile:async()=>{}})},metadataCache:{getFileCache:()=>null,getFirstLinkpathDest:()=>null}};
    class Component{registerEvent(){}}
    class Plugin extends Component{views:Array<[string,(leaf:unknown)=>unknown]>=[];extensions:unknown[]=[];constructor(public app:unknown,public manifest:unknown){super()}registerView(type:string,make:(leaf:unknown)=>unknown){this.views.push([type,make])}registerExtensions(...args:unknown[]){this.extensions.push(args)}addCommand(){}addRibbonIcon(){}}
    class TextFileView extends Component{app=app;file:TFile|null=null;data='';contentEl:HTMLElement;constructor(_leaf:unknown){super();this.contentEl=document.createElement('div');this.contentEl.className='view';document.body.append(this.contentEl)}requestSave(){}
      async onLoadFile(file:TFile){this.file=file;this.data=files[file.path];(this as any).setViewData(this.data,true)}
      async onUnloadFile(){const raw=(this as any).getViewData();if(this.file&&raw!==this.data){await vault.modify(this.file,raw);this.data=raw}(this as any).clear();this.file=null}
      async onRename(){}}
    class Modal{constructor(public app:unknown){}open(){}close(){}}
    const obsidian={Plugin,TextFileView,TFile,TFolder,Modal,FuzzySuggestModal:Modal,Setting:class{},Notice:class{constructor(message:string){notices.push(message)}},normalizePath:(p:string)=>p.replace(/\/+/g,'/').replace(/^\/|\/$/g,'')};

    // ---- The bundle, loaded as Obsidian loads a plugin ----
    const module={exports:{} as any};
    new Function('module','exports','require',bundle)(module,module.exports,(name:string)=>{if(name==='obsidian')return obsidian;if(name==='electron')return {};throw new Error(`The bundle asked for ${name}`)});
    const plugin=new module.exports.default(app,{id:'kingmaker-authoring'});
    await plugin.onload();
    const [[viewType,makeView]]=plugin.views;

    // ---- Every scene, opened in its own view ----
    const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
    const opened=[];
    for(const scene of scenes){
      const view=makeView({app}) as TextFileView&{getViewData:()=>string};
      await view.onLoadFile(entries.get(scene) as TFile);
      let cards=0,problems='',title='';
      for(let i=0;i<100&&!(cards&&/^Problems\d+$/.test(problems));i++){
        await settle();
        cards=view.contentEl.querySelectorAll('.scene-card').length;
        problems=[...view.contentEl.querySelectorAll('[role=tab]')].map(tab=>tab.textContent??'').find(text=>text.startsWith('Problems'))??'';
        title=view.contentEl.querySelector('h1')?.textContent??'';
      }
      const document=JSON.parse(files[scene]);
      opened.push({scene,viewType,cards,nodes:document.nodes.length,title,expected:document.title,problems,same:view.getViewData()===files[scene]});
      await view.onUnloadFile();
      view.contentEl.remove();
    }
    return {opened,writes,notices};
  },{bundle,files,scenes});

  for(const result of results.opened){
    expect(result,result.scene).toMatchObject({viewType:'kingmaker-authoring-file',cards:result.nodes,title:result.expected,problems:'Problems0',same:true});
  }
  expect(results.opened.map(result=>result.scene)).toEqual(scenes);
  expect(results.writes).toEqual([]);
  expect(results.notices).toEqual([]);
  expect(errors).toEqual([]);
});

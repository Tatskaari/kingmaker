// Test-only host. The installed product is plugin.tsx, running inside Obsidian.
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LegacyScenario,LegacyScene,MapApp,MapMigration,PlaceApp,ScenarioApp,SceneApp} from './App';
import {openSceneFile,serializeScene} from './scene/model.ts';
import type {SceneDocument} from './scene/model.ts';
import {campaignRootOf,lorePathOf,readCampaign,scenePathOf} from './scene/campaign.ts';
import type {SceneHost} from './scene/host.ts';
import {kindOfPath} from './campaign/files.ts';
import type {FileHost,MigrationHost} from './campaign/host.ts';
import {serializeJson} from './campaign/json.ts';
import {openScenarioFile} from './scenario/model.ts';
import {mapFileKind,openMapFile} from './map/model.ts';
import {readV1Map} from './map/migrate.ts';
import {openPlaceFile} from './place/model.ts';

/**
 * The browser test harness: the same editors over a vault of files in memory (kept in localStorage),
 * seeded with the game's campaign as the vault Obsidian opens: its scenario, scenes/, maps/, places/,
 * looks and lore/ (build.mjs's fixtures.json), beside the plugin's version 1 files (tests/fixtures/v1),
 * which open read-only or, a map, with the offer to migrate it. A lore note opened is shown, as
 * Obsidian would open it in a tab.
 */
type Note={path:string;text:string};
type Fixtures={files:Record<string,string>;notes:Note[]};
const storageKey='kingmaker-authoring-test-files-v2';
const activeKey='kingmaker-authoring-test-active-v2';
const defaultFile='scenes/hanged-clerk.kmscene';
const fixtures:Fixtures=await fetch('/fixtures.json').then(response=>response.json());
const files:Record<string,string>={...fixtures.files,...JSON.parse(localStorage.getItem(storageKey)??'{}')};
const notes=new Map(fixtures.notes.map(note=>[note.path,note]));
const openedFiles:string[]=[];
const listeners=new Set<()=>void>(),revisions:Record<string,number>={};
const notify=()=>{for(const listener of [...listeners])listener()};
const store=()=>localStorage.setItem(storageKey,JSON.stringify(files));
const editable=(path:string)=>/\.km(scene|scenario|map|place)$/.test(path);
/** A file changed outside its editor (a test's external edit): its editor starts again from it. */
const externalWrite=(path:string,document:unknown)=>{
  files[path]=typeof document==='string'?document:(document as {version?:unknown}).version===2&&(document as {kind?:unknown}).kind==='scene'?serializeScene(document as SceneDocument):serializeJson(document);
  revisions[path]=(revisions[path]??0)+1;store();notify();
};
declare global{interface Window{__kingmakerHarness:{files:Record<string,string>;openedFiles:string[];activePath:string;writeDocument:(path:string,document:unknown)=>void}}}
window.__kingmakerHarness={files,openedFiles,activePath:defaultFile,writeDocument:externalWrite};

/** The harness's vault as the editors read their campaign. */
const vaultFiles={
  list:(folder:string)=>[...Object.keys(files),...notes.keys()].filter(path=>path.startsWith(folder)),
  read:async(path:string)=>files[path]??notes.get(path)?.text,
};

function Harness(){
  const [activePath,setActivePath]=useState(localStorage.getItem(activeKey)??defaultFile);
  const [openedNote,setOpenedNote]=useState<Note|null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);listeners.add(refresh);return()=>{listeners.delete(refresh)}},[]);
  window.__kingmakerHarness.activePath=activePath;
  const openFile=async(path:string)=>{
    openedFiles.push(path);
    if(path in files&&editable(path)){setActivePath(path);localStorage.setItem(activeKey,path);setOpenedNote(null);return}
    const note=notes.get(path)??(path in files?{path,text:files[path]}:undefined);
    if(!note)throw Error(`File not found: ${path}`);
    setOpenedNote(note);
  };
  const sceneHost:SceneHost=useMemo(()=>{const root=campaignRootOf(activePath);return {
    filePath:activePath,
    change:scene=>{files[activePath]=serializeScene(scene);store();notify()},
    campaign:()=>readCampaign(activePath,vaultFiles),
    subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
    openLore:path=>openFile(lorePathOf(root,path)),
    openScene:id=>openFile(scenePathOf(root,id)),
  }},[activePath]);
  const fileHost:MigrationHost=useMemo(()=>({
    filePath:activePath,
    change:doc=>{files[activePath]=serializeJson(doc);store();notify()},
    files:vaultFiles,
    write:async(path,before,after)=>{
      if(!(path in files))throw Error(`Kingmaker file not found: ${path}`);
      if(files[path]!==before)throw Error(`Edit conflict: ${path} changed. Nothing was overwritten: try again.`);
      files[path]=after;store();notify();
    },
    create:async(path,text)=>{if(path in files)throw Error(`There's a file at ${path} already.`);files[path]=text;store();notify()},
    subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
    open:openFile,
    replace:text=>{files[activePath]=text;revisions[activePath]=(revisions[activePath]??0)+1;store();notify()},
  }),[activePath]);
  return <div className="test-harness">
    <header className="harness-banner"><span>Browser test harness · not the installed Obsidian plugin</span><label>Test file<select aria-label="Test file" value={activePath} onChange={event=>void openFile(event.target.value)}>{Object.keys(files).filter(editable).sort().map(path=><option key={path}>{path}</option>)}</select></label></header>
    <div className="harness-editor" data-file-revision={revision}><Editor key={`${activePath}:${revisions[activePath]??0}`} path={activePath} sceneHost={sceneHost} fileHost={fileHost}/></div>
    {openedNote&&<div className="harness-note" role="dialog" aria-label="Host opened lore note"><header><h2>{openedNote.path}</h2><button onClick={()=>setOpenedNote(null)}>Close note</button></header><p>The test host received openFile. In Obsidian this opens the original Markdown file in a normal editor tab.</p><pre>{openedNote.text}</pre></div>}
  </div>;
}

/** The file's editor, as the plugin picks it: one of the game's files to edit, or a version 1 file read-only (a map, to migrate). */
function Editor({path,sceneHost,fileHost}:{path:string;sceneHost:SceneHost;fileHost:MigrationHost}){
  // The file as it opened: the editor keeps its own state from here (the harness remounts it when the file changes outside it).
  const [opened]=useState(()=>{
    const raw=files[path],kind=kindOfPath(path);
    try{
      if(kind==='scenario'){
        const value=JSON.parse(raw);
        if(value?.format==='kingmaker'&&value.version===1)return <LegacyScenario path={path} title={value.title??''} files={value.scenario?.files?.length??0}/>;
        return <ScenarioApp document={openScenarioFile(raw)} host={fileHost as unknown as FileHost<any>}/>;
      }
      if(kind==='map'){
        if(mapFileKind(raw)==='v1'){readV1Map(raw);return <MapMigration text={raw} host={fileHost}/>}
        return <MapApp document={openMapFile(raw)} host={fileHost as unknown as FileHost<any>}/>;
      }
      if(kind==='place')return <PlaceApp document={openPlaceFile(raw)} host={fileHost as unknown as FileHost<any>}/>;
      const scene=openSceneFile(raw);
      return scene.kind==='scene'?<SceneApp document={scene.doc} host={sceneHost}/>:<LegacyScene path={path} title={scene.title} nodes={scene.nodes} routes={scene.routes}/>;
    }catch(error){return <div className="km-file-error" style={{padding:24}}><h3>Cannot open this Kingmaker file</h3><p>{(error as Error).message}</p></div>}
  });
  return opened;
}

createRoot(document.getElementById('root')!).render(<Harness/>);

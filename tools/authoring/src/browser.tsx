// Test-only host. The installed product is plugin.tsx, running inside Obsidian.
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App,LegacyScene,SceneApp} from './App';
import {emptyDocument,parseDocument,serializeDocument} from './model';
import type {ContentFile,GraphDocument,Host} from './model';
import {openSceneFile,serializeScene} from './scene/model.ts';
import type {SceneDocument} from './scene/model.ts';
import {campaignRootOf,lorePathOf,readCampaign,scenePathOf} from './scene/campaign.ts';
import type {SceneHost} from './scene/host.ts';

/**
 * The browser test harness: the same editors over a vault of files in memory (kept in localStorage),
 * seeded with the game's campaign as the vault Obsidian opens: campaign.json, places/, scenes/ and
 * lore/ (build.mjs's fixtures.json), beside the version 1 files the scenario and map editors still
 * edit (tests/fixtures/v1). A lore note opened is shown, as Obsidian would open it in a tab.
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
const editable=(path:string)=>/\.km(scene|scenario|map)$/.test(path);
const externalWrite=(path:string,document:GraphDocument|SceneDocument|string)=>{
  files[path]=typeof document==='string'?document:document.version===2?serializeScene(document as SceneDocument):serializeDocument(document as GraphDocument);
  revisions[path]=(revisions[path]??0)+1;store();notify();
};
declare global{interface Window{__kingmakerHarness:{files:Record<string,string>;openedFiles:string[];activePath:string;writeDocument:(path:string,document:GraphDocument|SceneDocument|string)=>void}}}
window.__kingmakerHarness={files,openedFiles,activePath:defaultFile,writeDocument:externalWrite};

/** The harness's vault as the scene editor reads its campaign. */
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
  const graphHost:Host=useMemo(()=>{const create=async(kind:'scene'|'map')=>{
    const title=window.prompt(`Name the new ${kind} file`);if(!title?.trim())return null;
    const safe=title.trim().replace(/[\\/:*?"<>|]/g,'-'),folder=kind==='map'?'Maps':'Scenes',extension=kind==='map'?'kmmap':'kmscene';
    let path=`${folder}/${safe}.${extension}`,suffix=2;
    while(path in files)path=`${folder}/${safe} ${suffix++}.${extension}`;
    files[path]=serializeDocument(emptyDocument(kind,title.trim()));store();notify();
    return {path,title:title.trim()};
  };return {
    filePath:activePath,
    change:document=>{files[activePath]=serializeDocument(document);store();notify()},
    openFile,
    createScene:()=>create('scene'),createMap:()=>create('map'),
    listDocuments:async()=>Object.entries(files).filter(([path])=>/\.km(scene|map)$/.test(path)).map(([path,raw]):ContentFile=>{try{return {path,document:parseDocument(raw)}}catch(error){return {path,error:String(error)}}}),
    readDocument:async(path)=>{if(!(path in files))throw Error(`File not found: ${path}`);return parseDocument(files[path])},
    writeDocument:async(path,before,after)=>{if(!(path in files)||serializeDocument(parseDocument(files[path]))!==serializeDocument(before))throw Error('The source file changed elsewhere. Refresh before editing.');if(!/\.km(scene|map)$/.test(path))throw Error('Only scene or map files can own ports.');externalWrite(path,after)},
    subscribeDocuments:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
  }},[activePath]);
  const sceneHost:SceneHost=useMemo(()=>{const root=campaignRootOf(activePath);return {
    filePath:activePath,
    change:scene=>{files[activePath]=serializeScene(scene);store();notify()},
    campaign:()=>readCampaign(activePath,vaultFiles),
    subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
    openLore:path=>openFile(lorePathOf(root,path)),
    openScene:id=>openFile(scenePathOf(root,id)),
  }},[activePath]);
  return <div className="test-harness">
    <header className="harness-banner"><span>Browser test harness · not the installed Obsidian plugin</span><label>Test file<select aria-label="Test file" value={activePath} onChange={event=>void openFile(event.target.value)}>{Object.keys(files).filter(editable).sort().map(path=><option key={path}>{path}</option>)}</select></label></header>
    <div className="harness-editor" data-file-revision={revision}><Editor key={`${activePath}:${revisions[activePath]??0}`} path={activePath} graphHost={graphHost} sceneHost={sceneHost}/></div>
    {openedNote&&<div className="harness-note" role="dialog" aria-label="Host opened lore note"><header><h2>{openedNote.path}</h2><button onClick={()=>setOpenedNote(null)}>Close note</button></header><p>The test host received openFile. In Obsidian this opens the original Markdown file in a normal editor tab.</p><pre>{openedNote.text}</pre></div>}
  </div>;
}

/** The file's editor, as the plugin picks it: a scene of the game's format, a version 1 scene read-only, or a version 1 graph. */
function Editor({path,graphHost,sceneHost}:{path:string;graphHost:Host;sceneHost:SceneHost}){
  // The file as it opened: the editor keeps its own state from here (the harness remounts it when the file changes outside it).
  const [opened]=useState(()=>{
    const raw=files[path];
    if(!path.endsWith('.kmscene'))return {kind:'graph' as const,document:parseDocument(raw)};
    try{return openSceneFile(raw)}catch(error){return {kind:'error' as const,message:(error as Error).message}}
  });
  if(opened.kind==='graph')return <App document={opened.document} host={graphHost}/>;
  if(opened.kind==='scene')return <SceneApp document={opened.doc} host={sceneHost}/>;
  if(opened.kind==='v1')return <LegacyScene path={path} title={opened.title} nodes={opened.nodes} routes={opened.routes}/>;
  return <div className="km-file-error" style={{padding:24}}><h3>Cannot open this Kingmaker file</h3><p>{opened.message}</p></div>;
}

createRoot(document.getElementById('root')!).render(<Harness/>);

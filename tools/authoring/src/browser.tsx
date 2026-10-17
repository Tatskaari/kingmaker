// Test-only host. The installed product is plugin.tsx, running inside Obsidian.
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {emptyDocument,parseDocument,serializeDocument} from './model';
import type {Host,Lore,GraphDocument,ContentFile} from './model';

type Fixtures={files:Record<string,string>;lore:Lore[]};
const storageKey='kingmaker-authoring-test-files-v2';
const activeKey='kingmaker-authoring-test-active-v2';
const defaultFile='Scenarios/Caerwyn.kmscenario';
const fixtures:Fixtures=await fetch('/fixtures.json').then(response=>response.json());
const files:Record<string,string>={...fixtures.files,...JSON.parse(localStorage.getItem(storageKey)??'{}')};
const openedFiles:string[]=[];
const listeners=new Set<()=>void>(),revisions:Record<string,number>={};
const notify=()=>{for(const listener of [...listeners])listener()};
const store=()=>localStorage.setItem(storageKey,JSON.stringify(files));
const externalWrite=(path:string,document:GraphDocument)=>{files[path]=serializeDocument(document);revisions[path]=(revisions[path]??0)+1;store();notify()};
declare global{interface Window{__kingmakerHarness:{files:Record<string,string>;openedFiles:string[];activePath:string;writeDocument:(path:string,document:GraphDocument)=>void}}}
window.__kingmakerHarness={files,openedFiles,activePath:defaultFile,writeDocument:externalWrite};
function Harness(){
  const [activePath,setActivePath]=useState(localStorage.getItem(activeKey)??defaultFile);
  const [openedNote,setOpenedNote]=useState<Lore|null>(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);listeners.add(refresh);return()=>{listeners.delete(refresh)}},[]);
  window.__kingmakerHarness.activePath=activePath;
  const openFile=async(path:string)=>{
    openedFiles.push(path);
    if(path in files){setActivePath(path);localStorage.setItem(activeKey,path);setOpenedNote(null)}
    else{const note=fixtures.lore.find(entry=>entry.path===path);if(!note)throw Error(`File not found: ${path}`);setOpenedNote(note)}
  };
  const host:Host=useMemo(()=>{const create=async(kind:'scene'|'map')=>{
    const title=window.prompt(`Name the new ${kind} file`);if(!title?.trim())return null;
    const safe=title.trim().replace(/[\\/:*?"<>|]/g,'-'),folder=kind==='map'?'Maps':'Scenes',extension=kind==='map'?'kmmap':'kmscene';
    let path=`${folder}/${safe}.${extension}`,suffix=2;
    while(path in files)path=`${folder}/${safe} ${suffix++}.${extension}`;
    files[path]=serializeDocument(emptyDocument(kind,title.trim()));store();notify();
    return {path,title:title.trim()};
  };return {
    filePath:activePath,
    change:document=>{files[activePath]=serializeDocument(document);store();notify()},
    lore:async()=>fixtures.lore,
    openFile,
    listScenes:async()=>Object.entries(files).filter(([path])=>path.endsWith('.kmscene')).map(([path,text])=>({path,title:parseDocument(text).title})),
    createScene:()=>create('scene'),createMap:()=>create('map'),
    listDocuments:async()=>Object.entries(files).filter(([path])=>/\.km(scene|map)$/.test(path)).map(([path,raw]):ContentFile=>{try{return {path,document:parseDocument(raw)}}catch(error){return {path,error:String(error)}}}),
    readDocument:async(path)=>{if(!(path in files))throw Error(`File not found: ${path}`);return parseDocument(files[path])},
    writeDocument:async(path,before,after)=>{if(!(path in files)||serializeDocument(parseDocument(files[path]))!==serializeDocument(before))throw Error('The source file changed elsewhere. Refresh before editing.');if(!/\.km(scene|map)$/.test(path))throw Error('Only scene or map files can own ports.');externalWrite(path,after)},
    subscribeDocuments:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
  }} ,[activePath]);
  return <div className="test-harness">
    <header className="harness-banner"><span>Browser test harness · not the installed Obsidian plugin</span><label>Test file<select aria-label="Test file" value={activePath} onChange={event=>void openFile(event.target.value)}>{Object.keys(files).sort().map(path=><option key={path}>{path}</option>)}</select></label></header>
    <div className="harness-editor" data-file-revision={revision}><App key={`${activePath}:${revisions[activePath]??0}`} document={parseDocument(files[activePath])} host={host}/></div>
    {openedNote&&<div className="harness-note" role="dialog" aria-label="Host opened lore note"><header><h2>{openedNote.path}</h2><button onClick={()=>setOpenedNote(null)}>Close note</button></header><p>The test host received openFile. In Obsidian this opens the original Markdown file in a normal editor tab.</p><pre>{openedNote.text}</pre></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Background,Controls,Handle,MarkerType,Position,ReactFlow,ReactFlowProvider,useNodesInitialized,useReactFlow} from '@xyflow/react';
import type {Connection,Edge,Node,NodeChange,NodeProps} from '@xyflow/react';
import {ArrowUpRight,BookOpen,Flag,Map as MapIcon,Plus,RefreshCw,Undo2,Redo2,X} from 'lucide-react';
import {entryPorts,exitPorts,serializeDocument,withDestination} from './model';
import type {ContentFile,GraphDocument,Host,ScenarioConfig} from './model';
import {ConfirmDialog} from './ConfirmDialog';
import './scenario.css';

const START='scenario-start';
const fileNodeId=(path:string)=>`file:${path}`;
const transitionId=(path:string,exit:string)=>`exit:${JSON.stringify([path,exit])}`;
type Port={id:string;title:string;legacy?:boolean};
type ScenarioCardData={title:string;description:string;kind:'scene'|'map'|'start'|'missing';path?:string;referencePath?:string;entries:Port[];exits:Port[];warning?:string;positionKey:string;[key:string]:unknown};
type ScenarioNode=Node<ScenarioCardData>;
type TransitionData={sourcePath?:string;exitId?:string;isStart?:boolean;warning?:string;[key:string]:unknown};
type ScenarioEdge=Edge<TransitionData>;
type Selection={kind:'file';path:string}|{kind:'exit';path:string;exitId:string}|{kind:'start'}|{kind:'missing';id:string}|null;
type HistoryEntry={kind:'scenario';before:GraphDocument;after:GraphDocument}|{kind:'source';path:string;before:GraphDocument;after:GraphDocument};
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void;returnFocus:HTMLElement|null};
const supported=(file:ContentFile|undefined):file is ContentFile&{document:GraphDocument}=>!!file?.document&&['scene','map'].includes(file.document.kind);
const equal=(a:GraphDocument,b:GraphDocument)=>serializeDocument(a)===serializeDocument(b);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const sourceRef=(node:{data:{file?:string;next?:string}})=>node.data.file||node.data.next||'';

function resolveDestination(files:ContentFile[],file?:string,next?:string):{file?:ContentFile;warning?:string}{
  if(file){const found=files.find(candidate=>candidate.path===file);return supported(found)?{file:found}:{file:found,warning:found?.error??`Scene or map file not found: ${file}`}}
  if(!next)return {};
  const matching=files.filter(candidate=>supported(candidate)&&candidate.document.id===next);
  if(matching.length===1)return {file:matching[0]};
  return {warning:matching.length?`More than one file has the id “${next}”. Choose an explicit destination file.`:`No scene or map file has the id “${next}”.`};
}

/** The diagram is a projection of source files, never a second set of scenario transitions. */
export function deriveScenarioGraph(scenario:GraphDocument,files:ContentFile[]):{nodes:ScenarioNode[];edges:ScenarioEdge[]}{
  const config=scenario.scenario??{},nodes:ScenarioNode[]=[],edges:ScenarioEdge[]=[];
  const queue:{path:string;depth:number}[]=[],seen=new Set<string>(),rowByDepth=new Map<number,number>();
  const positions=config.positions??{};
  nodes.push({id:START,type:'scenarioPort',position:positions[START]??{x:0,y:0},deletable:false,data:{kind:'start',title:'Start',description:'After character creation',entries:[],exits:[{id:'start',title:config.entry?'First scene':'Choose first scene'}],positionKey:START}});
  const enqueue=(path:string|undefined,depth:number)=>{if(path&&!seen.has(path)){seen.add(path);queue.push({path,depth})}};
  enqueue(config.entry?.file,0);
  for(const path of config.files??[])enqueue(path,0);
  for(const node of scenario.nodes)if(['scene','map'].includes(node.data.kind))enqueue(node.data.file,0);
  const missing=(id:string,title:string,warning:string,position:{x:number;y:number},referencePath?:string)=>{
    if(!nodes.some(node=>node.id===id))nodes.push({id,type:'scenarioPort',position:positions[id]??position,deletable:false,data:{kind:'missing',title,description:warning,warning,referencePath,entries:[{id:'missing',title:'Unresolved destination'}],exits:[],positionKey:id}});
    return id;
  };
  if(config.entry){
    const destination=files.find(file=>file.path===config.entry!.file),port=supported(destination)?entryPorts(destination.document).find(port=>port.id===config.entry!.entry):undefined;
    const warning=!supported(destination)?destination?.error??`Scene file not found: ${config.entry.file}`:destination.document.kind!=='scene'?'The scenario must begin at a scene, not a map.':!port?'The selected entry no longer exists. Choose a named scene entry.':undefined;
    const target=warning?missing('missing:scenario-entry','First scene unresolved',warning,{x:420,y:-260}):fileNodeId(config.entry.file);
    edges.push({id:'scenario-entry',source:START,sourceHandle:'start',target,targetHandle:warning?'entry:missing':`entry:${config.entry.entry}`,label:warning?'Unresolved first scene':`Begin at ${port!.title}`,type:'smoothstep',data:{isStart:true,warning}});
  }
  for(let index=0;index<queue.length;index++){
    const {path,depth}=queue[index],file=files.find(candidate=>candidate.path===path),row=rowByDepth.get(depth)??0;rowByDepth.set(depth,row+1);
    const position=positions[path]??{x:420+depth*460,y:row*390};
    if(!supported(file)){
      missing(fileNodeId(path),path.split('/').at(-1)??path,file?.error??`Not an available scene or map file: ${path}`,position,path);
      continue;
    }
    const doc=file.document,entries=entryPorts(doc),exits=exitPorts(doc);
    nodes.push({id:fileNodeId(path),type:'scenarioPort',position,deletable:false,data:{kind:doc.kind as 'scene'|'map',title:doc.title,description:doc.description,path,entries,exits:exits.map(exit=>({id:exit.id,title:exit.data.title})),positionKey:path,warning:entries.length?undefined:'No entry points defined. Open the source file to add a start.'}});
    for(const exit of exits){
      if(!sourceRef(exit))continue;
      const resolved=resolveDestination(files,exit.data.file,exit.data.next),destination=resolved.file;
      if(supported(destination))enqueue(destination.path,depth+1);
      const port=supported(destination)?entryPorts(destination.document).find(port=>port.id===exit.data.entry):undefined;
      const warning=resolved.warning??(!port?`Choose a named entry for “${destination?.document?.title??sourceRef(exit)}”.`:undefined);
      const id=transitionId(path,exit.id);
      const target=warning?missing(`missing:${JSON.stringify([sourceRef(exit),exit.data.entry??''])}`,sourceRef(exit),warning,{x:position.x+460,y:position.y+90+exits.indexOf(exit)*145},exit.data.file):fileNodeId(destination!.path);
      edges.push({id,source:fileNodeId(path),sourceHandle:`exit:${exit.id}`,target,targetHandle:warning?'entry:missing':`entry:${port!.id}`,type:'smoothstep',label:`${exit.data.title}${warning?' · unresolved':` → ${port!.title}`}`,data:{sourcePath:path,exitId:exit.id,warning}});
    }
  }
  return {nodes,edges};
}

function ScenarioCard({data,selected}:NodeProps<ScenarioNode>){
  const Icon=data.kind==='map'?MapIcon:data.kind==='start'?Flag:BookOpen;
  return <article className={`scenario-card ${data.kind==='start'?'scenario-start-card':''} ${data.kind==='missing'?'scenario-missing-card':''} ${selected?'chosen':''}`} data-file={data.path??data.referencePath}>
    <div className="scenario-card-kind"><Icon size={14}/>{data.kind==='missing'?'Unresolved':data.kind}</div>
    <h3>{data.title}</h3><p className="scenario-card-description">{data.description}</p>
    {data.path&&<small className="scenario-card-path">{data.path}</small>}
    {data.entries.map(port=><div className="scenario-port scenario-port-input" data-port-id={port.id} key={`in:${port.id}`}><Handle type="target" position={Position.Left} id={`entry:${port.id}`} isConnectable={data.kind!=='missing'}/><span>{port.title}</span><small>{port.legacy?'legacy start':'entry'}</small></div>)}
    {data.warning&&data.kind!=='missing'&&<p className="scenario-card-warning">{data.warning}</p>}
    {data.exits.map(port=><div className="scenario-port scenario-port-output" data-port-id={port.id} key={`out:${port.id}`}><small>{data.kind==='start'?'':'exit'}</small><span>{port.title}</span><Handle type="source" position={Position.Right} id={data.kind==='start'?'start':`exit:${port.id}`}/></div>)}
    {data.kind!=='start'&&data.kind!=='missing'&&!data.exits.length&&<p className="scenario-card-warning">No exits defined.</p>}
  </article>;
}
const nodeTypes={scenarioPort:ScenarioCard};

function AddFileDialog({files,busy,onAdd,onCreate,onClose,canCreateMap}:{files:ContentFile[];busy:boolean;onAdd:(path:string)=>void;onCreate:(kind:'scene'|'map')=>void;onClose:()=>void;canCreateMap:boolean}){
  const [query,setQuery]=useState(''),root=useRef<HTMLElement>(null),search=useRef<HTMLInputElement>(null),close=useRef(onClose);close.current=onClose;
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;const document=element.ownerDocument,previous=document.activeElement as HTMLElement|null;
    search.current?.focus();const key=(event:KeyboardEvent)=>{
      if(!element.getClientRects().length||!element.contains(document.activeElement))return;
      event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close.current();return}if(event.key!=='Tab')return;
      const controls=Array.from(element.querySelectorAll<HTMLElement>('button,input')).filter(control=>!control.matches(':disabled')&&control.getClientRects().length),first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first)?.focus()}
    };document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);queueMicrotask(()=>{if(document.activeElement===document.body&&previous?.isConnected&&!previous.closest('[inert]'))previous.focus()})};
  },[]);
  return <div className="modal-backdrop" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose()}}>
    <section ref={root} className="modal scenario-add-menu" role="dialog" aria-modal="true" aria-label="Add scene or map">
      <header><h2>Add scene or map</h2><button aria-label="Close file picker" onClick={onClose}><X size={18}/></button></header>
      <label className="field">Search files<input ref={search} value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <div className="scenario-file-list">{files.filter(supported).filter(file=>`${file.path} ${file.document.title}`.toLowerCase().includes(query.toLowerCase())).map(file=><div className="scenario-file-choice" data-file={file.path} key={file.path}><div><strong>{file.document.title}</strong><small>{file.document.kind} · {file.path}</small></div><button onClick={()=>onAdd(file.path)} disabled={busy}>Add to scenario</button></div>)}</div>
      <p className="muted">Adding shows the existing file. Its entries, exits and destinations stay in that source file.</p>
      <footer className="modal-footer"><button disabled={busy} onClick={()=>onCreate('scene')}>Create scene file</button><button disabled={busy||!canCreateMap} onClick={()=>onCreate('map')}>Create map file</button></footer>
    </section>
  </div>;
}

export function ScenarioEditor({document,host}:{document:GraphDocument;host:Host}){return <ReactFlowProvider><ScenarioWorkspace initial={document} host={host}/></ReactFlowProvider>}

function ScenarioWorkspace({initial,host}:{initial:GraphDocument;host:Host}){
  const [scenario,setScenario]=useState(initial),current=useRef(initial),[files,setFiles]=useState<ContentFile[]>([]),filesRef=useRef<ContentFile[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),operation=useRef(false),refreshSequence=useRef(0),alive=useRef(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState<Selection>(null),[addOpen,setAddOpen]=useState(false);
  const [history,setHistory]=useState<HistoryEntry[]>([]),[future,setFuture]=useState<HistoryEntry[]>([]),historyRef=useRef(history),futureRef=useRef(future);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[targetPath,setTargetPath]=useState(''),[targetEntry,setTargetEntry]=useState('');
  const [positions,setPositions]=useState<Record<string,{x:number;y:number}>>({}),positionsRef=useRef(positions),[measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  const shell=useRef<HTMLDivElement>(null),dragging=useRef(false),flow=useReactFlow<ScenarioNode,ScenarioEdge>(),textSession=useRef<string|null>(null),lastSession=useRef<string|null>(null),fitNeeded=useRef(true),nodesInitialized=useNodesInitialized();
  historyRef.current=history;futureRef.current=future;positionsRef.current=positions;
  const refresh=useCallback(async()=>{
    const seq=++refreshSequence.current;setLoading(true);
    try{
      if(!host.listDocuments)throw Error('This host cannot list scene and map files yet.');
      const loaded=await host.listDocuments();
      if(alive.current&&seq===refreshSequence.current){filesRef.current=loaded;setFiles(loaded);setLoading(false)}
    }catch(error){if(alive.current&&seq===refreshSequence.current){setError(message(error));setLoading(false)}}
  },[host]);
  useEffect(()=>{alive.current=true;void refresh();const unsubscribe=host.subscribeDocuments?.(()=>void refresh());return()=>{alive.current=false;++refreshSequence.current;unsubscribe?.()}},[host,refresh]);
  const graph=useMemo(()=>deriveScenarioGraph(scenario,files),[scenario,files]);
  useEffect(()=>{if(!loading&&nodesInitialized&&fitNeeded.current){fitNeeded.current=false;void flow.fitView({padding:.14,duration:150})}},[loading,nodesInitialized,graph.nodes.length,flow]);
  const selectedFile=selected?.kind==='file'||selected?.kind==='exit'?files.find(file=>file.path===selected.path):undefined;
  const selectedExit=selected?.kind==='exit'&&supported(selectedFile)?exitPorts(selectedFile.document).find(exit=>exit.id===selected.exitId):undefined;
  const selectedMissing=selected?.kind==='missing'?graph.nodes.find(node=>node.id===selected.id):undefined;
  useEffect(()=>{
    if(selected?.kind==='start'){setTargetPath(scenario.scenario?.entry?.file??'');setTargetEntry(scenario.scenario?.entry?.entry??'')}
    else if(selectedExit){setTargetPath(resolveDestination(files,selectedExit.data.file,selectedExit.data.next).file?.path??'');setTargetEntry(selectedExit.data.entry??'')}
    else {setTargetPath('');setTargetEntry('')}
  },[selected,scenario.scenario?.entry?.file,scenario.scenario?.entry?.entry,selectedExit?.data.file,selectedExit?.data.next,selectedExit?.data.entry]);

  const publish=(next:GraphDocument)=>{current.current=next;setScenario(next);host.change(next)};
  const remember=(entry:HistoryEntry)=>{setHistory(old=>[...old.slice(-99),entry]);setFuture([]);lastSession.current=null};
  const changeScenario=(next:GraphDocument,coalesce=false)=>{
    const before=current.current;if(equal(before,next))return;
    if(coalesce&&textSession.current&&lastSession.current===textSession.current){setHistory(old=>{const previous=old.at(-1);return previous?.kind==='scenario'?[...old.slice(0,-1),{...previous,after:next}]:[...old,{kind:'scenario',before,after:next}]})}
    else setHistory(old=>[...old.slice(-99),{kind:'scenario',before,after:next}]);
    lastSession.current=coalesce?textSession.current:null;setFuture([]);publish(next);
  };
  const configChange=(patch:Partial<ScenarioConfig>)=>changeScenario({...current.current,scenario:{...current.current.scenario,...patch}});
  const ask=(title:string,description:string,confirmLabel:string,run:()=>void)=>{
    const active=shell.current?.ownerDocument.activeElement;
    setConfirmation({title,description,confirmLabel,run,returnFocus:active&&typeof (active as HTMLElement).focus==='function'?active as HTMLElement:null});
  };
  const fail=(error:unknown)=>{if(alive.current)setError(message(error))};
  const openFile=(path:string)=>void host.openFile(path).catch(fail);
  const replaceCatalog=(path:string,document:GraphDocument)=>{
    const updated=[...filesRef.current.filter(file=>file.path!==path),{path,document}];filesRef.current=updated;setFiles(updated);
  };
  const writeSource=async(path:string,before:GraphDocument,after:GraphDocument,record=true)=>{
    if(!host.readDocument||!host.writeDocument)throw Error('This host cannot write source documents yet.');
    const actual=await host.readDocument(path);
    if(!equal(actual,before))throw Error(`“${path}” changed outside this editor. Refresh and review it before trying again; nothing was overwritten.`);
    await host.writeDocument(path,before,after);
    if(!alive.current)return;
    replaceCatalog(path,after);if(record)remember({kind:'source',path,before,after});
  };
  const runOperation=async(run:()=>Promise<void>)=>{
    if(operation.current)return;operation.current=true;setBusy(true);setError('');
    try{await run()}catch(error){fail(error);void refresh()}finally{operation.current=false;if(alive.current)setBusy(false)}
  };
  const editExit=(path:string,exitId:string,target:ContentFile|undefined,entry:string,before:GraphDocument)=>void runOperation(async()=>{
    let destination=target;
    if(target){
      if(!host.readDocument)throw Error('This host cannot read destination files yet.');
      const fresh=await host.readDocument(target.path);
      if(!['scene','map'].includes(fresh.kind)||!entryPorts(fresh).some(port=>port.id===entry))throw Error('The destination entry changed. Refresh and choose a named entry again.');
      destination={path:target.path,document:fresh};
    }
    const after=withDestination(before,exitId,destination,entry);
    if(equal(before,after))return;
    await writeSource(path,before,after);setNotice(`Saved destination in ${path}`);
  });
  const setExitDestination=(path:string,exitId:string,target:ContentFile|undefined,entry:string)=>{
    const source=filesRef.current.find(file=>file.path===path);if(!supported(source)){setError('The source file is unavailable. Refresh before editing its exits.');return}
    const exit=exitPorts(source.document).find(node=>node.id===exitId);if(!exit){setError('This exit no longer exists in its source file.');return}
    if(target&&(!supported(target)||!entryPorts(target.document).some(port=>port.id===entry))){setError('Choose a named entry in a scene or map file.');return}
    const after=withDestination(source.document,exitId,target,entry);if(equal(source.document,after))return;
    const save=()=>editExit(path,exitId,target,entry,source.document);
    if(!target)ask('Remove exit destination?',`Remove the destination of “${exit.data.title}” in ${path}? The source exit stays in place, and no files are deleted. You can undo this.`,'Remove destination',save);
    else if(sourceRef(exit))ask('Replace exit destination?',`Replace the destination of “${exit.data.title}” in ${path} with “${target.document!.title} → ${entryPorts(target.document!).find(port=>port.id===entry)!.title}”? This edits the original source exit. You can undo this.`,'Replace destination',save);
    else save();
  };
  const setFirstScene=(target:ContentFile|undefined,entry:string)=>{
    if(target&&(!supported(target)||target.document.kind!=='scene'||!entryPorts(target.document).some(port=>port.id===entry))){setError('Start must connect to a named entry in a scene file, not a map.');return}
    const next=target?{file:target.path,entry}:undefined,previous=current.current.scenario?.entry;
    if(JSON.stringify(previous)===JSON.stringify(next))return;
    const save=()=>void runOperation(async()=>{
      if(target){
        if(!host.readDocument)throw Error('This host cannot verify the first scene yet.');
        const actual=await host.readDocument(target.path);
        if(actual.kind!=='scene'||!entryPorts(actual).some(port=>port.id===entry))throw Error('The first scene entry changed. Refresh and choose a named scene entry again.');
      }
      configChange({entry:next});
    });
    if(!target)ask('Clear first scene?','Clear the scenario entry? The Start node and all source files remain. You can undo this.','Clear first scene',save);
    else if(previous)ask('Replace first scene?',`Begin after character creation at “${target.document!.title} → ${entryPorts(target.document!).find(port=>port.id===entry)!.title}”? This changes only the scenario entry.`,'Replace first scene',save);
    else save();
  };
  const connect=(connection:Connection)=>{
    if(busy||!connection.target||!connection.targetHandle?.startsWith('entry:'))return;
    const target=filesRef.current.find(file=>fileNodeId(file.path)===connection.target),entry=connection.targetHandle.slice(6);
    if(!supported(target)){setError('Choose an available scene or map entry.');return}
    if(connection.source===START){setSelected({kind:'start'});setFirstScene(target,entry);return}
    const source=filesRef.current.find(file=>fileNodeId(file.path)===connection.source);
    if(!source||!connection.sourceHandle?.startsWith('exit:'))return;
    const exitId=connection.sourceHandle.slice(5);setSelected({kind:'exit',path:source.path,exitId});setExitDestination(source.path,exitId,target,entry);
  };
  const travelHistory=(direction:'undo'|'redo')=>void runOperation(async()=>{
    const entry=(direction==='undo'?historyRef.current:futureRef.current).at(-1);if(!entry)return;
    const before=direction==='undo'?entry.after:entry.before,after=direction==='undo'?entry.before:entry.after;
    if(entry.kind==='scenario'){
      if(!equal(current.current,before))throw Error('The scenario changed outside this history. Nothing was overwritten.');
      publish(after);setPositions({});
    }else await writeSource(entry.path,before,after,false);
    if(direction==='undo'){setHistory(old=>old.slice(0,-1));setFuture(old=>[...old,entry])}else{setFuture(old=>old.slice(0,-1));setHistory(old=>[...old,entry])}
    lastSession.current=null;
  });
  const addFile=(path:string)=>{
    fitNeeded.current=true;
    const existing=current.current.scenario?.files??[];if(!existing.includes(path))configChange({files:[...existing,path]});
    setSelected({kind:'file',path});setAddOpen(false);setNotice('Showing the original source file; no copy was created.');
  };
  const createFile=(kind:'scene'|'map')=>void runOperation(async()=>{
    const created=kind==='scene'?await host.createScene():await host.createMap?.();if(!created)return;
    await refresh();addFile(created.path);setNotice(`Created ${created.path}. Undo removes it from the diagram, not from the vault.`);
  });
  const nodeChanges=(changes:NodeChange<ScenarioNode>[])=>{
    const dimensionChanges=changes.filter(change=>change.type==='dimensions');
    if(dimensionChanges.length)setMeasurements(old=>{const next={...old};for(const change of dimensionChanges)if(change.type==='dimensions'&&change.dimensions)next[change.id]=change.dimensions;return next});
    const moves=changes.filter(change=>change.type==='position'&&change.position);
    if(moves.length){
      const next={...positionsRef.current};for(const move of moves)if(move.type==='position'&&move.position){const node=graph.nodes.find(node=>node.id===move.id);if(node)next[node.data.positionKey]=move.position}
      if(dragging.current){positionsRef.current=next;setPositions(next)}
      else configChange({positions:{...current.current.scenario?.positions,...next}});
    }
  };
  const finishDrag=()=>{dragging.current=false;if(Object.keys(positionsRef.current).length)configChange({positions:{...current.current.scenario?.positions,...positionsRef.current}});positionsRef.current={};setPositions({})};
  useEffect(()=>{
    const element=shell.current;if(!element)return;const key=(event:KeyboardEvent)=>{
      if(confirmation||addOpen||busy)return;
      const target=event.target as Element|null;if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;
      const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();let handled=true;
      if(mod&&key==='z')travelHistory(event.shiftKey?'redo':'undo');else if(mod&&key==='y')travelHistory('redo');else if(!mod&&key==='a')setAddOpen(true);else if(!mod&&key==='f')void flow.fitView({padding:.14,duration:200});else if(event.key==='Delete'||event.key==='Backspace'){
        if(selected?.kind==='exit')setExitDestination(selected.path,selected.exitId,undefined,'');else if(selected?.kind==='start')setNotice('Start is permanent. Clear its first scene destination in the inspector if needed.');else setNotice('Source files are not deleted from the scenario diagram.');
      }else handled=false;
      if(handled){event.preventDefault();event.stopPropagation()}
    };element.addEventListener('keydown',key);return()=>element.removeEventListener('keydown',key);
  });
  const selectedTarget=files.find(file=>file.path===targetPath),targetPorts=supported(selectedTarget)?entryPorts(selectedTarget.document):[];
  const destinationForm=(isStart:boolean)=><>
    <p className="info-box">{isStart?'After character creation, begin at a named entry in the first scene.':'Saving here changes this exit in its original source file. The scenario diagram reflects that same destination.'}</p>
    <label className="field">Destination file<select value={targetPath} onChange={event=>{setTargetPath(event.target.value);setTargetEntry('')}}><option value="">Choose a {isStart?'scene':'scene or map'}…</option>{files.filter(supported).filter(file=>!isStart||file.document.kind==='scene').map(file=><option value={file.path} key={file.path}>{file.document.title} · {file.path}</option>)}</select></label>
    <label className="field">Destination entry<select value={targetEntry} disabled={!targetPorts.length} onChange={event=>setTargetEntry(event.target.value)}><option value="">Choose a named entry…</option>{targetPorts.map(port=><option key={port.id} value={port.id}>{port.title}</option>)}</select></label>
    {!!targetPath&&!targetPorts.length&&<p className="scenario-warning">This file has no entry points. Open it and add a start first.</p>}
    <button className="primary" disabled={busy||!supported(selectedTarget)||!targetPorts.some(port=>port.id===targetEntry)} onClick={()=>isStart?setFirstScene(selectedTarget,targetEntry):selected?.kind==='exit'&&setExitDestination(selected.path,selected.exitId,selectedTarget,targetEntry)}>Save destination</button>
    {(isStart?!!scenario.scenario?.entry:!!selectedExit&&!!sourceRef(selectedExit))&&<button className="text-button danger scenario-remove-destination" disabled={busy} onClick={()=>isStart?setFirstScene(undefined,''):selected?.kind==='exit'&&setExitDestination(selected.path,selected.exitId,undefined,'')}>{isStart?'Clear first scene':'Remove destination'}</button>}
  </>;
  const fields={onFocus:()=>{textSession.current=crypto.randomUUID()},onBlur:()=>{textSession.current=null}};
  return <div className="km-workshop km-scenario" ref={shell} tabIndex={0} onPointerDown={event=>{if(!(event.target as Element).closest('input,textarea,select,button,a,[contenteditable="true"]'))shell.current?.focus({preventScroll:true})}}>
    <main className="workspace" inert={!!confirmation||addOpen||undefined}>
      <header className="topbar"><span className="file-path">{host.filePath}</span><span className="save">File-backed scenario</span></header>
      <div className="canvas-heading"><div><div className="eyebrow">KINGMAKER · SCENARIO</div><h1>{scenario.title}</h1></div><button className="primary" disabled={busy} onClick={()=>setAddOpen(true)}><Plus size={16}/>Add scene or map <kbd>A</kbd></button></div>
      <div className="toolbar"><div><button title="Refresh source files" onClick={()=>{setError('');void refresh()}} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Refresh'}</button><span className="scenario-toolbar-hint">Exits belong to source files</span></div><div><button title="Undo (Ctrl Z)" disabled={busy||!history.length} onClick={()=>travelHistory('undo')}><Undo2 size={16}/></button><button title="Redo (Ctrl Shift Z)" disabled={busy||!future.length} onClick={()=>travelHistory('redo')}><Redo2 size={16}/></button><button title="Fit graph (F)" onClick={()=>void flow.fitView({padding:.14,duration:200})}>Fit graph</button></div></div>
      {!scenario.scenario?.entry&&<div className="scenario-start-notice"><span>Choose the first scene after character creation.</span><button disabled={busy} onClick={()=>setSelected({kind:'start'})}>Choose first scene</button></div>}
      {error&&<div className="scenario-error" role="alert">{error}<button title="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
      <div className="graph-canvas"><ReactFlow<ScenarioNode,ScenarioEdge> nodeTypes={nodeTypes} nodes={graph.nodes.map(node=>({...node,position:positions[node.data.positionKey]??node.position,measured:measurements[node.id],selected:selected?.kind==='start'?node.id===START:selected?.kind==='file'?node.data.path===selected.path:selected?.kind==='missing'?node.id===selected.id:false}))} edges={graph.edges.map(edge=>({...edge,reconnectable:busy?false:'target' as const,selected:edge.data?.isStart?selected?.kind==='start':selected?.kind==='exit'&&edge.data?.sourcePath===selected.path&&edge.data?.exitId===selected.exitId,label:edge.data?.warning?'Unresolved destination':undefined,ariaLabel:edge.label as string,markerEnd:{type:MarkerType.ArrowClosed,color:'#96869f'},style:{strokeDasharray:edge.data?.warning?'5 4':undefined},labelStyle:{fill:'var(--km-text)',fontSize:11},labelBgStyle:{fill:'var(--km-panel)'},labelBgPadding:[7,5] as [number,number],labelBgBorderRadius:4}))}
        fitView fitViewOptions={{padding:.14}} minZoom={.06} maxZoom={1.6} deleteKeyCode={null} nodesConnectable={!busy} nodesDraggable={!busy} onNodesChange={nodeChanges} onNodeDragStart={()=>{dragging.current=true}} onNodeDragStop={finishDrag} onConnect={connect} onReconnect={(edge,connection)=>connect({...connection,source:edge.source,sourceHandle:edge.sourceHandle??null})} zoomOnDoubleClick={false} panOnDrag={[1,2]} panOnScroll colorMode="system"
        onNodeClick={(_,node)=>setSelected(node.id===START?{kind:'start'}:node.data.path?{kind:'file',path:node.data.path}:{kind:'missing',id:node.id})} onNodeDoubleClick={(_,node)=>{const path=node.data.path??node.data.referencePath;if(path)openFile(path)}} onPaneClick={()=>setSelected(null)} onEdgeClick={(_,edge)=>setSelected(edge.data?.isStart?{kind:'start'}:edge.data?.sourcePath&&edge.data.exitId?{kind:'exit',path:edge.data.sourcePath,exitId:edge.data.exitId}:null)}><Background gap={24}/><Controls showInteractive={false}/></ReactFlow></div>
      <footer className="statusbar"><span>{graph.nodes.filter(node=>node.data.path).length} source files · {graph.edges.length} destinations{busy?' · Saving…':loading?' · Loading…':''}</span><span>{notice||'Drag an exit to a named entry. A adds a file.'}</span></footer>
    </main>
    <aside className="inspector scenario-inspector" inert={!!confirmation||addOpen||undefined}>
      <div className="inspector-head"><span>{selected?.kind==='start'?'SCENARIO START':selected?.kind==='exit'?'EXIT DESTINATION':selected?.kind==='file'?'SOURCE FILE':selected?.kind==='missing'?'UNRESOLVED DESTINATION':'SCENARIO DETAILS'}</span><button title="Clear selection" onClick={()=>setSelected(null)}><X size={15}/></button></div>
      <div className="inspector-body">
        {selected?.kind==='start'?<><h2 className="scenario-inspector-title">Start</h2><p className="muted">After character creation. This node cannot be deleted.</p>{destinationForm(true)}</>:selected?.kind==='exit'?<><h2 className="scenario-inspector-title">{selectedExit?.data.title??'Exit unavailable'}</h2><p className="scenario-source-path">{selected.path}</p><button className="wide-button" onClick={()=>openFile(selected.path)}>Open source file <ArrowUpRight size={14}/></button>{selectedExit?destinationForm(false):<p className="scenario-warning">This exit no longer exists. Refresh or open its source file.</p>}</>:selected?.kind==='file'&&supported(selectedFile)?<>
          <h2 className="scenario-inspector-title">{selectedFile.document.title}</h2><p className="scenario-source-path">{selectedFile.path}</p><button className="wide-button" onClick={()=>openFile(selectedFile.path)}>Open source file <ArrowUpRight size={14}/></button>
          <div className="subheading">Entry points</div>{entryPorts(selectedFile.document).map(port=><div className="scenario-inspector-port" key={port.id}><strong>{port.title}</strong><small>{port.id}{port.legacy?' · legacy start':''}</small></div>)}{!entryPorts(selectedFile.document).length&&<p className="scenario-warning">No named entries. Add a start in the source file.</p>}
          <div className="subheading">Exits</div>{exitPorts(selectedFile.document).map(exit=><button className="scenario-exit-button" title={`Edit destination: ${exit.data.title}`} key={exit.id} onClick={()=>setSelected({kind:'exit',path:selectedFile.path,exitId:exit.id})}><strong>{exit.data.title}</strong><small>{sourceRef(exit)||'No destination'}{exit.data.entry?` → ${exit.data.entry}`:''}</small></button>)}{!exitPorts(selectedFile.document).length&&<p className="muted">No exits. Open the source file to add one.</p>}
          <p className="info-box">These ports come from the original file. Add, rename or remove starts and exits there; this diagram refreshes from them.</p>
        </>:selectedMissing?<><h2 className="scenario-inspector-title">{selectedMissing.data.title}</h2><p className="scenario-warning">{selectedMissing.data.warning}</p>{selectedMissing.data.referencePath&&<button className="wide-button" onClick={()=>openFile(selectedMissing.data.referencePath!)}>Open referenced file <ArrowUpRight size={14}/></button>}<p className="muted">No replacement content has been invented. Click the incoming transition to choose an existing file and named entry.</p></>:<>
          <label className="field">Scenario title<input {...fields} value={scenario.title} onChange={event=>changeScenario({...current.current,title:event.target.value},true)}/></label>
          <label className="field">Scenario description<textarea {...fields} value={scenario.description} onChange={event=>changeScenario({...current.current,description:event.target.value},true)}/></label>
          <p className="info-box">Start follows character creation and must lead to a named scene entry. Scene and map exits then determine the reachable graph.</p>
          <p className="muted">This file stores the first scene, included files and diagram positions. Source files own their starts, exits and destinations. Legacy diagram edges are retained in the file but are not used as transitions.</p>
        </>}
      </div>
    </aside>
    {addOpen&&<AddFileDialog files={files} busy={busy} onAdd={addFile} onCreate={createFile} onClose={()=>setAddOpen(false)} canCreateMap={!!host.createMap}/>}
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} returnFocus={confirmation.returnFocus} fallbackFocus={shell.current} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
  </div>;
}

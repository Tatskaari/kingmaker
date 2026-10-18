// The scenario editor: the campaign's .kmscenario as a diagram of its scenes and maps, the story's flow
// between them drawn from the files that own it (each ending's next, each region's scene, each map's
// ways out, and the start), and edited there: in the scene's file, the map's, or the scenario's own.
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Background,Controls,Handle,MarkerType,MiniMap,Position,ReactFlow,ReactFlowProvider,useNodesInitialized,useReactFlow,useStoreApi} from '@xyflow/react';
import type {Connection,Edge,Node,NodeChange,NodeProps} from '@xyflow/react';
import {AlertTriangle,BookOpen,CheckCircle2,ExternalLink,Flag,Info,Map as MapIcon,Maximize,Redo2,Trash2,Undo2,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits,useWritten} from '../campaign/edits.ts';
import type {FileChange} from '../campaign/edits.ts';
import {campaignProblems,endingsOf,pathIn,withDraft} from '../campaign/files.ts';
import type {CampaignFiles,CampaignProblem} from '../campaign/files.ts';
import {serializeJson,slugOf} from '../campaign/json.ts';
import {EditSession,SelectField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {serializeScene,setNodeField,skeletonScene} from '../scene/model.ts';
import {newMap,removeExits,serializeMap,setExit,setRegionField} from '../map/model.ts';
import type {MapDocument} from '../map/model.ts';
import {TileFields} from '../map/inspectors.tsx';
import {newPlace,serializePlace} from '../place/model.ts';
import {START_CARD,flowOf,landingOn,layoutOf,mapCard,sceneCard,scenarioShapeOf,serializeScenario,setScenarioField,withLayout,withStart} from './model.ts';
import type {Flow,FlowCard,FlowOwner,FlowPort,ScenarioDocument} from './model.ts';
import {ScenarioPanel} from './inspectors.tsx';
import type {ScenarioActions} from './inspectors.tsx';
import '@xyflow/react/dist/style.css';
import '../styles.css';
import '../scenario.css';

type CardNode=Node<{card:FlowCard;selectedPort?:string},'card'>;
type FlowEdgeData=Edge<{owner:FlowOwner}>;
type Selection={kind:'card';id:string}|{kind:'port';card:string;port:string}|null;
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};
const ICONS={start:Flag,scene:BookOpen,map:MapIcon};

/** The editor for the scenario file. The host saves what it's handed; the editor's undo lasts while the file is open. */
export function ScenarioApp({document,host}:{document:ScenarioDocument;host:FileHost<ScenarioDocument>}){
  return <ReactFlowProvider><ScenarioEditor initial={document} host={host}/></ReactFlowProvider>;
}

function ScenarioCard({id,data,selected}:NodeProps<CardNode>){
  const {card}=data,Icon=ICONS[card.kind];
  const store=useStoreApi(),element=useRef<HTMLElement>(null);
  const ports=JSON.stringify(card.ports.map(port=>port.id));
  // Ports come and go as the files change; React Flow measures a node's handles when told to.
  useLayoutEffect(()=>{
    const frame=requestAnimationFrame(()=>{const node=element.current?.closest<HTMLDivElement>('.react-flow__node');if(node)store.getState().updateNodeInternals(new Map([[id,{id,nodeElement:node,force:true}]]),{triggerFitView:false})});
    return()=>cancelAnimationFrame(frame);
  },[id,ports,store]);
  return <article ref={element} className={`scenario-card ${card.kind}${selected?' chosen':''}${card.error?' broken':''}`} data-card={card.id}>
    {card.kind!=='start'&&<Handle type="target" position={Position.Left} id="in"/>}
    <div className="scenario-card-kind"><Icon size={13}/>{card.kind==='start'?'Start':card.kind}{card.key&&<code>{card.key}</code>}</div>
    <h3>{card.title}</h3>
    <p className="scenario-card-description">{card.subtitle}</p>
    {card.error&&<p className="scenario-card-warning">{card.error}</p>}
    {card.ports.map(port=><div key={port.id} className={`scenario-port${data.selectedPort===port.id?' chosen':''}${port.target?'':' loose'}`} data-port={port.id}>
      <span>{port.label}</span>{port.detail&&<small>{port.detail}</small>}
      <Handle type="source" position={Position.Right} id={port.id}/>
    </div>)}
    {card.kind==='scene'&&!card.ports.length&&!card.error&&<p className="muted">No endings.</p>}
  </article>;
}
const nodeTypes={card:ScenarioCard};

function ScenarioEditor({initial,host}:{initial:ScenarioDocument;host:FileHost<ScenarioDocument>}){
  const [toast,setToast]=useState('');
  const campaign=useCampaignFiles(host,setToast);
  const {writer,textOf,version}=useWritten(host,campaign);
  const edits=useEdits<ScenarioDocument>({host:writer,initial,shape:scenarioShapeOf,serialize:serializeScenario,onError:setToast});
  const doc=edits.doc;
  const [selection,setSelection]=useState<Selection>(null),[tab,setTab]=useState<'selected'|'scenario'|'problems'>('scenario');
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[dragging,setDragging]=useState<Record<string,{x:number;y:number}>>({});
  const [measured,setMeasured]=useState<Record<string,{width:number;height:number}>>({});
  const flowApi=useReactFlow<CardNode,FlowEdgeData>(),shell=useRef<HTMLDivElement>(null),fitted=useRef(false);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer)},[toast]);

  // The campaign as this editor knows it: its own scenario as edited, and what it has written lately.
  const known=useMemo<CampaignFiles|null>(()=>{
    if(!campaign)return null;
    const reparse=<F extends {path:string;text?:string;doc?:unknown}>(file:F,parse:(text:string)=>NonNullable<F['doc']>):F=>{const text=textOf(file.path,file.text);if(text===file.text||text===undefined)return file;try{return {...file,text,doc:parse(text)}}catch{return file}};
    return {
      ...withDraft(campaign,'scenario',doc.id,doc,serializeScenario(doc)),
      scenes:campaign.scenes.map(scene=>{const next=reparse(scene,text=>JSON.parse(text));return next===scene?scene:{...next,value:next.doc}}),
      maps:campaign.maps.map(map=>reparse(map,text=>JSON.parse(text) as MapDocument)),
    };
  },[campaign,doc,version]);
  const flow=useMemo<Flow>(()=>known?flowOf(doc,known):{cards:[],edges:[]},[doc,known]);
  const positions=useMemo(()=>layoutOf(flow,doc.layout),[flow,doc.layout]);
  const problems=useMemo<CampaignProblem[]>(()=>known?campaignProblems(known):[],[known]);
  const notes=[...(!campaign?['Reading the campaign…']:[]),...(campaign?.error&&campaign.error!==undefined&&!campaign.scenario?[`The campaign couldn't be read (${campaign.error}).`]:[])];

  // ---- Edits in the files that own them ----
  const ask=(confirmation:Confirmation)=>setConfirmation(confirmation);
  const open=(path:string)=>void host.open(path).catch(error=>setToast(String(error instanceof Error?error.message:error)));
  const sceneFile=(key:string)=>known?.scenes.find(scene=>scene.key===key);
  const mapFile=(key:string)=>known?.maps.find(map=>map.key===key);
  const writeScene=(key:string,change:(scene:NonNullable<ReturnType<typeof sceneFile>>['doc'] & object)=>object)=>{
    const file=sceneFile(key);
    if(!file?.doc||file.text===undefined){setToast(`${file?.path??`scenes/${key}.kmscene`} can't be read, so its endings can't be set from here: open it.`);return}
    const after=serializeScene(change(file.doc) as typeof file.doc);
    if(after!==file.text)void edits.write([{path:file.path,before:file.text,after}]);
  };
  const writeMap=(key:string,change:(map:MapDocument)=>MapDocument)=>{
    const file=mapFile(key);
    if(!file?.doc||file.text===undefined){setToast(`${file?.path??`maps/${key}.kmmap`} can't be read, so it can't be wired from here: open it.`);return}
    const after=serializeMap(change(file.doc));
    if(after!==file.text)void edits.write([{path:file.path,before:file.text,after}]);
  };
  const landing=(map:string,from?:string)=>landingOn(mapFile(map)?.doc,from);
  /** A way out of a card sent to another card (or, with none, its destination taken away). */
  const aim=(owner:FlowOwner,target:string|undefined)=>{
    const scene=target?.startsWith('scene:')?target.slice(6):undefined,map=target?.startsWith('map:')?target.slice(4):undefined;
    if(owner.kind==='ending'){
      if(target&&!scene){setToast('An ending goes on to a scene.');return}
      writeScene(owner.scene,s=>setNodeField(s,owner.ending,'next',scene));
    }else if(owner.kind==='region'){
      if(!scene){if(target){setToast('A region plays a scene.');return}ask({title:'Stop the region playing its scene?',description:`The region ${owner.region} on ${owner.map} won't play a scene any more; the region stays. You can undo this.`,confirmLabel:'Stop playing it',run:()=>writeMap(owner.map,m=>setRegionField(m,owner.index,'sceneId',undefined))});return}
      writeMap(owner.map,m=>setRegionField(m,owner.index,'sceneId',scene));
    }else if(owner.kind==='exits'){
      if(!map){if(target){setToast('A way out of a map leads to a map.');return}
        ask({title:`Delete “${owner.label}”?`,description:`The ${owner.indices.length===1?'exit':`${owner.indices.length} exits`} from ${owner.map} to ${owner.to} go. You can undo this.`,confirmLabel:'Delete',run:()=>writeMap(owner.map,m=>removeExits(m,owner.indices))});return}
      const at=landing(map,owner.map);
      writeMap(owner.map,m=>owner.indices.reduce((next,i)=>{const exit=next.exits[i];return setExit(next,i,{...exit,to:{map,at:map===exit.to.map?exit.to.at:at}})},m));
    }else if(owner.kind==='start'){
      if(map)edits.commit(withStart(doc,map,map===doc.start.map&&doc.start.at?{x:doc.start.at[0],y:doc.start.at[1]}:landing(map)));
      else if(scene)ask({title:'Start in the scene at once?',description:`The story won't start on a map: ${scene} opens as the game begins. You can undo this.`,confirmLabel:'Start in it',run:()=>edits.commit(setScenarioField(withStart(doc,undefined,undefined),'firstScene',scene))});
      else ask({title:'Start without a map?',description:'The story won\'t start on a map: its first scene opens as the game begins. You can undo this.',confirmLabel:'No start map',run:()=>edits.commit(withStart(doc,undefined,undefined))});
    }else if(owner.kind==='lead'){
      if(!scene){setToast(target?'The first lead is a scene.':'The story needs its first scene.');return}
      edits.commit(setScenarioField(doc,'firstScene',scene));
    }
  };
  const actions:ScenarioActions={
    edit:next=>edits.commit(next,true),
    open,
    landing:map=>landing(map),
    unlist:(kind,key)=>ask({title:`Take ${key} out of the scenario?`,description:`${key} won't be one of the scenario's ${kind}: the game won't install it. Its file stays. You can undo this.`,confirmLabel:'Take it out',run:()=>edits.commit(setScenarioField(edits.current.current,kind,edits.current.current[kind].filter(k=>k!==key)))}),
    create:(kind,title)=>{
      if(!known){setToast('Still reading the campaign.');return}
      const id=slugOf(title);
      const path=kind==='scenes'?pathIn.scene(known.root,id):kind==='maps'?pathIn.map(known.root,id):pathIn.place(known.root,id);
      const text=kind==='scenes'?serializeScene(skeletonScene(title,id)):kind==='maps'?serializeMap(newMap(title,id)):serializePlace(newPlace(title,id));
      if(edits.current.current[kind].includes(id)){setToast(`The scenario lists ${id} already.`);return}
      void host.create(path,text).then(()=>{edits.commit(setScenarioField(edits.current.current,kind,[...edits.current.current[kind],id]));setToast(`Made ${path}, and listed it. Undo takes it off the list; the file stays.`)}).catch(error=>setToast(String(error instanceof Error?error.message:error)));
    },
  };

  // ---- The diagram ----
  const nodes=useMemo<CardNode[]>(()=>flow.cards.map(card=>({
    id:card.id,type:'card',position:dragging[card.id]??positions.get(card.id)??{x:0,y:0},measured:measured[card.id],deletable:false,
    selected:selection?.kind==='card'&&selection.id===card.id,
    data:{card,...(selection?.kind==='port'&&selection.card===card.id?{selectedPort:selection.port}:{})},
  })),[flow,positions,dragging,measured,selection]);
  const edges=useMemo<FlowEdgeData[]>(()=>flow.edges.map(edge=>{
    const chosen=selection?.kind==='port'&&selection.card===edge.source&&selection.port===edge.sourceHandle;
    return {id:edge.id,source:edge.source,sourceHandle:edge.sourceHandle,target:edge.target,targetHandle:'in',type:'smoothstep',data:{owner:edge.owner},selected:chosen,ariaLabel:`${edge.source} ${edge.label} to ${edge.target}`,
      markerEnd:{type:MarkerType.ArrowClosed,color:'#96869f'},style:{strokeWidth:chosen?2.5:1.4,...(edge.dashed?{strokeDasharray:'6 4'}:{})}};
  }),[flow,selection]);
  const initialised=useNodesInitialized();
  useEffect(()=>{if(!fitted.current&&campaign&&initialised&&flow.cards.length>1){fitted.current=true;void flowApi.fitView({padding:.12})}},[campaign,initialised,flow.cards.length]);
  const nodeChanges=(changes:NodeChange<CardNode>[])=>{
    const sizes=changes.filter(change=>change.type==='dimensions');
    if(sizes.length)setMeasured(old=>{const next={...old};for(const change of sizes)if(change.type==='dimensions'&&change.dimensions)next[change.id]=change.dimensions;return next});
    const moves=changes.filter(change=>change.type==='position'&&change.position);
    if(moves.length)setDragging(old=>{const next={...old};for(const change of moves)if(change.type==='position'&&change.position)next[change.id]=change.position;return next});
  };
  const dropped=()=>{
    const keys=Object.fromEntries(Object.entries(dragging).map(([id,p])=>[flow.cards.find(card=>card.id===id)?.layoutKey??id,p]));
    setDragging({});
    if(Object.keys(keys).length)edits.commit(withLayout(edits.current.current,keys));
  };
  const connect=(connection:Connection)=>{
    const card=flow.cards.find(c=>c.id===connection.source),port=card?.ports.find(p=>p.id===connection.sourceHandle);
    if(!port||!connection.target)return;
    setSelection({kind:'port',card:card!.id,port:port.id});setTab('selected');
    aim(port.owner,connection.target);
  };
  const selectedCard=selection?flow.cards.find(card=>card.id===(selection.kind==='card'?selection.id:selection.card)):undefined;
  const selectedPort=selection?.kind==='port'?selectedCard?.ports.find(port=>port.id===selection.port):undefined;

  // ---- Keys ----
  useEffect(()=>{
    const element=shell.current;if(!element)return;
    const key=(event:KeyboardEvent)=>{
      if(confirmation)return;
      const target=event.target as Element|null;if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;
      const mod=event.ctrlKey||event.metaKey,letter=event.key.toLowerCase();
      let handled=true;
      if(mod&&letter==='z')void(event.shiftKey?edits.redo():edits.undo());
      else if(mod&&letter==='y')void edits.redo();
      else if(!mod&&letter==='f')void flowApi.fitView({padding:.12,duration:200});
      else if((event.key==='Delete'||event.key==='Backspace')&&!target?.closest('.inspector')){if(selectedPort?.target)aim(selectedPort.owner,undefined);else handled=false}
      else handled=false;
      if(handled){event.preventDefault();event.stopPropagation()}
    };
    element.addEventListener('keydown',key);
    return()=>element.removeEventListener('keydown',key);
  });

  // ---- The inspector ----
  const sceneOptions=(none?:string):Option[]=>[...(none?[{value:'',label:none}]:[]),...doc.scenes.map(key=>({value:sceneCard(key),label:`${sceneFile(key)?.doc?.title??key} (${key})`}))];
  const mapOptions=(none?:string):Option[]=>[...(none?[{value:'',label:none}]:[]),...doc.maps.map(key=>({value:mapCard(key),label:`${mapFile(key)?.doc?.title??key} (${key})`}))];
  const portEditor=(port:FlowPort)=>{
    const owner=port.owner;
    if(owner.kind==='ending')return <SelectField label={`${port.label}: next scene`} field="next" hint="The scene the story goes on to, in the scene's file." value={port.target??''} options={sceneOptions('Nowhere: the story ends here')} onChange={value=>aim(owner,value||undefined)}/>;
    if(owner.kind==='region')return <SelectField label={`${port.label}: plays`} field="sceneId" hint="The scene played in this region, in the map's file." value={port.target??''} options={sceneOptions('No scene')} onChange={value=>aim(owner,value||undefined)}/>;
    if(owner.kind==='exits'){
      const map=mapFile(owner.map)?.doc,first=map?.exits[owner.indices[0]];
      return <>
        <SelectField label={`${port.label}: to`} field="to.map" hint={`Where ${owner.indices.length===1?'this exit leads':`these ${owner.indices.length} exits lead`}, in the map's file.`} value={port.target??mapCard(owner.to)} options={mapOptions()} onChange={value=>aim(owner,value)}/>
        {first&&owner.indices.length===1&&<TileFields label="Lands at (tile there)" at={first.to.at} onChange={at=>writeMap(owner.map,m=>setExit(m,owner.indices[0],{...m.exits[owner.indices[0]],to:{...m.exits[owner.indices[0]].to,at}}))}/>}
        {owner.indices.length>1&&<p className="muted">Each lands where it does: {owner.indices.map(i=>{const e=map?.exits[i];return e?`(${e.at.x}, ${e.at.y}) → (${e.to.at.x}, ${e.to.at.y})`:''}).join(', ')}. Open the map to move them.</p>}
        <button type="button" className="text-button danger" onClick={()=>aim(owner,undefined)}><Trash2 size={13}/>Delete {owner.indices.length===1?'this exit':'these exits'}…</button>
      </>;
    }
    if(owner.kind==='start')return <>
      <SelectField label="Starts on" field="start.map" hint="The map the player starts walking on, in the scenario." value={doc.start.map?mapCard(doc.start.map):''} options={mapOptions('No map: the first scene opens at once')} onChange={value=>aim(owner,value||undefined)}/>
      {doc.start.map&&doc.start.at&&<TileFields label="Start tile" at={{x:doc.start.at[0],y:doc.start.at[1]}} onChange={at=>edits.commit(withStart(doc,doc.start.map,at))}/>}
    </>;
    return <SelectField label="First lead" field="firstScene" hint="The story's first scene, in the scenario." value={doc.firstScene?sceneCard(doc.firstScene):''} options={sceneOptions()} onChange={value=>aim(owner,value)}/>;
  };
  const cardInspector=(card:FlowCard)=>{
    if(card.kind==='start')return <div className="card-inspector"><p className="inspector-kind"><Flag size={13}/>The start</p><p className="muted">Day {doc.start.day}, {doc.start.time.replace('-',' ')}. {doc.start.map?`The player starts walking on ${doc.start.map}${doc.start.at?` at (${doc.start.at[0]}, ${doc.start.at[1]})`:''}, and the first lead is ${doc.firstScene||'not set'}.`:`The first scene, ${doc.firstScene||'not set yet'}, opens at once.`}</p>{card.ports.map(port=><div key={port.id} className="port-editor">{portEditor(port)}</div>)}</div>;
    return <div className="card-inspector" data-card={card.id}>
      <p className="inspector-kind">{card.kind==='scene'?<BookOpen size={13}/>:<MapIcon size={13}/>}{card.kind==='scene'?'Scene':'Map'}<code>{card.key}</code></p>
      <h3 className="inspector-title">{card.title}</h3>
      <p className="muted">{card.subtitle}</p>
      {card.path&&<button type="button" className="wide-button" onClick={()=>open(card.path!)}>Open {card.path} <ExternalLink size={13}/></button>}
      {card.error&&<p className="scenario-warning">{card.error}</p>}
      {card.kind==='scene'&&<>{!card.ports.length&&<p className="muted">No endings: open the scene to add one.</p>}{card.ports.map(port=><div key={port.id} className="port-editor" data-port={port.id}>{portEditor(port)}</div>)}</>}
      {card.kind==='map'&&<MapWiring card={card} file={mapFile(card.key!)?.doc} sceneOptions={sceneOptions('No scene')} portEditor={portEditor} onRegion={(index,scene)=>writeMap(card.key!,m=>setRegionField(m,index,'sceneId',scene))}/>}
    </div>;
  };
  const body=()=>{
    if(tab==='scenario')return <ScenarioPanel doc={doc} campaign={known} actions={actions}/>;
    if(tab==='problems')return <div className="problems-panel">
      {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
      {campaign&&(problems.length?<p className="muted">The campaign check would refuse the campaign for {problems.length===1?'this':`these ${problems.length}`}. Each takes you to its file.</p>:<p className="problems-clear"><CheckCircle2 size={15}/>No problems: the campaign check finds nothing in the scenario, its maps or its places.</p>)}
      <ol className="problems">{problems.map((problem,i)=><li key={`${i}:${problem.message}`}><button type="button" className="problem" onClick={()=>{if(problem.at.kind==='scenario'){setTab('scenario');requestAnimationFrame(()=>{const field=shell.current?.querySelector<HTMLElement>(`[data-field="${problem.at.kind==='scenario'?problem.at.field:''}"], [data-section="${problem.at.kind==='scenario'?problem.at.field:''}"]`);field?.closest('details')?.setAttribute('open','');field?.scrollIntoView({block:'center'})})}else open(problem.path)}}><AlertTriangle size={14}/><span><b>{problem.message}</b><small>{problem.file}</small></span></button></li>)}</ol>
    </div>;
    if(selectedPort&&selectedCard)return <div className="card-inspector"><p className="inspector-kind">{selectedCard.title}</p><div className="port-editor">{portEditor(selectedPort)}</div><button type="button" className="text-button" onClick={()=>setSelection({kind:'card',id:selectedCard.id})}>All of {selectedCard.title}</button></div>;
    if(selectedCard)return cardInspector(selectedCard);
    return <p className="info-box">Click a scene or a map to wire it here, or drag from one of its ways out (an ending, a region that plays a scene, a way to another map) to where it goes. Each is written in the file that owns it. The Scenario tab has the scenario's own fields.</p>;
  };
  const tabs:[typeof tab,string,number|undefined][]=[['selected','Selected',undefined],['scenario','Scenario',undefined],['problems','Problems',campaign?problems.length:undefined]];
  return <EditSession.Provider value={edits.sessionHandlers}>
    <div className="km-workshop km-forms km-scenario" ref={shell} tabIndex={0} onPointerDown={event=>{if(!(event.target as Element).closest('input,textarea,select,button,a'))shell.current?.focus({preventScroll:true})}}>
      <main className="workspace" inert={!!confirmation||undefined}>
        <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">{edits.busy?'Saving…':'Autosaves to this file and the files it wires'}</span></header>
        <div className="canvas-heading"><div><div className="eyebrow">KINGMAKER · SCENARIO · <code>{doc.id}</code></div><h1>{doc.title||doc.id}</h1></div></div>
        <div className="toolbar">
          <div><button onClick={()=>setTab('problems')} className={problems.length?'has-problems':''}>{campaign?`${problems.length} problem${problems.length===1?'':'s'}`:'Checking…'}</button><span className="scenario-toolbar-hint">The flow is the files': endings, regions and exits</span></div>
          <div><button title="Undo (Ctrl Z)" aria-label="Undo" disabled={!edits.canUndo||edits.busy} onClick={()=>void edits.undo()}><Undo2 size={16}/></button><button title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!edits.canRedo||edits.busy} onClick={()=>void edits.redo()}><Redo2 size={16}/></button><button title="Fit the diagram (F)" aria-label="Fit the diagram" onClick={()=>void flowApi.fitView({padding:.12,duration:200})}><Maximize size={16}/></button></div>
        </div>
        <div className="graph-canvas">
          <ReactFlow<CardNode,FlowEdgeData> nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={.06} maxZoom={1.6} deleteKeyCode={null} panOnDrag={[1,2]} panOnScroll zoomOnDoubleClick={false} colorMode="system" nodesConnectable={!edits.busy} nodesDraggable={!edits.busy}
            onNodesChange={nodeChanges} onNodeDragStop={dropped} onConnect={connect}
            onNodeClick={(_,node)=>{setSelection({kind:'card',id:node.id});setTab('selected')}}
            onNodeDoubleClick={(_,node)=>{const path=node.data.card.path;if(path)open(path)}}
            onEdgeClick={(_,edge)=>{setSelection({kind:'port',card:edge.source,port:edge.sourceHandle!});setTab('selected')}}
            onPaneClick={()=>setSelection(null)}>
            <Background gap={24}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={node=>(node.data as CardNode['data']).card.kind==='map'?'#5f8f8a':(node.data as CardNode['data']).card.kind==='start'?'#5f8f6a':'#8874ac'}/>
          </ReactFlow>
        </div>
        <footer className="statusbar"><span>{doc.scenes.length} scenes · {doc.maps.length} maps · {doc.places.length} places · {flow.edges.length} ways on{edits.busy?' · Saving…':''}</span><span>Drag from a way out to where it goes · F fits · double-click opens a file</span></footer>
      </main>
      <aside className="inspector scenario-inspector" inert={!!confirmation||undefined}>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector">{tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} aria-label={count===undefined?label:`${label} (${count})`} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{count!==undefined&&<span className={`count${id==='problems'&&count?' bad':''}`}>{count}</span>}</button>)}</div>
        <div className="inspector-body" role="tabpanel">{body()}</div>
      </aside>
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
      {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} fallbackFocus={shell.current} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    </div>
  </EditSession.Provider>;
}

/** A map's wiring: its ways out (as on its card), and every region, each able to play a scene. */
function MapWiring({card,file,sceneOptions,portEditor,onRegion}:{card:FlowCard;file:MapDocument|undefined;sceneOptions:Option[];portEditor:(port:FlowPort)=>React.ReactNode;onRegion:(index:number,scene:string|undefined)=>void}){
  if(!file)return null;
  const exits=card.ports.filter(port=>port.owner.kind==='exits');
  return <>
    <div className="subheading">Ways out</div>
    {!exits.length&&<p className="muted">None: add exits on the map.</p>}
    {exits.map(port=><div key={port.id} className="port-editor" data-port={port.id}>{portEditor(port)}</div>)}
    <div className="subheading">Regions</div>
    {file.regions.map((region,index)=><div key={`${region.id}:${index}`} className="port-editor" data-region={region.id}>
      <SelectField label={`${region.name||region.id}: plays`} value={region.sceneId?sceneCard(region.sceneId):''} options={sceneOptions} onChange={value=>onRegion(index,value?value.slice(6):undefined)}/>
    </div>)}
  </>;
}

export {serializeJson,endingsOf,START_CARD};
export type {FileChange};

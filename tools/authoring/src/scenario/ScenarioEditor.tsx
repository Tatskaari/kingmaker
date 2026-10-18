// The scenario editor: the campaign's .kmscenario. Under its title, a bar of views: the Diagram of its
// scenes and maps (the story's flow between them drawn from the files that own it, each ending's next,
// each region's scene, each map's ways out, and the start, edited there, with an inspector for what's
// selected on it), the Scenario's own fields, its Files (the scenes, maps and places it lists), its
// Quests, and its Problems (the campaign check's, each taking the author to where it is).
import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Background,Controls,Handle,MarkerType,MiniMap,Position,ReactFlow,ReactFlowProvider,useNodesInitialized,useReactFlow,useStoreApi} from '@xyflow/react';
import type {Connection,Edge,Node,NodeChange,NodeProps,Viewport} from '@xyflow/react';
import {BookOpen,Eraser,Flag,Map as MapIcon,Maximize,Redo2,Undo2,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits,useWritten} from '../campaign/edits.ts';
import type {FileChange} from '../campaign/edits.ts';
import {campaignProblems,pathIn,withDraft} from '../campaign/files.ts';
import type {CampaignFiles,CampaignProblem} from '../campaign/files.ts';
import {EditSession} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {serializeScene,setNodeField,skeletonScene} from '../scene/model.ts';
import type {SceneDocument} from '../scene/model.ts';
import {newMap,serializeMap} from '../map/model.ts';
import type {MapDocument} from '../map/model.ts';
import {newPlace,serializePlace} from '../place/model.ts';
import {DocHeading,Inspector,ProblemsList,ViewArea,ViewBar,revealSoon,useFileView} from '../campaign/views.tsx';
import type {NewKind,ViewTab} from '../campaign/views.tsx';
import {START_CARD,flowOf,landingOn,layoutOf,mapCard,questUsesOf,renameQuest,renameQuestIn,sceneCard,scenarioShapeOf,serializeScenario,setScenarioField,withLayout} from './model.ts';
import type {Flow,FlowCard,FlowOwner,ScenarioDocument} from './model.ts';
import {FilesView,LIST_OF,QuestsView,ScenarioView} from './views.tsx';
import type {Lists,ScenarioActions} from './views.tsx';
import {CardInspector,PortInspector,useWiring} from './inspectors.tsx';
import '@xyflow/react/dist/style.css';
import '../styles.css';
import '../campaign/views.css';
import '../scenario.css';

type CardNode=Node<{card:FlowCard;selectedPort?:string;choosePort:(card:string,port:string)=>void},'card'>;
type FlowEdgeData=Edge<{owner:FlowOwner}>;
export type Selection={kind:'card';id:string}|{kind:'port';card:string;port:string}|null;
export type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};
type View='diagram'|'scenario'|'files'|'quests'|'problems';
const VIEW_IDS:View[]=['diagram','scenario','files','quests','problems'];
const ICONS={start:Flag,scene:BookOpen,map:MapIcon};
/** Each file's diagram viewport, remembered while the plugin is loaded (the diagram is drawn again when its view comes back). */
const viewports=new Map<string,Viewport>();
/** Where each of the scenario's own fields is edited: its view. */
const FIELD_VIEWS:Record<string,View>={scenes:'files',maps:'files',places:'files',talk:'files',quests:'quests'};

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
    {card.ports.map(port=><div key={port.id} className={`scenario-port${data.selectedPort===port.id?' chosen':''}${port.target?'':' loose'}`} data-port={port.id} title="Click to wire it in the inspector, or drag from its handle" onClick={event=>{event.stopPropagation();data.choosePort(card.id,port.id)}}>
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
  const ids=useId();
  const [view,setViewState]=useFileView<View>(host.filePath,'diagram',VIEW_IDS);
  const flowApiRef=useRef<ReturnType<typeof useReactFlow<CardNode,FlowEdgeData>>|null>(null);
  /** Another view: the diagram's viewport kept for when it's drawn again. */
  const setView=(next:View)=>{if(view==='diagram'&&flowApiRef.current)viewports.set(host.filePath,flowApiRef.current.getViewport());setViewState(next)};
  const [selection,setSelection]=useState<Selection>(null);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[dragging,setDragging]=useState<Record<string,{x:number;y:number}>>({});
  const [measured,setMeasured]=useState<Record<string,{width:number;height:number}>>({});
  const flowApi=useReactFlow<CardNode,FlowEdgeData>(),shell=useRef<HTMLDivElement>(null),fitted=useRef(viewports.has(host.filePath));
  flowApiRef.current=flowApi;
  /** A card just made (a new scene or map), to bring into view once it's on the diagram. */
  const shown=useRef<string|null>(null);
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
  const notes=[...(!campaign?['Reading the campaign…']:[]),...(campaign?.error&&!campaign.scenario?[`The campaign couldn't be read (${campaign.error}).`]:[])];

  // ---- Edits: the scenario's own, and the files a new one makes or an edge's owner ----
  const ask=(next:Confirmation)=>setConfirmation(next);
  const open=(path:string)=>void host.open(path).catch(error=>setToast(String(error instanceof Error?error.message:error)));
  /**
   * A new file of the campaign: made from its skeleton (a scene's, a map of the default legend, a place
   * of one area), then listed in the scenario (unless it's to be the talk template) with `pick` applied to
   * it, and `others` written beside it, as one step of undo. The file stays when the step is undone.
   */
  const make:ScenarioActions['make']=(kind,title,id,then)=>{
    if(!known){setToast('Still reading the campaign.');return}
    const list=LIST_OF[kind];
    const path=kind==='scene'?pathIn.scene(known.root,id):kind==='map'?pathIn.map(known.root,id):pathIn.place(known.root,id);
    const text=kind==='scene'?serializeScene(skeletonScene(title,id)):kind==='map'?serializeMap(newMap(title,id)):serializePlace(newPlace(title,id));
    void host.create(path,text).then(()=>{
      const base=edits.current.current;
      const listed=then?.unlisted||base[list].includes(id)?base:setScenarioField(base,list,[...base[list],id]);
      const next=then?.pick?then.pick(listed):listed;
      const others=then?.others?.()??[];
      if(others.length)void edits.write(others,next);else edits.commit(next);
      if(kind!=='place')shown.current=kind==='scene'?sceneCard(id):mapCard(id);
      setToast(`Made ${path}${listed===base?'':', and listed it'}. Undo takes back what it changed; the file stays.`);
    }).catch(error=>setToast(String(error instanceof Error?error.message:error)));
  };
  const wiring=useWiring({doc,known,edits,ask,setToast,make});
  const actions:ScenarioActions={
    edit:next=>edits.commit(next,true),
    make,
    open,
    landing:map=>landingOn(known?.maps.find(file=>file.key===map)?.doc,undefined),
    unlist:(kind:Lists,key:string)=>ask({title:`Take ${key} out of the scenario?`,description:`${key} won't be one of the scenario's ${kind}: the game won't install it. Its file stays. You can undo this.`,confirmLabel:'Take it out',run:()=>edits.commit(setScenarioField(edits.current.current,kind,edits.current.current[kind].filter(k=>k!==key)))}),
    renameQuest:(from,to)=>{
      // The scenario's key, and every scene's effect naming it, in that scene's file: one step.
      const changes:FileChange[]=(known?.scenes??[]).flatMap(scene=>{
        if(!scene.doc||scene.text===undefined)return [];
        const after=serializeScene(renameQuestIn(scene.doc,from,to));
        return after===scene.text?[]:[{path:scene.path,before:scene.text,after}];
      });
      const next=renameQuest(edits.current.current,from,to);
      if(changes.length)void edits.write(changes,next);else edits.commit(next);
    },
    removeQuest:key=>{
      const uses=known?questUsesOf(key,known):[];
      ask({title:`Remove the quest ${key}?`,description:`${doc.quests?.[key]||key} won't be one of the scenario's quests.${uses.length?` ${uses.length} effect${uses.length===1?' names':'s name'} it (${[...new Set(uses.map(use=>use.sceneTitle))].join(', ')}): the problems will say so.`:''} You can undo this.`,confirmLabel:'Remove quest',
        run:()=>{const quests=Object.fromEntries(Object.entries(edits.current.current.quests??{}).filter(([k])=>k!==key));edits.commit(setScenarioField(edits.current.current,'quests',quests))}});
    },
  };

  // ---- The diagram ----
  const choosePort=useMemo(()=>(card:string,port:string)=>setSelection({kind:'port',card,port}),[]);
  const nodes=useMemo<CardNode[]>(()=>flow.cards.map(card=>({
    id:card.id,type:'card',position:dragging[card.id]??positions.get(card.id)??{x:0,y:0},measured:measured[card.id],deletable:false,
    selected:selection?.kind==='card'&&selection.id===card.id,
    data:{card,choosePort,...(selection?.kind==='port'&&selection.card===card.id?{selectedPort:selection.port}:{})},
  })),[flow,positions,dragging,measured,selection]);
  const edges=useMemo<FlowEdgeData[]>(()=>flow.edges.map(edge=>{
    const chosen=selection?.kind==='port'&&selection.card===edge.source&&selection.port===edge.sourceHandle;
    return {id:edge.id,source:edge.source,sourceHandle:edge.sourceHandle,target:edge.target,targetHandle:'in',type:'smoothstep',data:{owner:edge.owner},selected:chosen,ariaLabel:`${edge.source} ${edge.label} to ${edge.target}`,
      markerEnd:{type:MarkerType.ArrowClosed,color:'#96869f'},style:{strokeWidth:chosen?2.5:1.4,...(edge.dashed?{strokeDasharray:'6 4'}:{})}};
  }),[flow,selection]);
  const initialised=useNodesInitialized();
  useEffect(()=>{if(view==='diagram'&&!fitted.current&&campaign&&initialised&&flow.cards.length>1){fitted.current=true;void flowApi.fitView({padding:.12})}},[view,campaign,initialised,flow.cards.length]);
  // A new scene's card goes at the end of the story's row, a new map's at the end of the maps': often past the diagram's edge, so the view moves to it (when the diagram is shown).
  useEffect(()=>{
    const id=shown.current,at=id?positions.get(id):undefined;if(view!=='diagram'||!id||!at||!initialised)return;
    shown.current=null;const size=measured[id]??{width:260,height:150};
    void flowApi.setCenter(at.x+size.width/2,at.y+size.height/2,{zoom:flowApi.getZoom(),duration:200});
  },[positions,view,initialised]);
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
    setSelection({kind:'port',card:card!.id,port:port.id});
    wiring.aim(port.owner,connection.target);
  };
  const fit=()=>void flowApi.fitView({padding:.12,duration:200});
  const forgetLayout=()=>ask({title:'Forget the layout?',description:`The ${Object.keys(doc.layout??{}).length} cards you've placed go back where the default puts them (the story's scenes along the top, the maps beneath). The game doesn't read the layout. You can undo this.`,confirmLabel:'Forget the layout',run:()=>edits.commit(setScenarioField(edits.current.current,'layout',undefined))});
  const selectedCard=selection?flow.cards.find(card=>card.id===(selection.kind==='card'?selection.id:selection.card)):undefined;
  const selectedPort=selection?.kind==='port'?selectedCard?.ports.find(port=>port.id===selection.port):undefined;

  // ---- Going to a problem: its field in the view that has it, or its file ----
  const go=(problem:CampaignProblem)=>{
    if(problem.at.kind!=='scenario'){open(problem.path);return}
    const field=problem.at.field||'title';
    setView(FIELD_VIEWS[field.split('.')[0]]??'scenario');
    revealSoon(shell.current,field);
  };

  // ---- Keys: scoped to this editor, never while typing; the diagram's only on the diagram ----
  useEffect(()=>{
    const element=shell.current;if(!element)return;
    const key=(event:KeyboardEvent)=>{
      if(confirmation)return;
      const target=event.target as Element|null;if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;
      const mod=event.ctrlKey||event.metaKey,letter=event.key.toLowerCase(),diagram=view==='diagram';
      let handled=true;
      if(mod&&letter==='z')void(event.shiftKey?edits.redo():edits.undo());
      else if(mod&&letter==='y')void edits.redo();
      else if(diagram&&!mod&&letter==='f')fit();
      else if(diagram&&(event.key==='Delete'||event.key==='Backspace')&&!target?.closest('.inspector')){if(selectedPort?.target)wiring.unwire(selectedPort.owner);else handled=false}
      else handled=false;
      if(handled){event.preventDefault();event.stopPropagation()}
    };
    element.addEventListener('keydown',key);
    return()=>element.removeEventListener('keydown',key);
  });

  // ---- The views ----
  const tabs:ViewTab<View>[]=[{id:'diagram',label:'Diagram'},{id:'scenario',label:'Scenario'},{id:'files',label:'Files',count:doc.scenes.length+doc.maps.length+doc.places.length},{id:'quests',label:'Quests',count:Object.keys(doc.quests??{}).length},{id:'problems',label:'Problems',...(campaign?{count:problems.length,bad:true}:{})}];
  const inspectorBody=()=>{
    if(selectedPort&&selectedCard)return <PortInspector card={selectedCard} port={selectedPort} doc={doc} known={known} wiring={wiring} onAll={()=>setSelection({kind:'card',id:selectedCard.id})} open={open}/>;
    if(selectedCard)return <CardInspector card={selectedCard} doc={doc} known={known} wiring={wiring} open={open} onPort={port=>setSelection({kind:'port',card:selectedCard.id,port})}/>;
    return <p className="info-box">Click a scene, a map or the start to wire it here, or drag from one of its ways out (an ending, a region that plays a scene, a way to another map) to where it goes. Each is written in the file that owns it. The scenario's own fields, its files and its quests are views of their own, in the bar above.</p>;
  };
  const what=selectedPort?<><span className="kind-dot route"/>Way out</>:selectedCard?<><span className={`kind-dot ${selectedCard.kind==='map'?'map':selectedCard.kind==='start'?'start':'scene'}`}/>{selectedCard.kind==='start'?'The start':selectedCard.kind==='scene'?'Scene':'Map'}</>:'Nothing selected';
  const saved=viewports.get(host.filePath);
  return <EditSession.Provider value={edits.sessionHandlers}>
    <div className="km-workshop km-forms km-scenario" ref={shell} tabIndex={0} onPointerDown={event=>{if(!(event.target as Element).closest('input,textarea,select,button,a'))shell.current?.focus({preventScroll:true})}}>
      <main className="workspace" inert={!!confirmation||undefined}>
        <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">{edits.busy?'Saving…':'Autosaves to this file and the files it wires'}</span></header>
        <DocHeading kind="scenario" id={doc.id} title={doc.title} problems={problems.length} checking={!campaign} onProblems={()=>setView('problems')}/>
        <ViewBar ids={ids} label="Views of the scenario" views={tabs} view={view} onView={setView} actions={<>
          <button type="button" title="Undo (Ctrl Z)" aria-label="Undo" disabled={!edits.canUndo||edits.busy} onClick={()=>void edits.undo()}><Undo2 size={16}/></button>
          <button type="button" title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!edits.canRedo||edits.busy} onClick={()=>void edits.redo()}><Redo2 size={16}/></button>
          {view==='diagram'&&<button type="button" title="Fit the diagram (F)" aria-label="Fit the diagram" onClick={fit}><Maximize size={16}/></button>}
          {view==='diagram'&&doc.layout&&<button type="button" title="Forget the layout: every card where the default puts it" aria-label="Forget the layout" onClick={forgetLayout}><Eraser size={16}/></button>}
        </>}/>
        <ViewArea ids={ids} view={view}>
          {view==='diagram'&&<div className="canvas-view">
            <div className="graph-canvas">
              <ReactFlow<CardNode,FlowEdgeData> nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={.06} maxZoom={1.6} deleteKeyCode={null} panOnDrag={[1,2]} panOnScroll zoomOnDoubleClick={false} colorMode="system" nodesConnectable={!edits.busy} nodesDraggable={!edits.busy}
                {...(saved?{defaultViewport:saved}:{})} onMoveEnd={(_,viewport)=>{viewports.set(host.filePath,viewport)}}
                onNodesChange={nodeChanges} onNodeDragStop={dropped} onConnect={connect}
                onNodeClick={(_,node)=>setSelection({kind:'card',id:node.id})}
                onNodeDoubleClick={(_,node)=>{const path=node.data.card.path;if(path)open(path)}}
                onEdgeClick={(_,edge)=>setSelection({kind:'port',card:edge.source,port:edge.sourceHandle!})}
                onPaneClick={()=>setSelection(null)}>
                <Background gap={24}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={node=>(node.data as CardNode['data']).card.kind==='map'?'#5f8f8a':(node.data as CardNode['data']).card.kind==='start'?'#5f8f6a':'#8874ac'}/>
              </ReactFlow>
            </div>
            <Inspector what={what} empty={!selectedCard} onClose={()=>setSelection(null)} className="scenario-inspector">{inspectorBody()}</Inspector>
          </div>}
          {view==='scenario'&&<div className="view-scroll"><ScenarioView doc={doc} campaign={known} actions={actions}/></div>}
          {view==='files'&&<div className="view-scroll"><FilesView doc={doc} campaign={known} actions={actions}/></div>}
          {view==='quests'&&<div className="view-scroll"><QuestsView doc={doc} campaign={known} actions={actions}/></div>}
          {view==='problems'&&<div className="view-scroll"><ProblemsList lede={<>The campaign check's rules for the scenario, its maps and its places (<code>npm run campaign -- check</code>), with every file as it is now. Each takes you to its field here, or opens its file.</>} problems={problems} notes={notes} checking={!campaign} clear="No problems: the campaign check finds nothing in the scenario, its maps or its places." onGo={go}/></div>}
        </ViewArea>
        <footer className="statusbar"><span>{doc.scenes.length} scenes · {doc.maps.length} maps · {doc.places.length} places · {flow.edges.length} ways on{edits.busy?' · Saving…':''}</span><span>{view==='diagram'?'Drag from a way out to where it goes · F fits · double-click opens a file':'Each field saves as you type'}</span></footer>
      </main>
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
      {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} fallbackFocus={shell.current} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    </div>
  </EditSession.Provider>;
}


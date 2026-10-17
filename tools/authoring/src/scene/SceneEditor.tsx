// The scene editor: a .kmscene file (the game's scene format, version 2) as a graph of its start, beats
// and endings with the routes between them, an inspector for what's selected, the scene's own fields,
// its cast, and the game's rules run as it's edited.
import React,{useDeferredValue,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Background,Controls,Handle,MarkerType,MiniMap,Position,ReactFlow,ReactFlowProvider,useReactFlow} from '@xyflow/react';
import type {Connection as FlowConnection,Edge,Node,NodeChange,NodePositionChange,NodeProps} from '@xyflow/react';
import {BookOpen,Flag,Keyboard,LogIn,Maximize,Plus,Redo2,Search,Star,Undo2,X,Zap} from 'lucide-react';
import {SceneApiContext} from './api.ts';
import type {Confirmation,LoreRequest,SceneApi} from './api.ts';
import {contextOf,isListed,sceneKeyOf} from './campaign.ts';
import type {Campaign,LoreKind} from './campaign.ts';
import {CastPanel} from './CastPanel.tsx';
import {EditSession} from './fields.tsx';
import {ConnectionInspector,KIND_LABELS,NodeInspector} from './inspectors.tsx';
import type {SceneHost} from './host.ts';
import {addNode,addRoute,connectionId,connectionsOf,isEnding,isStart,nodeKind,problemsOf,removeNodes,removeRoutes,shapeOf,slugOf,titleOf,uniqueId} from './model.ts';
import type {Connection,NewNodeKind,NodeKind,Problem,ProblemAt,SceneDocument,SceneNode} from './model.ts';
import {ProblemsPanel} from './ProblemsPanel.tsx';
import {ScenePanel} from './ScenePanel.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {ConnectionEdge} from '../ConnectionEdge';
import {EditorModal} from '../EditorModal';
import '@xyflow/react/dist/style.css';
import '../styles.css';
import './scene.css';

/** The editor for a scene file. The host saves what it's handed; the editor's undo lasts while the file is open. */
export function SceneApp({document,host}:{document:SceneDocument;host:SceneHost}){
  return <ReactFlowProvider><SceneEditor initial={document} host={host}/></ReactFlowProvider>;
}

type Tab='selection'|'scene'|'cast'|'problems';
type Selected={kind:'node';id:string}|{kind:'connection';id:string}|null;
type CardData={node:SceneNode;problems:number;arrivals:string[];here:number};
type FlowNode=Node<CardData,'scene'>;
type FlowEdge=Edge<{routes:Connection['routes']}>;

const ICONS:Record<NodeKind,typeof LogIn>={start:LogIn,discovery:Search,event:Zap,ending:Flag};
const COLORS:Record<NodeKind,string>={start:'#5f8f6a',discovery:'#8874ac',event:'#b07f3f',ending:'#a5615c'};
const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
const uid=()=>crypto.randomUUID();

/** A node on the graph: its kind at a glance (a discovery's paths, a required one marked, an ending's result). */
function SceneCard({data,selected}:NodeProps<FlowNode>){
  const {node,problems,arrivals,here}=data;
  const kind=nodeKind(node);
  const Icon=ICONS[kind];
  const d=node.data as SceneNode['data']&{revelation?:string;paths?:unknown[];required?:boolean;result?:string;exitKind?:string;next?:string};
  const result=kind==='ending'?d.result:undefined;
  return <article className={`story-card scene-card ${kind}${d.required?' required':''}${result?` result-${result}`:''}${selected?' chosen':''}`} data-node-id={node.id}>
    {kind!=='start'&&<Handle type="target" position={Position.Left}/>}
    <div className="card-kind"><Icon size={13}/>{KIND_LABELS[kind]}{d.required&&<span className="required-mark" title="Required: the scene can't end well without it"><Star size={11}/>Required</span>}{problems>0&&<span className="card-problems" title={`${problems} problem${problems===1?'':'s'}`}>{problems}</span>}</div>
    <h3>{node.data.title||node.id}</h3>
    <p>{kind==='discovery'?d.revelation||node.data.description:node.data.description}</p>
    <footer>
      {kind==='start'&&<span>{here} here at the start</span>}
      {kind==='discovery'&&<span className="paths-count">{d.paths?.length??0} path{d.paths?.length===1?'':'s'}</span>}
      {kind==='event'&&<span>{arrivals.length?`${arrivals.join(', ')} arrive${arrivals.length===1?'s':''}`:'A turn the scene takes'}</span>}
      {kind==='ending'&&<><span className={`result-badge ${d.result}`}>{d.result}</span><span>{d.exitKind}</span><span className="next">{d.next?`→ ${d.next}`:'the story ends'}</span></>}
    </footer>
    {kind!=='ending'&&<Handle type="source" position={Position.Right}/>}
  </article>;
}
const nodeTypes={scene:SceneCard};

/** Is a node on the graph the same as it was: the same node of the file, where it was, as measured and selected, showing the same? */
function sameCard(a:FlowNode,b:FlowNode):boolean{
  return a.data.node===b.data.node&&a.position===b.position&&a.selected===b.selected&&a.measured?.width===b.measured?.width&&a.measured?.height===b.measured?.height
    &&a.data.problems===b.data.problems&&a.data.here===b.data.here&&a.data.arrivals.join('\n')===b.data.arrivals.join('\n');
}
const edgeTypes={connection:ConnectionEdge};

function SceneEditor({initial,host}:{initial:SceneDocument;host:SceneHost}){
  // The scene, and its undo: each edit a step, typing in one field from its focus to its blur one step.
  const [doc,setDoc]=useState(initial),current=useRef(initial);
  const [history,setHistory]=useState<SceneDocument[]>([]),[future,setFuture]=useState<SceneDocument[]>([]);
  const session=useRef<string|null>(null),lastSession=useRef<string|null>(null),dragBefore=useRef<SceneDocument|null>(null);
  const [campaign,setCampaign]=useState<Campaign|null>(null);
  const [selected,setSelected]=useState<Selected>(null),[marked,setMarked]=useState<Set<string>>(new Set());
  const [tab,setTab]=useState<Tab>('scene'),[castOpen,setCastOpen]=useState<string|null>(null),[editingRoute,setEditingRoute]=useState<string|null>(null);
  const [expanded,setExpanded]=useState(false),[dialog,setDialog]=useState<'add'|'help'|null>(null),[lorePicker,setLorePicker]=useState<LoreRequest|null>(null);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[connecting,setConnecting]=useState<string|null>(null);
  const [toast,setToast]=useState(''),[inspector,setInspector]=useState(true);
  const [measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  const shell=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),confirmFocus=useRef<HTMLElement|null>(null),pendingField=useRef<string|null>(null);
  const flow=useReactFlow<FlowNode,FlowEdge>();
  const key=sceneKeyOf(host.filePath);

  useCampaign(host,setCampaign,setToast);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast]);

  // ---- Edits ----
  const publish=(next:SceneDocument)=>{current.current=next;setDoc(next);host.change(next)};
  const commit=(next:SceneDocument,coalesce=false)=>{
    const before=current.current;
    if(next===before)return;
    const shape=shapeOf(next);
    if(shape.length){setToast(`Not saved: the game couldn't load the scene like that (${shape[0]}).`);return}
    if(!coalesce||!session.current||lastSession.current!==session.current)setHistory(old=>[...old.slice(-99),before]);
    lastSession.current=coalesce?session.current:null;
    setFuture([]);
    publish(next);
  };
  const edit=(change:(doc:SceneDocument)=>SceneDocument)=>commit(change(current.current),true);
  const undo=()=>{const previous=history.at(-1);if(!previous)return;lastSession.current=null;setHistory(history.slice(0,-1));setFuture(old=>[current.current,...old]);publish(previous)};
  const redo=()=>{const next=future[0];if(!next)return;lastSession.current=null;setHistory(old=>[...old,current.current]);setFuture(future.slice(1));publish(next)};
  const sessionHandlers=useMemo(()=>({onFocus:()=>{session.current=uid()},onBlur:()=>{session.current=null}}),[]);

  // ---- What's derived: the connections, the problems, the scene's place, the lore's names ----
  const connections=useMemo(()=>connectionsOf(doc.edges),[doc.edges]);
  const deferred=useDeferredValue(doc);
  const problems=useMemo<Problem[]>(()=>campaign?problemsOf(key,deferred,contextOf(campaign,key)):[],[deferred,campaign,key]);
  const notes=[
    ...(!campaign?['Reading the campaign…']:[]),
    ...(campaign?.error?[`The campaign couldn't be read (${campaign.error}), so what the rules need of it (its scenes, places, quests) is missing.`]:[]),
    ...(campaign&&!campaign.error&&!isListed(campaign,key)?[`${key} isn't one of campaign.json's scenes, so the game doesn't install it yet: list it there to play it.`]:[]),
  ];
  const place=useMemo(()=>doc.place?campaign?.places.find(candidate=>candidate.key===doc.place):undefined,[doc.place,campaign]);
  const loreNames=useMemo(()=>new Map((campaign?.lore??[]).map(note=>[note.path,note.name])),[campaign]);
  const selectedNode=selected?.kind==='node'?doc.nodes.find(node=>node.id===selected.id):undefined;
  const selectedConnection=selected?.kind==='connection'?connections.find(connection=>connection.id===selected.id):undefined;
  const modalOpen=expanded&&!!(selectedNode||selectedConnection);

  // ---- Showing things ----
  const focusField=(field:string|undefined)=>{pendingField.current=field??null};
  useEffect(()=>{
    const field=pendingField.current;if(!field)return;pendingField.current=null;
    const element=shell.current?.querySelector<HTMLElement>(`.inspector-body [data-field="${field}"]`);
    element?.closest('details')?.setAttribute('open','');
    element?.scrollIntoView({block:'center'});
    element?.querySelector<HTMLElement>('input:not([readonly]),textarea,select')?.focus({preventScroll:true});
  });
  const centre=(id:string)=>{const node=current.current.nodes.find(other=>other.id===id);if(node)void flow.setCenter(node.position.x+130,node.position.y+80,{duration:200,zoom:Math.max(flow.getZoom(),.7)})};
  const showNode=(id:string)=>{setSelected({kind:'node',id});setMarked(new Set());setTab('selection');setInspector(true);centre(id)};
  const showRoute=(id:string)=>{const route=current.current.edges.find(edge=>edge.id===id);if(!route)return;setSelected({kind:'connection',id:connectionId(route.source,route.target)});setEditingRoute(id);setTab('selection');setInspector(true)};
  const showCast=(id:string)=>{setTab('cast');setCastOpen(id);setInspector(true)};
  const go=(at:ProblemAt)=>{
    if(at.kind==='node')showNode(at.id);
    else if(at.kind==='route')showRoute(at.id);
    else if(at.kind==='cast')showCast(at.id);
    else{setTab('scene');setInspector(true);focusField(at.field)}
  };
  const ask=(request:Confirmation)=>{confirmFocus.current=(shell.current?.ownerDocument.activeElement as HTMLElement|null)??null;setConfirmation(request)};
  const openLore=(path:string)=>void host.openLore(path).catch(error=>setToast(error instanceof Error?error.message:String(error)));
  const openScene=(id:string)=>void host.openScene(id).catch(error=>setToast(error instanceof Error?error.message:String(error)));

  // ---- The graph's own edits: nodes added, moved, connected and deleted ----
  const connect=(source:string,target:string)=>{
    setConnecting(null);
    const base=current.current;
    if(base.nodes.find(node=>node.id===source)&&isEnding(base.nodes.find(node=>node.id===source)!)){setToast('No route leaves an ending.');return}
    if(base.nodes.find(node=>node.id===target&&isStart(node))){setToast('The start is where the scene opens: no route goes into it.');return}
    const id=connectionId(source,target);
    if(base.edges.some(route=>route.source===source&&route.target===target)){setSelected({kind:'connection',id});setTab('selection');setToast('These nodes have a route already: add another in the inspector.');return}
    const added=addRoute(base,source,target);
    commit(added.doc);
    setSelected({kind:'connection',id});setEditingRoute(added.id);setTab('selection');setInspector(true);
  };
  const add=(kind:NewNodeKind,title:string,id:string)=>{
    const base=current.current,from=selectedNode&&!isEnding(selectedNode)?selectedNode:undefined;
    const bounds=canvas.current?.getBoundingClientRect();
    const position=from?{x:from.position.x+400,y:from.position.y+60}:flow.screenToFlowPosition({x:(bounds?.x??0)+(bounds?.width??800)/2-130,y:(bounds?.y??0)+(bounds?.height??500)/2-80});
    const added=addNode(base,kind,title,position,{id,...(from?{from:from.id}:{})});
    commit(added.doc);
    setDialog(null);showNode(added.id);
  };
  const deleteSelection=()=>{
    const base=current.current;
    if(selectedConnection){
      const routes=base.edges.filter(route=>route.source===selectedConnection.source&&route.target===selectedConnection.target);
      ask({title:'Delete routes?',confirmLabel:'Delete routes',description:`Delete all ${routes.length} route${routes.length===1?'':'s'} from “${titleOf(base,selectedConnection.source)}” to “${titleOf(base,selectedConnection.target)}”? Both nodes stay. You can undo this.`,onConfirm:()=>{edit(scene=>removeRoutes(scene,routes.map(route=>route.id)));setSelected(null)}});
      return;
    }
    const ids=new Set(marked);if(selectedNode)ids.add(selectedNode.id);
    const nodes=base.nodes.filter(node=>ids.has(node.id)&&!isStart(node));
    if(!nodes.length){if(ids.size)setToast('The start stays: a scene has exactly one.');return}
    const routes=base.edges.filter(route=>nodes.some(node=>node.id===route.source||node.id===route.target)).length;
    const label=nodes.length===1?'Delete node':`Delete ${nodes.length} nodes`;
    ask({title:`${label}?`,confirmLabel:label,description:`Delete ${nodes.length===1?`“${nodes[0].data.title||nodes[0].id}”`:`these ${nodes.length} nodes`}${routes?` and the ${routes} route${routes===1?'':'s'} to and from ${nodes.length===1?'it':'them'}`:''}? You can undo this.`,onConfirm:()=>{edit(scene=>removeNodes(scene,nodes.map(node=>node.id)));setSelected(null);setMarked(new Set());setExpanded(false)}});
  };
  const nodeChanges=(changes:NodeChange<FlowNode>[])=>{
    const sizes=changes.filter(change=>change.type==='dimensions');
    if(sizes.length)setMeasurements(old=>{const next={...old};for(const change of sizes)if(change.type==='dimensions'&&change.dimensions)next[change.id]=change.dimensions;return next});
    const selections=changes.filter(change=>change.type==='select');
    if(selections.length)setMarked(old=>{const next=new Set(old);for(const change of selections)if(change.type==='select')change.selected?next.add(change.id):next.delete(change.id);return next});
    const moves=changes.filter((change):change is NodePositionChange=>change.type==='position'&&!!change.position);
    if(!moves.length)return;
    const base=current.current;
    const next={...base,nodes:base.nodes.map(node=>{const move=moves.find(change=>change.id===node.id);return move?.position?{...node,position:{x:Math.round(move.position.x),y:Math.round(move.position.y)}}:node})};
    if(dragBefore.current)publish(next);else commit(next);
  };
  const fit=()=>void flow.fitView({padding:.16,duration:200});

  // ---- Keys: scoped to this editor, never while typing ----
  useEffect(()=>{
    const element=shell.current;if(!element)return;
    const key=(event:KeyboardEvent)=>{
      if(confirmation||lorePicker)return;
      if(event.key==='Escape'){if(dialog)setDialog(null);else if(modalOpen)setExpanded(false);else setConnecting(null);shell.current?.focus();return}
      if(editable(event.target)||dialog)return;
      const mod=event.ctrlKey||event.metaKey,letter=event.key.toLowerCase();
      if(modalOpen&&!(mod&&(letter==='z'||letter==='y')))return;
      if(event.key==='Enter'&&event.target instanceof Element&&event.target.closest('button,a'))return;
      let handled=true;
      if(mod&&letter==='z')event.shiftKey?redo():undo();
      else if(mod&&letter==='y')redo();
      else if(letter==='a'&&!mod)setDialog('add');
      else if((event.key==='Delete'||event.key==='Backspace')&&!(event.target instanceof Element&&event.target.closest('.inspector')))deleteSelection();
      else if(letter==='f'&&!mod)fit();
      else if(event.key==='?')setDialog('help');
      else handled=false;
      if(handled){event.preventDefault();event.stopPropagation()}
    };
    element.addEventListener('keydown',key);
    return()=>element.removeEventListener('keydown',key);
  });

  // ---- What the panels share ----
  const api:SceneApi={doc,campaign,place,loreNames,edit,openLore,openScene,
    pickLore:request=>setLorePicker(request),confirm:ask,showNode,showRoute,showCast,
    connectFrom:id=>{setExpanded(false);setConnecting(id)},editingRoute,setEditingRoute};

  // ---- The graph as React Flow draws it (measurements and selection are the view's, never the file's) ----
  const problemsAt=useMemo(()=>{const count=new Map<string,number>();for(const problem of problems)if(problem.at.kind==='node')count.set(problem.at.id,(count.get(problem.at.id)??0)+1);return count},[problems]);
  // React Flow keeps a node's measured handles by the node object's identity: a node is a new object only when
  // what it shows has changed, or a late answer (the campaign read, the problems) would lose them and its edges.
  const nodeCache=useRef(new Map<string,FlowNode>());
  const flowNodes=useMemo<FlowNode[]>(()=>doc.nodes.map(node=>{
    const next:FlowNode={
      id:node.id,type:'scene',position:node.position,measured:measurements[node.id],
      selected:marked.has(node.id)||selected?.kind==='node'&&selected.id===node.id,
      data:{node,problems:problemsAt.get(node.id)??0,arrivals:doc.cast.filter(member=>member.enters===node.id).map(member=>member.name||member.id),here:doc.cast.filter(member=>member.enters===undefined).length},
    };
    const old=nodeCache.current.get(node.id);
    if(old&&sameCard(old,next))return old;
    nodeCache.current.set(node.id,next);
    return next;
  }),[doc.nodes,doc.cast,measurements,marked,selected,problemsAt]);
  const flowEdges=useMemo<FlowEdge[]>(()=>connections.map(connection=>{
    const cue=connection.routes.every(route=>route.data.phase==='cue'),dice=connection.routes.some(route=>route.data.skill);
    const label=connection.routes.length===1?connection.routes[0].label||connection.routes[0].id:`${connection.routes.length} routes`;
    const chosen=selected?.kind==='connection'&&selected.id===connection.id;
    return {id:connection.id,source:connection.source,target:connection.target,type:'connection',label:dice?`${label} · dice`:label,data:{routes:connection.routes},selected:chosen,
      ariaLabel:`${titleOf(doc,connection.source)} to ${titleOf(doc,connection.target)}: ${label}`,markerEnd:{type:MarkerType.ArrowClosed,color:'#91859d'},
      style:{strokeWidth:chosen?2.5:1.5,...(cue?{strokeDasharray:'6 4'}:{})},labelStyle:{fill:'var(--text-normal, #ddd)',fontSize:11},labelBgStyle:{fill:'var(--background-primary, #24212b)'}};
  }),[connections,selected,doc]);

  const tabs:[Tab,string,number|undefined][]=[['selection',selectedNode?KIND_LABELS[nodeKind(selectedNode)]:selectedConnection?'Routes':'Selected',undefined],['scene','Scene',undefined],['cast','Cast',doc.cast.length],['problems','Problems',campaign?problems.length:undefined]];
  const body=()=>{
    if(tab==='scene')return <ScenePanel/>;
    if(tab==='cast')return <CastPanel open={castOpen} onOpen={setCastOpen}/>;
    if(tab==='problems')return <ProblemsPanel doc={doc} problems={problems} notes={notes} onGo={go}/>;
    if(modalOpen)return <p className="muted">Editing in the larger editor.</p>;
    if(selectedNode)return <NodeInspector key={selectedNode.id} node={selectedNode}/>;
    if(selectedConnection)return <ConnectionInspector key={selectedConnection.id} connection={selectedConnection}/>;
    return <p className="info-box">Click a node or a route on the graph to edit it here. Double-click one for a larger editor. The Scene tab has the scene's own fields, Cast its people, and Problems what the campaign check would say.</p>;
  };

  return <SceneApiContext.Provider value={api}><EditSession.Provider value={sessionHandlers}>
    <div className="km-workshop km-scene" ref={shell} tabIndex={0} onPointerDown={event=>{if(!editable(event.target))shell.current?.focus({preventScroll:true})}}>
      <main className="workspace" inert={modalOpen||!!confirmation||!!lorePicker||undefined}>
        <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">Autosaves to this file</span></header>
        <div className="canvas-heading">
          <div><div className="eyebrow">KINGMAKER · SCENE · <code>{doc.id}</code></div><h1>{doc.title||doc.id}</h1></div>
          <button className="primary" onClick={()=>setDialog('add')}><Plus size={16}/>Add node<kbd>A</kbd></button>
        </div>
        <div className="toolbar">
          <div><button onClick={()=>{setTab('problems');setInspector(true)}} className={problems.length?'has-problems':''}>{campaign?`${problems.length} problem${problems.length===1?'':'s'}`:'Checking…'}</button></div>
          <div><button title="Undo (Ctrl Z)" disabled={!history.length} onClick={undo}><Undo2 size={16}/></button><button title="Redo (Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={16}/></button><button title="Fit graph (F)" onClick={fit}><Maximize size={16}/></button><button title="Toggle the inspector" onClick={()=>setInspector(!inspector)}><BookOpen size={16}/></button></div>
        </div>
        <div className="graph-canvas" ref={canvas}>
          <ReactFlow<FlowNode,FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:.16}} minZoom={.08} maxZoom={1.8} colorMode="system" deleteKeyCode={null} multiSelectionKeyCode="Shift" selectionOnDrag panOnDrag={[1,2]} panOnScroll zoomOnDoubleClick={false}
            onNodesChange={nodeChanges} onNodeDragStart={()=>{dragBefore.current=current.current;lastSession.current=null}}
            onNodeDragStop={()=>{const before=dragBefore.current;dragBefore.current=null;if(before&&before!==current.current){setHistory(old=>[...old.slice(-99),before]);setFuture([])}}}
            onNodeClick={(_,node)=>{if(connecting)connect(connecting,node.id);else{setSelected({kind:'node',id:node.id});setTab('selection');setInspector(true)}}}
            onNodeDoubleClick={(_,node)=>{setSelected({kind:'node',id:node.id});setTab('selection');setExpanded(true)}}
            onEdgeClick={(_,edge)=>{setSelected({kind:'connection',id:edge.id});setEditingRoute(null);setTab('selection');setInspector(true)}}
            onEdgeDoubleClick={(_,edge)=>{setSelected({kind:'connection',id:edge.id});setTab('selection');setExpanded(true)}}
            onPaneClick={()=>{setSelected(null);setMarked(new Set());setConnecting(null)}}
            onConnect={(connection:FlowConnection)=>{if(connection.source&&connection.target)connect(connection.source,connection.target)}}
            onPaneContextMenu={event=>{event.preventDefault();setDialog('add')}}>
            <Background gap={24} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={node=>COLORS[nodeKind((node.data as CardData).node)]}/>
          </ReactFlow>
          {connecting&&<div className="canvas-notice">Click the node the route goes to. <button onClick={()=>setConnecting(null)}>Cancel</button></div>}
        </div>
        <footer className="statusbar"><span>{doc.nodes.length} nodes · {connections.length} connections · {doc.edges.length} routes · {doc.cast.length} people</span><button onClick={()=>setDialog('help')}>Shortcuts <Keyboard size={13}/></button></footer>
      </main>
      {inspector&&<aside className="inspector scene-inspector" inert={modalOpen||!!confirmation||!!lorePicker||undefined}>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector">
          {tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} aria-label={count===undefined?label:`${label} (${count})`} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{count!==undefined&&<span className={`count${id==='problems'&&count?' bad':''}`}>{count}</span>}</button>)}
          <button title="Close the inspector" aria-label="Close the inspector" onClick={()=>setInspector(false)}><X size={14}/></button>
        </div>
        <div className="inspector-body" role="tabpanel" key={`${tab}:${tab==='selection'&&selected?selected.id:''}`}>{body()}</div>
      </aside>}
      {modalOpen&&<EditorModal label={selectedNode?'Edit node':'Edit transitions'} title={selectedNode?`Edit ${selectedNode.data.title||selectedNode.id}`:'Edit routes'} onClose={()=>{setExpanded(false);shell.current?.focus()}} suspended={!!dialog||!!confirmation||!!lorePicker}>
        <div className="editor-history"><button title="Undo (Ctrl Z)" disabled={!history.length} onClick={undo}><Undo2 size={15}/>Undo</button><button title="Redo (Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={15}/>Redo</button></div>
        <div className="inspector-body">{selectedNode?<NodeInspector node={selectedNode}/>:selectedConnection&&<ConnectionInspector connection={selectedConnection}/>}</div>
      </EditorModal>}
      {toast&&<div className="toast" role="status">{toast}</div>}
      {dialog==='add'&&<AddNodeDialog doc={doc} from={selectedNode&&!isEnding(selectedNode)?selectedNode:undefined} onAdd={add} onClose={()=>setDialog(null)}/>}
      {dialog==='help'&&<HelpDialog onClose={()=>setDialog(null)}/>}
      {lorePicker&&<LorePicker request={lorePicker} campaign={campaign} onOpen={openLore} onClose={()=>setLorePicker(null)}/>}
      {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} returnFocus={confirmFocus.current} fallbackFocus={shell.current} onConfirm={()=>{confirmation.onConfirm();setConfirmation(null)}} onCancel={()=>setConfirmation(null)}/>}
    </div>
  </EditSession.Provider></SceneApiContext.Provider>;
}

/** The campaign around the file, read now and again (shortly after) whenever another file of the vault changes. */
function useCampaign(host:SceneHost,setCampaign:(campaign:Campaign)=>void,setToast:(text:string)=>void){
  useEffect(()=>{
    let alive=true,request=0,timer:ReturnType<typeof setTimeout>|undefined;
    const load=()=>{const mine=++request;host.campaign().then(campaign=>{if(alive&&mine===request)setCampaign(campaign)}).catch(error=>{if(alive)setToast(`Couldn't read the campaign: ${error instanceof Error?error.message:String(error)}`)})};
    load();
    const unsubscribe=host.subscribe?.(()=>{clearTimeout(timer);timer=setTimeout(load,250)});
    return()=>{alive=false;clearTimeout(timer);unsubscribe?.()};
  },[host]);
}

/** A new node: what kind, its title, and its id (a slug of the title unless one's given). */
function AddNodeDialog({doc,from,onAdd,onClose}:{doc:SceneDocument;from?:SceneNode;onAdd:(kind:NewNodeKind,title:string,id:string)=>void;onClose:()=>void}){
  const [kind,setKind]=useState<NewNodeKind>('discovery'),[title,setTitle]=useState(''),[id,setId]=useState('');
  const options:[NewNodeKind,string,string][]=[
    ['discovery','Discovery','Something the player can come to understand, by any of its paths, in any order with the others.'],
    ['event','Event','A turn the scene takes (the dead-cart arrives): its new situation from then on, reached by a cue.'],
    ['ending','Ending','One of the only ways the scene can end: good, mixed or bad, and what it does to the story.'],
  ];
  const preview=uniqueId(slugOf(id)||slugOf(title)||kind,doc.nodes.map(node=>node.id));
  const titleId=useId(),idId=useId();
  const submit=()=>{if(title.trim())onAdd(kind,title.trim(),id.trim())};
  return <div className="modal-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="modal add-node" role="dialog" aria-label="Add a node">
      <header><h2>Add a node</h2><button title="Close dialog" onClick={onClose}><X size={19}/></button></header>
      <div className="add-options" role="radiogroup" aria-label="Kind">
        {options.map(([value,label,description])=><label key={value} className={`add-option ${value}${kind===value?' active':''}`}>
          <input type="radio" name={`${titleId}-kind`} value={value} checked={kind===value} onChange={()=>setKind(value)}/>
          <span><b>{label}</b><small>{description}</small></span>
        </label>)}
      </div>
      <div className="add-fields">
        <label className="field-label" htmlFor={titleId}>Title</label>
        <input id={titleId} autoFocus value={title} placeholder={kind==='discovery'?'Murder, not suicide':kind==='event'?'The dead-cart arrives':'Murder by persons unknown'} onChange={event=>setTitle(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')submit()}}/>
        <label className="field-label" htmlFor={idId}>Id</label>
        <input id={idId} value={id} placeholder={preview} onChange={event=>setId(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')submit()}}/>
        <small className="field-hint">The id is <code>{preview}</code>: game state keys on it, so it stays when the title changes.{from?` A route from “${from.data.title||from.id}” comes with it.`:''}</small>
      </div>
      <footer className="modal-footer"><span/><button className="primary" disabled={!title.trim()} onClick={submit}><Plus size={14}/>Add {kind}</button></footer>
    </section>
  </div>;
}

function HelpDialog({onClose}:{onClose:()=>void}){
  const keys=[['A','Add a node'],['Drag from a node\'s right edge','Draw a route'],['Click, then click','Select; with Add route to…, connect'],['Double-click','Open the larger editor'],['Shift + click','Select several nodes'],['Delete','Delete what\'s selected'],['Ctrl / ⌘ + Z','Undo'],['Ctrl / ⌘ + Shift + Z','Redo'],['F','Fit the graph'],['Scroll / middle drag','Pan'],['Ctrl + scroll','Zoom'],['Esc','Close a dialog or cancel a route']];
  return <div className="modal-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="modal" role="dialog" aria-label="Keyboard shortcuts"><header><h2>Keyboard shortcuts</h2><button title="Close dialog" onClick={onClose}><X size={19}/></button></header>
      <div className="shortcuts">{keys.map(([key,what])=><div key={key}><span>{what}</span><kbd>{key}</kbd></div>)}</div>
    </section>
  </div>;
}

/** The campaign's lore notes to link: by kind, searched, each opened in the host or picked. */
function LorePicker({request,campaign,onOpen,onClose}:{request:LoreRequest;campaign:Campaign|null;onOpen:(path:string)=>void;onClose:()=>void}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState<LoreKind|'all'>('all');
  const kinds:Array<LoreKind|'all'>=['all',...(request.kinds??['character','place','world','note'])];
  const notes=(campaign?.lore??[]).filter(note=>(!request.kinds||request.kinds.includes(note.kind))&&(kind==='all'||note.kind===kind)&&`${note.name} ${note.path}`.toLowerCase().includes(query.toLowerCase()));
  const labels:Record<string,string>={all:'All',character:'People',place:'Places',world:'World',note:'Other'};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose()}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true)},[onClose]);
  return <div className="modal-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="modal" role="dialog" aria-label="Lore library"><header><h2>{request.title}</h2><button title="Close dialog" onClick={onClose}><X size={19}/></button></header>
      <div className="search-box"><Search size={18}/><input autoFocus aria-label="Search lore" placeholder="Search the campaign's lore…" value={query} onChange={event=>setQuery(event.target.value)}/></div>
      {kinds.length>2&&<div className="filter-tabs">{kinds.map(value=><button key={value} className={kind===value?'active':''} onClick={()=>setKind(value)}>{labels[value]}</button>)}</div>}
      <div className="lore-results">
        {!campaign&&<p className="muted">Reading the campaign's lore…</p>}
        {campaign&&!notes.length&&<p className="muted">No notes in the campaign's lore/ match.</p>}
        {notes.map(note=>{const linked=request.linked.includes(note.path);return <div className="lore-result" key={note.path} data-lore={note.path}>
          <div className={`avatar ${note.kind}`}><BookOpen size={15}/></div>
          <div><b>{note.name}</b><p>{note.path}</p></div>
          <button title={`Open ${note.name}`} aria-label={`Open ${note.path}`} onClick={()=>onOpen(note.path)}>Open</button>
          <button className={linked?'attached':'primary'} disabled={linked} aria-label={linked?`${note.path} is linked`:`Link ${note.path}`} onClick={()=>{request.onPick(note.path);onClose()}}>{linked?'Linked':'Link'}</button>
        </div>})}
      </div>
      <footer className="modal-footer"><span>Paths are the game's: under the campaign's lore/.</span><button onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}


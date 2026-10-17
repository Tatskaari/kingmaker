import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ReactFlow,ReactFlowProvider,Background,Controls,MiniMap,Handle,Position,useReactFlow,MarkerType} from '@xyflow/react';
import type {NodeProps,Connection,NodeChange} from '@xyflow/react';
import {BookOpen,Boxes,Plus,Search,Map,GitBranch,ArrowUpRight,Undo2,Redo2,X,Check,Users,Diamond,Maximize,Trash2,Copy,Link,Keyboard,LogIn} from 'lucide-react';
import {uid,removeNodes,serializeDocument,connectionId,groupConnections,entryPorts,withDestination} from './model';
import type {CardNode,CardData,GraphDocument,Host,Kind,Lore,Route,FileEntry,ConnectionGroup,ContentFile} from './model';
import {ConnectionEdge} from './ConnectionEdge';
import {EditorModal} from './EditorModal';
import {ConfirmDialog} from './ConfirmDialog';
import {ScenarioEditor} from './ScenarioEditor';
import {MapEditor} from './MapEditor';
import '@xyflow/react/dist/style.css';
import './styles.css';

const icons={scene:BookOpen,map:Map,beat:GitBranch,start:LogIn,exit:Diamond};
function StoryNode({data,selected}:NodeProps<CardNode>){const Icon=icons[data.kind];return <article className={`story-card ${data.kind} ${selected?'chosen':''}`}>{data.kind!=='start'&&<Handle type="target" position={Position.Left}/>}<div className="card-kind"><Icon size={13}/>{data.kind}<span>{data.file?'↗':''}</span></div><h3>{data.title}</h3><p>{data.description}</p>{data.kind==='exit'&&<div className="exit-destination"><span>Leads to</span><strong><ArrowUpRight size={14}/>{typeof data.next==='string'&&data.next.trim()?data.next:data.file||'No destination set'}</strong>{data.entry&&<small>Input: {data.entry}</small>}{!data.file&&<small>{data.next?'No destination file linked':'Choose a destination in the editor'}</small>}</div>}<footer>{data.kind==='start'?'Scenario input port':data.file?'Enter to open linked file':data.lore.length?`${data.lore.length} linked notes`:data.kind==='exit'?'Scenario output port':'Story beat'}<span>→</span></footer>{data.kind!=='exit'&&<Handle type="source" position={Position.Right}/>}</article>}
const nodeTypes={story:StoryNode};
const edgeTypes={connection:ConnectionEdge};
const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
type Dialog='add'|'lore'|'scenes'|'destinations'|'help'|null;
type Picked={kind:'node'|'edge';id:string}|null;
type DestructiveAction={kind:'nodes';ids:string[]}|{kind:'routes';ids:string[]}|{kind:'lore';path:string;nodeId:string|null}|{kind:'destination';exitId:string;target?:ContentFile;entry:string};
type Confirmation={title:string;description:string;confirmLabel:string;action:DestructiveAction};
const counted=(count:number,noun:string)=>`${count} ${noun}${count===1?'':'s'}`;
const renderGraph=(document:GraphDocument,host:Host)=><ReactFlowProvider><Editor initial={document} host={host}/></ReactFlowProvider>;
export function App({document,host}:{document:GraphDocument;host:Host}){return document.kind==='scenario'?<ScenarioEditor document={document} host={host}/>:document.kind==='map'?<MapEditor document={document} host={host}/>:renderGraph(document,host)}
function Editor({initial,host}:{initial:GraphDocument;host:Host}){
  const [graph,setGraph]=useState(initial),current=useRef(initial);
  const [history,setHistory]=useState<GraphDocument[]>([]),[future,setFuture]=useState<GraphDocument[]>([]);
  const [picked,setPicked]=useState<Picked>(null),[selectedIds,setSelectedIds]=useState<Set<string>>(new Set());
  // React Flow needs measured dimensions across controlled rerenders. Keep them out of saved files and undo history.
  const [measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  const [dialog,setDialog]=useState<Dialog>(null),[query,setQuery]=useState(''),[lore,setLore]=useState<Lore[]>([]),[scenes,setScenes]=useState<FileEntry[]>([]);
  const [documents,setDocuments]=useState<ContentFile[]>([]),[documentError,setDocumentError]=useState('');
  const [loreKind,setLoreKind]=useState('all'),[loreTarget,setLoreTarget]=useState<string|null>(null),[connecting,setConnecting]=useState<string|null>(null);
  const [toast,setToast]=useState(''),[busy,setBusy]=useState(false),[inspector,setInspector]=useState(true),[routeMode,setRouteMode]=useState<'all'|'selected'>('all');
  const [expanded,setExpanded]=useState(false),[editingWay,setEditingWay]=useState<string|null>(null);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const confirmationFocus=useRef<HTMLElement|null>(null);
  const shell=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),pointer=useRef<{x:number;y:number}|null>(null);
  const dragBefore=useRef<GraphDocument|null>(null),editSession=useRef<string|null>(null),lastEdit=useRef<string|null>(null);
  const flow=useReactFlow<CardNode,ConnectionGroup>();
  const selectedNode=picked?.kind==='node'?graph.nodes.find(n=>n.id===picked.id):undefined;
  const connections=useMemo(()=>groupConnections(graph.edges),[graph.edges]);
  const selectedConnection=picked?.kind==='edge'?connections.find(e=>e.id===picked.id):undefined;
  const modalOpen=expanded&&!!(selectedNode||selectedConnection);
  useEffect(()=>{let alive=true;host.lore().then(notes=>{if(alive)setLore(notes)}).catch(()=>{if(alive)setToast('Could not read lore notes')});return()=>{alive=false}},[host]);
  useEffect(()=>{let alive=true,request=0;const refresh=()=>{const version=++request;if(host.listDocuments)void host.listDocuments().then(files=>{if(alive&&version===request){setDocuments(files);setDocumentError('')}}).catch(error=>{if(alive&&version===request)setDocumentError(String(error))})};refresh();const unsubscribe=host.subscribeDocuments?.(refresh);return()=>{alive=false;unsubscribe?.()}},[host]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t)},[toast]);
  useEffect(()=>{if(!editingWay)return;const element=Array.from(shell.current?.querySelectorAll<HTMLElement>('.transition-way')??[]).find(e=>e.dataset.routeId===editingWay);element?.scrollIntoView({block:'nearest'})},[editingWay,modalOpen]);
  const publish=(next:GraphDocument)=>{current.current=next;setGraph(next);host.change(next)};
  const commit=(next:GraphDocument,coalesce=false)=>{
    const before=current.current;if(serializeDocument(next)===serializeDocument(before))return;
    if(!coalesce||!editSession.current||lastEdit.current!==editSession.current)setHistory(h=>[...h.slice(-99),before]);
    lastEdit.current=coalesce?editSession.current:null;setFuture([]);publish(next);
  };
  const restore=(next:GraphDocument)=>{
    publish(next);
    setPicked(old=>old&&(old.kind==='node'?next.nodes.some(n=>n.id===old.id):groupConnections(next.edges).some(c=>c.id===old.id))?old:null);
    setSelectedIds(old=>new Set([...old].filter(id=>next.nodes.some(n=>n.id===id))));
  };
  const undo=()=>{const prev=history.at(-1);if(!prev)return;const now=current.current;lastEdit.current=null;setHistory(history.slice(0,-1));setFuture(f=>[now,...f]);restore(prev)};
  const redo=()=>{if(!future[0])return;const now=current.current;lastEdit.current=null;setHistory(h=>[...h,now]);restore(future[0]);setFuture(future.slice(1))};
  const fit=()=>void flow.fitView({padding:.16,duration:200});
  const openFile=(path:string)=>void host.openFile(path).catch(e=>setToast(e instanceof Error?e.message:'Could not open file'));
  const openDialog=(which:Dialog)=>{setQuery('');setDialog(which);if(which==='scenes')void host.listScenes().then(setScenes).catch(()=>setToast('Could not list scene files'))};
  const addLore=(nodeId:string|null=null)=>{setLoreTarget(nodeId);setLoreKind('all');openDialog('lore');void host.lore().then(setLore).catch(()=>setToast('Could not refresh lore'))};
  const changeData=(patch:Partial<CardData>)=>{if(selectedNode)commit({...graph,nodes:graph.nodes.map(n=>n.id===selectedNode.id?{...n,data:{...n.data,...patch}}:n)},true)};
  const changeRoute=(id:string,patch:Partial<NonNullable<Route['data']>>)=>{const base=current.current;commit({...base,edges:base.edges.map(e=>e.id===id?{...e,data:{...e.data!,...patch}}:e)},true)};
  const newRoute=(source:string,target:string):Route=>({id:uid(),source,target,type:'smoothstep',label:'New transition',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  const addNode=(kind:Kind,file?:FileEntry)=>{
    const base=current.current,selected=base.nodes.find(n=>n.id===selectedNode?.id),id=uid(),bounds=canvas.current?.getBoundingClientRect();
    const position=selected?{x:selected.position.x+360,y:selected.position.y+70}:flow.screenToFlowPosition(pointer.current??{x:(bounds?.x??0)+(bounds?.width??600)/2-120,y:(bounds?.y??0)+(bounds?.height??400)/2-80});
    const n:CardNode={id,type:'story',position,data:{kind,title:file?.title??`Untitled ${kind}`,description:'',lore:[],...(file?{file:file.path}:{})}};
    commit({...base,nodes:[...base.nodes,n],edges:selected&&selected.data.kind!=='exit'&&kind!=='start'?[...base.edges,newRoute(selected.id,id)]:base.edges});setPicked({kind:'node',id});setSelectedIds(new Set([id]));setDialog(null);setInspector(true);shell.current?.focus();
  };
  const createScene=async()=>{setBusy(true);try{const file=await host.createScene();if(file)addNode('scene',file)}catch(e){setToast(String(e))}finally{setBusy(false)}};
  const selectConnection=(id:string)=>{setPicked({kind:'edge',id});setSelectedIds(new Set());setEditingWay(null);setInspector(true)};
  const connect=(c:Connection)=>{
    if(!c.source||!c.target)return;
    const base=current.current,existing=base.edges.some(e=>e.source===c.source&&e.target===c.target);
    if(base.nodes.find(n=>n.id===c.source)?.data.kind==='exit'||base.nodes.find(n=>n.id===c.target)?.data.kind==='start'){setToast('Starts lead into the scene. Exits lead to another scene or map; choose their destination in the editor.');setConnecting(null);return}
    selectConnection(connectionId(c.source,c.target));setConnecting(null);
    if(existing){setToast('These nodes already have transitions. Use Add transition for another condition.');return}
    const edge=newRoute(c.source,c.target);commit({...base,edges:[...base.edges,edge]});setEditingWay(edge.id);
  };
  const addWay=()=>{if(!selectedConnection)return;const edge=newRoute(selectedConnection.source,selectedConnection.target);commit({...current.current,edges:[...current.current.edges,edge]});setEditingWay(edge.id)};
  const askConfirmation=(request:Confirmation)=>{
    // Capture the trigger before the background becomes inert and the browser blurs it.
    confirmationFocus.current=(shell.current?.ownerDocument.activeElement as HTMLElement|null)??null;
    setConfirmation(request);
  };
  const removeWay=(id:string)=>{
    const base=current.current,way=base.edges.find(e=>e.id===id);if(!way)return;
    const last=!base.edges.some(e=>e.id!==id&&e.source===way.source&&e.target===way.target);
    askConfirmation({title:'Remove transition?',confirmLabel:'Remove transition',description:`Are you sure you want to remove “${String(way.label||'Untitled transition')}”? ${last?'This is the last transition between these nodes, so the graph edge will also be removed.':'Other transitions between these nodes will be kept.'} You can undo this.`,action:{kind:'routes',ids:[id]}});
  };
  const changeEndpoint=(side:'source'|'target',value:string)=>{
    if(!selectedConnection||selectedConnection[side]===value)return;
    const kind=current.current.nodes.find(node=>node.id===value)?.data.kind;
    if(side==='source'&&kind==='exit'||side==='target'&&kind==='start'){setToast('Starts have outgoing transitions; exits have incoming transitions.');return}
    const ids=new Set(selectedConnection.data!.routes.map(r=>r.id));
    commit({...current.current,edges:current.current.edges.map(e=>ids.has(e.id)?{...e,[side]:value}:e)});
    setPicked({kind:'edge',id:connectionId(side==='source'?value:selectedConnection.source,side==='target'?value:selectedConnection.target)});
  };
  const deleteSelection=()=>{
    const base=current.current;
    if(selectedConnection){
      const routes=base.edges.filter(e=>connectionId(e.source,e.target)===selectedConnection.id);if(!routes.length)return;
      const from=base.nodes.find(n=>n.id===selectedConnection.source)?.data.title??selectedConnection.source,to=base.nodes.find(n=>n.id===selectedConnection.target)?.data.title??selectedConnection.target;
      askConfirmation({title:'Delete transitions?',confirmLabel:'Delete transitions',description:`Are you sure you want to delete all ${counted(routes.length,'transition')} from “${from}” to “${to}”? The graph edge will be removed; both nodes will be kept. You can undo this.`,action:{kind:'routes',ids:routes.map(r=>r.id)}});
    }else{
      const ids=new Set(selectedIds);if(selectedNode)ids.add(selectedNode.id);
      const nodes=base.nodes.filter(n=>ids.has(n.id));if(!nodes.length)return;
      const incident=base.edges.filter(e=>ids.has(e.source)||ids.has(e.target)),connections=groupConnections(incident);
      const label=nodes.length===1?'Delete node':`Delete ${nodes.length} nodes`,target=nodes.length===1?`“${nodes[0].data.title}”`:`these ${nodes.length} selected nodes`;
      askConfirmation({title:`${label}?`,confirmLabel:label,description:`Are you sure you want to delete ${target}?${incident.length?` This also removes ${counted(incident.length,'transition')} across ${counted(connections.length,'graph edge')}.`:''}${nodes.some(n=>n.data.kind==='start'||n.data.start===true)?' Other files targeting this input will need rewiring.':''} Linked lore notes and scene files will not be deleted. You can undo this.`,action:{kind:'nodes',ids:nodes.map(n=>n.id)}});
    }
  };
  const unlinkLore=(path:string,name:string)=>askConfirmation({title:'Unlink lore?',confirmLabel:'Unlink',description:`Are you sure you want to unlink “${name}” from ${selectedNode?`“${selectedNode.data.title}”`:'this file'}? The original note will not be deleted, and other links to it will be kept. You can undo this.`,action:{kind:'lore',path,nodeId:selectedNode?.id??null}});
  const chooseDestination=(target:ContentFile|undefined,entry='')=>{
    if(!selectedNode||selectedNode.data.kind!=='exit')return;
    const exitId=selectedNode.id;let next:GraphDocument;
    try{next=withDestination(current.current,exitId,target,entry)}catch(error){setToast(String(error));return}
    setDialog(null);
    if(serializeDocument(next)===serializeDocument(current.current))return;
    if(selectedNode.data.next||selectedNode.data.file)askConfirmation({title:target?'Change destination?':'Clear destination?',confirmLabel:target?'Change destination':'Clear destination',description:`${target?`Redirect “${selectedNode.data.title}” to “${target.document!.title}” at “${entryPorts(target.document!).find(port=>port.id===entry)?.title}”?`:`Remove the destination of “${selectedNode.data.title}”?`} This changes the scenario wiring. No files will be deleted. You can undo this.`,action:{kind:'destination',exitId,target,entry}});
    else commit(next);
  };
  const confirmDestruction=()=>{
    if(!confirmation)return;
    const base=current.current,action=confirmation.action;let next:GraphDocument;
    if(action.kind==='nodes')next=removeNodes(base,new Set(action.ids));
    else if(action.kind==='routes'){const ids=new Set(action.ids);next={...base,edges:base.edges.filter(e=>!ids.has(e.id))}}
    else if(action.kind==='destination'){
      const target=action.target?.path===host.filePath?{path:host.filePath,document:base}:action.target?documents.find(file=>file.path===action.target!.path):undefined;
      try{if(action.target&&!target)throw Error('The destination file is no longer available.');next=withDestination(base,action.exitId,target,action.entry)}catch(error){setToast(String(error));setConfirmation(null);return}
    }
    else next=action.nodeId?{...base,nodes:base.nodes.map(n=>n.id===action.nodeId?{...n,data:{...n.data,lore:n.data.lore.filter(path=>path!==action.path)}}:n)}:{...base,lore:base.lore.filter(path=>path!==action.path)};
    commit(next);setConfirmation(null);
    if(action.kind==='nodes'){
      setPicked(null);setSelectedIds(new Set());setExpanded(false);
      if(connecting&&action.ids.includes(connecting))setConnecting(null);
    }else if(action.kind==='routes'){
      setEditingWay(null);
      if(selectedConnection&&!next.edges.some(e=>connectionId(e.source,e.target)===selectedConnection.id)){setPicked(null);setExpanded(false)}
    }
  };
  const duplicate=()=>{if(!selectedNode)return;const n={...structuredClone(selectedNode),id:uid(),position:{x:selectedNode.position.x+45,y:selectedNode.position.y+180},data:{...selectedNode.data,title:`${selectedNode.data.title} (copy)`}};commit({...graph,nodes:[...graph.nodes,n]});setPicked({kind:'node',id:n.id});setSelectedIds(new Set([n.id]))};
  const nodeChanges=(changes:NodeChange<CardNode>[])=>{
    const dimensions=changes.filter(c=>c.type==='dimensions');if(dimensions.length)setMeasurements(old=>{const next={...old};for(const c of dimensions)if(c.type==='dimensions'&&c.dimensions)next[c.id]=c.dimensions;return next});
    const selections=changes.filter(c=>c.type==='select');if(selections.length)setSelectedIds(old=>{const next=new Set(old);for(const c of selections)if(c.type==='select'){c.selected?next.add(c.id):next.delete(c.id)}return next});
    const positions=changes.filter(c=>c.type==='position');if(positions.length){const next={...current.current,nodes:current.current.nodes.map(n=>{const c=positions.find(c=>c.id===n.id);return c?.type==='position'&&c.position?{...n,position:c.position}:n})};if(dragBefore.current)publish(next);else commit(next)}
  };
  useEffect(()=>{const el=shell.current;if(!el)return;const key=(e:KeyboardEvent)=>{
    if(confirmation)return;
    if(e.key==='Escape'){if(dialog)setDialog(null);else if(modalOpen)setExpanded(false);else setConnecting(null);shell.current?.focus();return}if(editable(e.target)||dialog)return;
    const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();let handled=true;
    // Modal buttons keep their native Enter/Space behaviour; graph shortcuts stay on the canvas.
    if(modalOpen&&!(mod&&(k==='z'||k==='y')))return;
    if(e.key==='Enter'&&e.target instanceof Element&&e.target.closest('button,a'))return;
    if(mod&&k==='z')e.shiftKey?redo():undo();else if(mod&&k==='y')redo();else if(mod&&k==='d')duplicate();else if(k==='a'&&!mod)openDialog('add');else if(e.key==='Delete'||e.key==='Backspace')deleteSelection();else if(k==='f'&&!mod)fit();else if(e.key==='Enter'&&selectedNode?.data.file)openFile(selectedNode.data.file);else if(e.key==='?')openDialog('help');else handled=false;
    if(handled){e.preventDefault();e.stopPropagation()}
  };el.addEventListener('keydown',key);return()=>el.removeEventListener('keydown',key)});
  const attach=(entry:Lore)=>{const unique=(list:string[])=>Array.from(new Set([...list,entry.path]));commit({...graph,lore:unique(graph.lore),nodes:graph.nodes.map(n=>n.id===loreTarget?{...n,data:{...n.data,lore:unique(n.data.lore)}}:n)})};
  const sources=selectedNode?.data.lore??graph.lore;
  const editing={onFocus:()=>{editSession.current=uid()},onBlur:()=>{editSession.current=null}};
  const field=(label:string,value:string,onChange:(v:string)=>void,multi=false)=><label className="field">{label}{multi?<textarea {...editing} value={value} onChange={e=>onChange(e.target.value)}/>:<input {...editing} value={value} onChange={e=>onChange(e.target.value)}/>}</label>;
  const visibleEdges=useMemo(()=>connections.filter(e=>routeMode==='all'||!selectedNode||e.source===selectedNode.id||e.target===selectedNode.id),[connections,routeMode,selectedNode?.id]);
  const edges=useMemo(()=>visibleEdges.map(e=>({...e,selected:picked?.kind==='edge'&&picked.id===e.id,ariaLabel:`${graph.nodes.find(n=>n.id===e.source)?.data.title} to ${graph.nodes.find(n=>n.id===e.target)?.data.title}: ${e.label}`,markerEnd:{type:MarkerType.ArrowClosed,color:'#91859d'},style:{strokeWidth:picked?.id===e.id?2.5:1.5},labelStyle:{fill:'var(--text-normal, #ddd)',fontSize:11},labelBgStyle:{fill:'var(--background-primary, #24212b)'},labelBgPadding:[7,5] as [number,number],labelBgBorderRadius:4})),[visibleEdges,picked,graph.nodes]);
  // React Flow preserves freshly measured handle bounds by user-node identity.
  // A lore/catalog response must not replace unmeasured nodes during that handshake.
  const nodes=useMemo(()=>graph.nodes.map(n=>({...n,measured:measurements[n.id],selected:selectedIds.has(n.id)||picked?.kind==='node'&&picked.id===n.id})),[graph.nodes,measurements,selectedIds,picked]);
  const addOptions:([Kind,string,string])[]=[['start','Start','A named input port for entering this file'],...(graph.kind==='map'?[]:[['beat','Beat','A situation the player can change'] as [Kind,string,string]]),['exit','Exit',graph.kind==='map'?'A named output port leading to another scene or map':'An outcome that leads out of the scene']];
  const routes=connections.filter(e=>!selectedNode||e.source===selectedNode.id||e.target===selectedNode.id);
  const loreEditor=()=>!selectedConnection&&<>
    <div className="subheading">{selectedNode?'LINKED LORE':'CAST & OBJECTS'}</div>
    {sources.map(path=>{const entry=lore.find(l=>l.path===path),name=entry?.name??path.split('/').at(-1)??path;return <div className="lore-link" key={path}><div className={`avatar ${entry?.kind??'note'}`}><BookOpen size={14}/></div><button title={`Open ${name}`} onClick={()=>openFile(path)}><b>{name}</b><small>{path}</small></button><button title={`Unlink ${name}`} onClick={()=>unlinkLore(path,name)}><X size={13}/></button></div>})}
    <button className="add-lore" onClick={()=>addLore(selectedNode?.id??null)}><Plus size={14}/>Add from lore</button>
  </>;
  const nodeEditor=()=>selectedNode&&<>
    {field('Name',selectedNode.data.title,v=>changeData({title:v}))}{field('Direction',selectedNode.data.description,v=>changeData({description:v}),true)}
    {['scene','map'].includes(selectedNode.data.kind)&&<>{field(selectedNode.data.kind==='scene'?'Scene file':'Place or map file',selectedNode.data.file??'',v=>changeData({file:v||undefined}))}{selectedNode.data.file&&<button className="wide-button" onClick={()=>openFile(selectedNode.data.file!)}>Open linked file <ArrowUpRight size={14}/></button>}</>}
    {selectedNode.data.kind==='map'&&<p className="info-box">This is a scenario map step. A spatial map editor is not part of this prototype.</p>}
    {selectedNode.data.kind==='exit'&&<section className="exit-destination-editor"><div className="subheading">DESTINATION</div>
      <button className="wide-button" onClick={()=>openDialog('destinations')}>Choose scene or map input <ArrowUpRight size={14}/></button>
      {field('Destination ID',typeof selectedNode.data.next==='string'?selectedNode.data.next:'',v=>changeData({next:v||undefined}))}
      <p className="muted">Where this exit leads after the scene ends. Keep the authored scene or interlude ID here.</p>
      {field('Destination file (optional)',selectedNode.data.file??'',v=>changeData({file:v||undefined,entry:undefined}))}
      {selectedNode.data.file&&<label className="field">Destination input<select value={selectedNode.data.entry??''} onChange={event=>{const target=documents.find(file=>file.path===selectedNode.data.file);if(target&&event.target.value)chooseDestination(target,event.target.value)}}><option value="">Choose a named start</option>{entryPorts(documents.find(file=>file.path===selectedNode.data.file)?.document??{...graph,nodes:[]}).map(port=><option key={port.id} value={port.id}>{port.title}</option>)}</select></label>}
      {selectedNode.data.file?<button className="wide-button" onClick={()=>openFile(selectedNode.data.file!)}>Open destination file <ArrowUpRight size={14}/></button>:<p className="info-box">{selectedNode.data.next?<>This exit leads to <strong>{String(selectedNode.data.next)}</strong>, but no destination file is linked. Add its vault-relative path when it exists.</>:'No destination set. Enter a destination ID or link a file to show where this exit leads.'}</p>}
    </section>}
    {selectedNode.data.kind==='start'&&<p className="info-box">{graph.kind==='map'?(selectedNode.data.mapAt?`This spawn point appears as a map input on the scenario card. Tile: ${selectedNode.data.mapAt.x}, ${selectedNode.data.mapAt.y}.`:'This legacy named input has no tile position. Use Paint → right-click a tile → Add spawn point to create a spatial input.'):'This named start appears as an input on the scenario card. Connect it to the first beat to play when entering here.'}</p>}
    {selectedNode.data.mapFeature==='interaction'&&<p className="info-box">Tile interaction at {selectedNode.data.mapAt?.x}, {selectedNode.data.mapAt?.y}. {selectedNode.data.exitPort?`Scenario output: ${selectedNode.data.exitPort}.`:'No scenario output.'} Edit its message and exit-port name from its marker in Paint.</p>}
    {selectedNode.data.kind!=='start'&&selectedNode.data.start===true&&<p className="info-box">This imported opening beat is also exposed as the original scenario input. New start nodes add other named inputs without removing this one.</p>}
    <div className="inspector-actions"><button onClick={()=>{if(selectedNode.data.kind==='exit')openDialog('destinations');else{setExpanded(false);setConnecting(selectedNode.id)}}}><Link size={14}/>{selectedNode.data.kind==='exit'?'Choose destination…':'Add transition to…'}</button><button title="Duplicate node" onClick={duplicate}><Copy size={14}/></button><button title="Delete node" onClick={deleteSelection}><Trash2 size={14}/></button></div>
    {loreEditor()}
  </>;
  const connectionEditor=()=>selectedConnection&&<>
    <div className="route-path"><strong>{graph.nodes.find(n=>n.id===selectedConnection.source)?.data.title} → {graph.nodes.find(n=>n.id===selectedConnection.target)?.data.title}</strong></div>
    <p className="connection-summary">{counted(selectedConnection.data!.routes.length,'transition')} between these nodes. Each has its own conditions for reaching the destination.</p>
    <details className="connection-endpoints"><summary>Change transition endpoints</summary><p className="muted">Changes apply to every transition shown here.</p>
      {(['source','target'] as const).map(side=><label className="field" key={side}>{side==='source'?'From node':'To node'}<select value={selectedConnection[side]} onChange={event=>changeEndpoint(side,event.target.value)}>{graph.nodes.filter(n=>side==='source'?n.data.kind!=='exit':n.data.kind!=='start').map(n=><option key={n.id} value={n.id}>{n.data.title}</option>)}</select></label>)}
    </details>
    <div className="transition-ways">{selectedConnection.data!.routes.map((way,index)=><article className="transition-way" key={way.id} data-route-id={way.id}>
      <header><span className="way-number">{index+1}</span><h3>{String(way.label)||'Untitled transition'}</h3><button aria-expanded={editingWay===way.id} onClick={()=>setEditingWay(editingWay===way.id?null:way.id)}>{editingWay===way.id?'Done editing':'Edit transition'}</button></header>
      <div className="way-badges"><span>{({attempt:'Player attempt',outcome:'Outcome',cue:'Pacing cue',navigation:'Navigation'} as Record<string,string>)[way.data!.phase]??way.data!.phase}</span>{way.data?.skill&&<span>{way.data.skill} · DC {way.data.dc}</span>}{['success','failure'].includes(String(way.data?.branch))&&<span>{way.data!.branch==='success'?'On success':'On failure'}</span>}{way.data?.scope==='anytime'&&<span>Anytime</span>}</div>
      {editingWay===way.id?<div className="way-fields">
        {field('Transition label',String(way.label??''),v=>commit({...current.current,edges:current.current.edges.map(e=>e.id===way.id?{...e,label:v}:e)},true))}
        {field('When can this happen?',way.data?.condition??'',v=>changeRoute(way.id,{condition:v}),true)}
        <label className="field">Evaluate<select value={way.data?.phase} onChange={e=>changeRoute(way.id,{phase:e.target.value})}><option value="attempt">Player attempt</option><option value="outcome">Outcome</option><option value="cue">Pacing cue</option><option value="navigation">Scenario navigation</option></select></label>
        <div className="field-row">{field('Skill check',way.data?.skill??'',v=>changeRoute(way.id,{skill:v}))}<label className="field">DC<input {...editing} type="number" min="0" max="100" value={way.data?.dc??12} onChange={e=>changeRoute(way.id,{dc:Number(e.target.value)})}/></label></div>
        {typeof way.data?.outcomeText==='string'&&field('Outcome',way.data.outcomeText,v=>changeRoute(way.id,{outcomeText:v}),true)}
        <button className="text-button danger" onClick={()=>removeWay(way.id)}><Trash2 size={13}/>Remove transition</button>
      </div>:<><p className="way-condition">{way.data?.condition||'No condition yet. Edit this transition to describe when it applies.'}</p>{!!way.data?.outcomeText&&<details className="way-outcome"><summary>Outcome</summary><p>{String(way.data.outcomeText)}</p></details>}</>}
    </article>)}</div>
    <div className="connection-actions"><button className="wide-button" onClick={addWay}><Plus size={14}/>Add transition</button><button className="text-button danger" onClick={deleteSelection}><Trash2 size={14}/>Delete transitions</button><small>Deletes every transition between these nodes. Undo restores them.</small></div>
  </>;
  return <div className="km-workshop" ref={shell} tabIndex={0} onPointerDown={e=>{if(!editable(e.target))shell.current?.focus({preventScroll:true})}}>
    <main className="workspace" inert={modalOpen||!!confirmation||undefined}>
      <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">Autosaves to this file</span></header>
      <div className="canvas-heading"><div><div className="eyebrow">KINGMAKER · {graph.kind==='map'?'MAP PORTS · FLOW PROTOTYPE':graph.kind.toUpperCase()}</div><h1>{graph.title}</h1>{graph.kind==='map'&&<p className="muted">Named inputs and outputs only. Spawn positions, doors and trigger volumes are future work.</p>}</div><button className="primary" onClick={()=>openDialog('add')}><Plus size={16}/>Add node<kbd>A</kbd></button></div>
      <div className="toolbar"><div><button onClick={()=>addLore()}><Users size={14}/>Cast & objects <small>{graph.lore.length}</small></button><button title="Toggle transition focus" onClick={()=>setRouteMode(routeMode==='all'?'selected':'all')}>{routeMode==='all'?'All transitions':'Focus transitions'}</button></div><div><button title="Undo (Ctrl Z)" disabled={!history.length} onClick={undo}><Undo2 size={16}/></button><button title="Redo (Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={16}/></button><button title="Fit graph (F)" onClick={fit}><Maximize size={16}/></button><button title="Toggle details" onClick={()=>setInspector(!inspector)}><BookOpen size={16}/></button></div></div>
      <div className="graph-canvas" ref={canvas} onPointerMove={e=>{pointer.current={x:e.clientX,y:e.clientY}}}>
        <ReactFlow<CardNode,ConnectionGroup> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:.16}} minZoom={.08} maxZoom={1.8} colorMode="system" deleteKeyCode={null} multiSelectionKeyCode="Shift" selectionOnDrag panOnDrag={[1,2]} panOnScroll zoomOnDoubleClick={false}
          onNodesChange={nodeChanges} onNodeDragStart={()=>{dragBefore.current=current.current;lastEdit.current=null}} onNodeDragStop={()=>{const before=dragBefore.current;dragBefore.current=null;if(before&&serializeDocument(before)!==serializeDocument(current.current)){setHistory(h=>[...h.slice(-99),before]);setFuture([])}}}
          onNodeClick={(_,n)=>{if(connecting)connect({source:connecting,target:n.id,sourceHandle:null,targetHandle:null});else{setPicked({kind:'node',id:n.id});setInspector(true)}}} onNodeDoubleClick={(_,n)=>{setPicked({kind:'node',id:n.id});setExpanded(true)}} onEdgeClick={(_,e)=>selectConnection(e.id)} onEdgeDoubleClick={(_,e)=>{selectConnection(e.id);setExpanded(true)}} onPaneClick={()=>{setPicked(null);setSelectedIds(new Set())}} onConnect={connect} onPaneContextMenu={e=>{e.preventDefault();openDialog('add')}}>
          <Background gap={24} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={n=>n.data.kind==='map'?'#568b83':n.data.kind==='exit'?'#bd9766':'#8874ac'}/>
        </ReactFlow>
        {connecting&&<div className="canvas-notice">Click a destination node. <button onClick={()=>setConnecting(null)}>Cancel</button></div>}
        {!graph.nodes.length&&<div className="empty-canvas"><GitBranch size={32}/><h2>Start this {graph.kind}</h2><p>Add a node, then connect what happens next.</p><button className="primary" onClick={()=>openDialog('add')}>Add first node <kbd>A</kbd></button></div>}
      </div>
      <footer className="statusbar"><span>{graph.nodes.length} nodes · {connections.length} node pairs · {graph.edges.length} transitions</span><button onClick={()=>openDialog('help')}>Shortcuts <Keyboard size={13}/></button></footer>
    </main>
    {inspector&&<aside className={`inspector ${selectedConnection?'connection-inspector':''}`} inert={modalOpen||!!confirmation||undefined}><div className="inspector-head"><span>{selectedConnection?'TRANSITIONS':selectedNode?selectedNode.data.kind.toUpperCase():'FILE DETAILS'}</span><div>{(selectedNode||selectedConnection)&&<button title={`Open ${selectedNode?'node':'transitions'} in modal editor`} onClick={()=>setExpanded(true)}><Maximize size={15}/></button>}<button title="Clear selection" onClick={()=>{setPicked(null);setSelectedIds(new Set())}}><X size={16}/></button></div></div><div className="inspector-body">
      {modalOpen?<p className="muted">Editing in expanded view.</p>:selectedNode?nodeEditor():selectedConnection?connectionEditor():<>{field('Title',graph.title,v=>commit({...graph,title:v},true))}{field('Description',graph.description,v=>commit({...graph,description:v},true),true)}<p className="info-box">Click a node or transition to inspect it. Double-click to open a larger editor. Scene and map nodes have an Open linked file button.</p>{!!graph.source&&<p className="muted">Imported authoring copy. Edits save here; they are not published to the game engine.</p>}{loreEditor()}</>}
      <details className="route-list" open={!!selectedNode}><summary>Transitions ({routes.reduce((count,e)=>count+e.data!.routes.length,0)})</summary>{routes.map(e=><button className={picked?.id===e.id?'active':''} key={e.id} onClick={()=>selectConnection(e.id)}><b>{graph.nodes.find(n=>n.id===e.source)?.data.title} → {graph.nodes.find(n=>n.id===e.target)?.data.title}</b><small>{String(e.label)}</small></button>)}</details>
      <p className="inspector-tip">A adds a node. With a node selected, it connects automatically. Undo/redo stays with this open file.</p>
    </div></aside>}
    {modalOpen&&<EditorModal label={selectedNode?'Edit node':'Edit transitions'} title={selectedNode?`Edit ${selectedNode.data.title}`:'Edit transitions'} onClose={()=>{setExpanded(false);shell.current?.focus()}} suspended={!!dialog||!!confirmation}>
      <div className="editor-history"><button title="Undo (Ctrl Z)" disabled={!history.length} onClick={undo}><Undo2 size={15}/>Undo</button><button title="Redo (Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={15}/>Redo</button></div>
      <div className={selectedNode?'expanded-node-content':'expanded-connection-content'}>{selectedNode?nodeEditor():connectionEditor()}</div>
    </EditorModal>}
    {toast&&<div className="toast" role="status">{toast}</div>}
    {dialog&&<div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><section className="modal" role="dialog" aria-label={dialog==='add'?'Add to graph':dialog==='lore'?'Lore library':dialog==='scenes'?'Scene files':dialog==='destinations'?'Choose destination':'Keyboard shortcuts'}><header><h2>{dialog==='add'?'Add to the graph':dialog==='lore'?'Characters, objects & places':dialog==='scenes'?'Choose a scene file':dialog==='destinations'?'Choose scene or map input':'Keyboard shortcuts'}</h2><button title="Close dialog" onClick={()=>setDialog(null)}><X size={19}/></button></header>
      {dialog==='help'?<div className="shortcuts">{[['A','Add node menu'],['Drag socket','Connect two nodes'],['Double-click','Open larger editor'],['Enter','Open linked file'],['Shift + click','Select multiple nodes'],['Ctrl / ⌘ + D','Duplicate node'],['Delete','Delete selection'],['Ctrl / ⌘ + Z','Undo'],['Ctrl / ⌘ + Shift + Z','Redo'],['F','Fit graph'],['Scroll / middle drag','Pan canvas'],['Ctrl + scroll','Zoom'],['Esc','Close menu or cancel link']].map(([k,v])=><div key={k}><span>{v}</span><kbd>{k}</kbd></div>)}</div>:<>
        <div className="search-box"><Search size={18}/><input autoFocus aria-label="Search" placeholder={dialog==='lore'?'Search characters, objects, places…':dialog==='scenes'?'Search scene files…':'Search nodes and actions…'} value={query} onChange={e=>setQuery(e.target.value)}/></div>
        {dialog==='add'?<div className="add-options">{addOptions.filter(o=>o.join(' ').toLowerCase().includes(query.toLowerCase())).map(([kind,title,description])=><button key={kind} onClick={()=>kind==='scene'?openDialog('scenes'):addNode(kind)}><div className={`option-icon ${kind}`}>{React.createElement(icons[kind],{size:21})}</div><div><b>{title}</b><p>{description}</p></div><Plus size={16}/></button>)}{'character object lore'.includes(query.toLowerCase())&&<button onClick={()=>addLore(selectedNode?.id??null)}><div className="option-icon"><Users size={21}/></div><div><b>Character or object</b><p>Link a real Markdown note from this vault</p></div></button>}</div>:dialog==='destinations'?<>
          <p className="muted">Choose a named input. The destination is stored on this exit and also appears in the scenario graph.</p>
          {documentError&&<p role="alert">{documentError}</p>}
          <div className="lore-results">{documents.map(file=>file.path===host.filePath?{...file,document:graph}:file).filter(file=>file.document&&['scene','map'].includes(file.document.kind)&&(file.document.title+' '+file.path).toLowerCase().includes(query.toLowerCase())).map(file=><div className="destination-result" key={file.path}><b>{file.document!.title}</b><small>{file.document!.kind} · {file.path}</small>{entryPorts(file.document!).length?entryPorts(file.document!).map(port=><button className="wide-button" key={port.id} onClick={()=>chooseDestination(file,port.id)}><LogIn size={14}/>{port.title}{port.legacy?' (original opening)':''}</button>):<p className="muted">No start nodes yet. Open this file to add an input.</p>}</div>)}</div>
          <footer className="modal-footer"><span>Map spawn positions and triggers are future work.</span>{(selectedNode?.data.file||selectedNode?.data.next)&&<button className="danger" onClick={()=>chooseDestination(undefined)}>Clear destination</button>}</footer>
        </>:dialog==='scenes'?<><div className="lore-results">{scenes.filter(f=>(f.title+' '+f.path).toLowerCase().includes(query.toLowerCase())).map(f=><div className="lore-result" key={f.path}><div><b>{f.title}</b><p>{f.path}</p></div><button className="primary" onClick={()=>addNode('scene',f)}>Link scene</button></div>)}</div><footer className="modal-footer"><span>A scene is a separate file.</span><button disabled={busy} onClick={()=>void createScene()}>Create new scene file</button></footer></>:<>
          <div className="filter-tabs">{['all','character','object','place','note'].map(k=><button className={loreKind===k?'active':''} key={k} onClick={()=>setLoreKind(k)}>{k==='all'?'All':k+'s'}</button>)}</div>
          <div className="lore-results">{lore.filter(l=>(loreKind==='all'||l.kind===loreKind)&&(l.name+' '+l.path).toLowerCase().includes(query.toLowerCase())).map(l=>{const attached=(loreTarget?graph.nodes.find(n=>n.id===loreTarget)?.data.lore:graph.lore)?.includes(l.path);return <div className="lore-result" key={l.path}><div className={`avatar ${l.kind}`}><Boxes size={17}/></div><div><b>{l.name}</b><p>{l.path}</p></div><button title={`Open ${l.name}`} onClick={()=>openFile(l.path)}><ArrowUpRight size={16}/></button><button className={attached?'attached':'primary'} disabled={attached} onClick={()=>attach(l)}>{attached?<><Check size={14}/>Added</>:<><Plus size={14}/>Add</>}</button></div>})}</div><footer className="modal-footer"><span>Links point to the original notes in this vault.</span><button onClick={()=>setDialog(null)}>Done</button></footer>
        </>}
      </>}
    </section></div>}
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} returnFocus={confirmationFocus.current} fallbackFocus={shell.current} onConfirm={confirmDestruction} onCancel={()=>setConfirmation(null)}/>}
  </div>;
}

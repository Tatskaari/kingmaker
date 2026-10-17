import type {Node,Edge} from '@xyflow/react';
import {validateMap} from './map-model.ts';
import type {MapData} from './map-model';
export type Kind='scene'|'map'|'beat'|'start'|'exit';
export type Destination={file:string;entry:string};
export type ScenarioConfig={entry?:Destination;files?:string[];positions?:Record<string,{x:number;y:number}>};
export type CardData={title:string;description:string;kind:Kind;lore:string[];file?:string;next?:string;entry?:string;destinationKind?:'scene'|'map';exitKind?:string;mapFeature?:'spawn'|'interaction';mapAt?:{x:number;y:number};eventMessage?:string;exitPort?:string;script?:string;[key:string]:unknown};
export type CardNode=Node<CardData>;
export type Route=Edge<{condition:string;phase:string;skill:string;dc:number;[key:string]:unknown}>;
export type ConnectionGroup=Edge<{routes:Route[]}>;
// A connection is a directed pair. JSON encoding avoids delimiter collisions in ids.
export const connectionId=(source:string,target:string):string=>`connection:${JSON.stringify([source,target])}`;
export function groupConnections(routes:Route[]):ConnectionGroup[]{
  const groups=new Map<string,ConnectionGroup>();
  for(const route of routes){
    const id=connectionId(route.source,route.target);
    const existing=groups.get(id);
    if(existing){existing.data!.routes.push(route);existing.label=`${existing.data!.routes.length} transitions`}
    else groups.set(id,{id,source:route.source,target:route.target,type:'connection',label:'1 transition',data:{routes:[route]}});
  }
  return [...groups.values()];
}
export type GraphDocument={format:'kingmaker';version:1;kind:'scene'|'scenario'|'map';id:string;title:string;description:string;nodes:CardNode[];edges:Route[];lore:string[];scenario?:ScenarioConfig;terrain?:MapData;[key:string]:unknown};
export type FileEntry={path:string;title:string};
export type ContentFile={path:string;document?:GraphDocument;error?:string};
export type Host={filePath:string;change:(doc:GraphDocument)=>void;openFile:(path:string)=>Promise<void>;createScene:()=>Promise<FileEntry|null>;createMap?:()=>Promise<FileEntry|null>;listDocuments?:()=>Promise<ContentFile[]>;readDocument?:(path:string)=>Promise<GraphDocument>;writeDocument?:(path:string,before:GraphDocument,after:GraphDocument)=>Promise<void>;subscribeDocuments?:(listener:()=>void)=>()=>void};
export type EntryPort={id:string;title:string;legacy?:boolean};
/** Imported opening beats remain addressable when new starts are added, so existing links never silently move. */
export function entryPorts(doc:GraphDocument):EntryPort[]{
  const starts=doc.nodes.filter(node=>node.data.kind==='start');
  return [...starts.map(node=>({id:node.id,title:node.data.title})),...doc.nodes.filter(node=>node.data.kind!=='start'&&node.data.start===true).map(node=>({id:node.id,title:node.data.title,legacy:true}))];
}
export const exitPorts=(doc:GraphDocument):CardNode[]=>doc.nodes.filter(node=>node.data.kind==='exit').map(node=>node.data.mapFeature==='interaction'?{...node,data:{...node.data,title:node.data.exitPort||node.data.title}}:node);
/** Destination ownership stays on the exit, whether edited inside the scene or from its scenario overview. */
export function withDestination(doc:GraphDocument,exitId:string,target:ContentFile|undefined,entry:string):GraphDocument{
  if(!exitPorts(doc).some(node=>node.id===exitId))throw Error('This exit no longer exists. Refresh the file.');
  if(target&&(!target.document||!['scene','map'].includes(target.document.kind)||!entryPorts(target.document).some(port=>port.id===entry)))throw Error('Choose an existing scene or map start port.');
  return {...doc,nodes:doc.nodes.map(node=>{
    if(node.id!==exitId)return node;
    const {next:oldNext,file:oldFile,entry:oldEntry,destinationKind:oldKind,...data}=node.data;
    return {...node,data:target?{...data,next:target.document!.id,file:target.path,entry,destinationKind:target.document!.kind as 'scene'|'map'}:data};
  })};
}
export const uid=()=>crypto.randomUUID();
export function emptyDocument(kind:GraphDocument['kind'],title:string):GraphDocument{return {format:'kingmaker',version:1,kind,id:uid(),title,description:'',nodes:[],edges:[],lore:[]}}
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
export function parseDocument(raw:string,expectedKind?:GraphDocument['kind']):GraphDocument{
  const d=JSON.parse(raw);
  if(!d||d.format!=='kingmaker'||d.version!==1||!['scene','scenario','map'].includes(d.kind))throw Error('Not a supported Kingmaker authoring file (format kingmaker, version 1).');
  if(expectedKind&&d.kind!==expectedKind)throw Error(`The file extension requires a ${expectedKind} document.`);
  if(d.terrain!==undefined){if(d.kind!=='map')throw Error('Only maps can contain terrain.');validateMap(d.terrain)}
  if(typeof d.id!=='string'||typeof d.title!=='string'||typeof d.description!=='string'||!strings(d.lore)||!Array.isArray(d.nodes)||!Array.isArray(d.edges))throw Error('Missing title, description, nodes, transitions or lore references.');
  const ids=new Set<string>();
  for(const n of d.nodes){
    if(!n||typeof n.id!=='string'||ids.has(n.id)||!Number.isFinite(n.position?.x)||!Number.isFinite(n.position?.y)||!n.data||!['beat','start','exit','scene','map'].includes(n.data.kind)||typeof n.data.title!=='string'||typeof n.data.description!=='string'||!strings(n.data.lore)||(n.data.file!==undefined&&typeof n.data.file!=='string')||(n.data.entry!==undefined&&typeof n.data.entry!=='string'))throw Error('A node has invalid or duplicate data.');
    ids.add(n.id);
    if(n.data.mapFeature!==undefined){
      const a=n.data.mapAt,w=d.terrain?.width??32,h=d.terrain?.height??24;
      if(d.kind!=='map'||!['spawn','interaction'].includes(n.data.mapFeature)||!a||!Number.isInteger(a.x)||!Number.isInteger(a.y)||a.x<0||a.y<0||a.x>=w||a.y>=h||(n.data.mapFeature==='spawn'&&n.data.kind!=='start')||(n.data.mapFeature==='interaction'&&n.data.kind!==(n.data.exitPort?.trim()?'exit':'beat'))||['eventMessage','exitPort','script'].some(k=>n.data[k]!==undefined&&typeof n.data[k]!=='string'))throw Error('Invalid map spawn point or interaction.');
    }
  }
  const edges=new Set<string>();
  for(const e of d.edges){
    if(!e||typeof e.id!=='string'||edges.has(e.id)||!ids.has(e.source)||!ids.has(e.target)||typeof e.label!=='string'||!e.data||typeof e.data.condition!=='string'||typeof e.data.phase!=='string'||typeof e.data.skill!=='string'||!Number.isFinite(e.data.dc))throw Error('A transition has invalid data or refers to a missing node.');
    edges.add(e.id);
  }
  if(d.scenario!==undefined){
    const config=d.scenario;
    if(!config||typeof config!=='object'||Array.isArray(config)||(config.files!==undefined&&!strings(config.files))||(config.entry!==undefined&&(!config.entry||typeof config.entry.file!=='string'||typeof config.entry.entry!=='string'))||(config.positions!==undefined&&(!config.positions||typeof config.positions!=='object'||Array.isArray(config.positions)||Object.values(config.positions).some((p:any)=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))))throw Error('Invalid scenario starting point or diagram layout.');
  }
  return d;
}
// Only authored content persists; React Flow measurements and selection do not.
export function serializeDocument(d:GraphDocument):string{return JSON.stringify({...d,nodes:d.nodes.map(({id,position,data})=>({id,type:'story',position,data})),edges:d.edges.map(({id,source,target,label,data,sourceHandle,targetHandle})=>({id,source,target,type:'smoothstep',label,data,...(sourceHandle?{sourceHandle}:{}),...(targetHandle?{targetHandle}:{})}))},null,2)+'\n'}
export function removeNodes(d:GraphDocument,ids:Set<string>):GraphDocument{return {...d,nodes:d.nodes.filter(n=>!ids.has(n.id)),edges:d.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target))}}

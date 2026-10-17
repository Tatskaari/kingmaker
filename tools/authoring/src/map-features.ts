import type {CardNode,GraphDocument} from './model';
import type {Point,MapResize} from './map-model';
import {inside} from './map-model';

export type FeatureValues={title:string;eventMessage:string;exitPort:string;script:string};
export function saveMapFeature(doc:GraphDocument,id:string,type:'spawn'|'interaction',at:Point,values:FeatureValues):GraphDocument{
  const title=values.title.trim(),exitPort=type==='interaction'?values.exitPort.trim():'';
  if(!title)throw Error('Give this '+(type==='spawn'?'spawn point':'interaction')+' a name.');
  if(type==='spawn'&&doc.nodes.some(n=>n.id!==id&&n.data.kind==='start'&&n.data.title===title))throw Error('A spawn point with that name already exists.');
  if(exitPort&&doc.nodes.some(n=>n.id!==id&&n.data.kind==='exit'&&(n.data.exitPort??n.data.title)===exitPort))throw Error('An exit port with that name already exists.');
  const old=doc.nodes.find(n=>n.id===id);
  const data:CardNode['data']={...(old?.data??{description:'',lore:[]}),title,kind:type==='spawn'?'start':exitPort?'exit':'beat',mapFeature:type,mapAt:at,...(type==='interaction'?{eventMessage:values.eventMessage,exitPort,script:values.script}:{})};
  if(type==='interaction'&&!exitPort){delete data.file;delete data.next;delete data.entry;delete data.destinationKind}
  const node:CardNode={...old,id,type:'story',position:old?.position??{x:at.x*40,y:at.y*40},data};
  return {...doc,nodes:old?doc.nodes.map(n=>n.id===id?node:n):[...doc.nodes,node]};
}
/** Tile positions shift with north/west resizing; cropped features and their local edges go together. */
export function resizeMapDocument(doc:GraphDocument,result:MapResize):GraphDocument{
  const nodes=doc.nodes.flatMap(n=>{
    if(!n.data.mapAt)return [n];
    const at={x:n.data.mapAt.x+result.offset.x,y:n.data.mapAt.y+result.offset.y};
    return inside(result.map,at)?[{...n,data:{...n.data,mapAt:at}}]:[];
  });
  const ids=new Set(nodes.map(n=>n.id));
  return {...doc,terrain:result.map,nodes,edges:doc.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
}

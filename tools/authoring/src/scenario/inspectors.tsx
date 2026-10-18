// The scenario diagram's inspector: what's selected on it, a card (the start, a scene, a map) or a way
// out of one, each wired in the file that owns it: an ending's next in its scene's file, a region's
// scene and a way out's map in its map's, the start in the scenario's. A destination can be a new
// scene or map, made, listed and wired in one step.
import React from 'react';
import {BookOpen,ExternalLink,Flag,Map as MapIcon,Trash2} from 'lucide-react';
import {SelectField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {serializeScene,setNodeField} from '../scene/model.ts';
import {newMap,removeExits,serializeMap,setExit,setRegionField} from '../map/model.ts';
import type {MapDocument} from '../map/model.ts';
import {TileFields} from '../map/inspectors.tsx';
import type {CampaignFiles} from '../campaign/files.ts';
import type {FileChange} from '../campaign/edits.ts';
import {NewFile} from '../campaign/views.tsx';
import {landingOn,mapCard,sceneCard,setScenarioField,withStart} from './model.ts';
import type {FlowCard,FlowOwner,FlowPort,ScenarioDocument,Tile2} from './model.ts';
import type {ScenarioActions} from './views.tsx';

type Edits={write:(changes:FileChange[],own?:ScenarioDocument,coalesce?:boolean)=>Promise<boolean>;commit:(next:ScenarioDocument,coalesce?:boolean)=>boolean;current:{current:ScenarioDocument}};
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};

/** What the diagram's wiring does: each way's destination set in its owner's file, taken away (after asking), or made new. */
export type Wiring=ReturnType<typeof useWiring>;

export function useWiring({doc,known,edits,ask,setToast,make}:{doc:ScenarioDocument;known:CampaignFiles|null;edits:Edits;ask:(confirmation:Confirmation)=>void;setToast:(text:string)=>void;make:ScenarioActions['make']}){
  const sceneFile=(key:string)=>known?.scenes.find(scene=>scene.key===key);
  const mapFile=(key:string)=>known?.maps.find(map=>map.key===key);
  /** A scene's file changed by `change`, as a write; refused (with a note) when it can't be read. */
  const sceneChange=(key:string,change:(scene:NonNullable<ReturnType<typeof sceneFile>>['doc']&object)=>object):FileChange|undefined=>{
    const file=sceneFile(key);
    if(!file?.doc||file.text===undefined){setToast(`${file?.path??`scenes/${key}.kmscene`} can't be read, so its endings can't be set from here: open it.`);return undefined}
    const after=serializeScene(change(file.doc) as typeof file.doc);
    return after===file.text?undefined:{path:file.path,before:file.text,after};
  };
  const mapChange=(key:string,change:(map:MapDocument)=>MapDocument):FileChange|undefined=>{
    const file=mapFile(key);
    if(!file?.doc||file.text===undefined){setToast(`${file?.path??`maps/${key}.kmmap`} can't be read, so it can't be wired from here: open it.`);return undefined}
    const after=serializeMap(change(file.doc));
    return after===file.text?undefined:{path:file.path,before:file.text,after};
  };
  const write=(change:FileChange|undefined)=>{if(change)void edits.write([change])};
  const landing=(map:string,from?:string)=>landingOn(mapFile(map)?.doc,from);
  const exitsTo=(owner:Extract<FlowOwner,{kind:'exits'}>,map:string,at:(exit:MapDocument['exits'][number])=>Tile2)=>(m:MapDocument)=>owner.indices.reduce((next,i)=>{const exit=next.exits[i];return setExit(next,i,{...exit,to:{map,at:at(exit)}})},m);

  /** A way out of a card sent to another card (or, with none, its destination taken away). */
  const aim=(owner:FlowOwner,target:string|undefined)=>{
    const scene=target?.startsWith('scene:')?target.slice(6):undefined,map=target?.startsWith('map:')?target.slice(4):undefined;
    if(owner.kind==='ending'){
      if(target&&!scene){setToast('An ending goes on to a scene.');return}
      write(sceneChange(owner.scene,s=>setNodeField(s,owner.ending,'next',scene)));
    }else if(owner.kind==='region'){
      if(!scene){if(target){setToast('A region plays a scene.');return}ask({title:'Stop the region playing its scene?',description:`The region ${owner.region} on ${owner.map} won't play a scene any more; the region stays. You can undo this.`,confirmLabel:'Stop playing it',run:()=>write(mapChange(owner.map,m=>setRegionField(m,owner.index,'sceneId',undefined)))});return}
      write(mapChange(owner.map,m=>setRegionField(m,owner.index,'sceneId',scene)));
    }else if(owner.kind==='exits'){
      if(!map){if(target){setToast('A way out of a map leads to a map.');return}
        ask({title:`Delete “${owner.label}”?`,description:`The ${owner.indices.length===1?'exit':`${owner.indices.length} exits`} from ${owner.map} to ${owner.to} go. You can undo this.`,confirmLabel:'Delete',run:()=>write(mapChange(owner.map,m=>removeExits(m,owner.indices)))});return}
      const at=landing(map,owner.map);
      write(mapChange(owner.map,exitsTo(owner,map,exit=>map===exit.to.map?exit.to.at:at)));
    }else if(owner.kind==='start'){
      if(map)edits.commit(withStart(doc,map,map===doc.start.map&&doc.start.at?{x:doc.start.at[0],y:doc.start.at[1]}:landing(map)));
      else if(scene)ask({title:'Start in the scene at once?',description:`The story won't start on a map: ${scene} opens as the game begins. You can undo this.`,confirmLabel:'Start in it',run:()=>edits.commit(setScenarioField(withStart(doc,undefined,undefined),'firstScene',scene))});
      else ask({title:'Start without a map?',description:'The story won\'t start on a map: its first scene opens as the game begins. You can undo this.',confirmLabel:'No start map',run:()=>edits.commit(withStart(doc,undefined,undefined))});
    }else if(owner.kind==='lead'){
      if(!scene){setToast(target?'The first lead is a scene.':'The story needs its first scene.');return}
      edits.commit(setScenarioField(doc,'firstScene',scene));
    }
  };
  /** A way's destination taken away from the diagram (the Delete key on an edge): asked first, whatever owns it. */
  const unwire=(owner:FlowOwner)=>{
    if(owner.kind==='ending')ask({title:'End the story here?',description:`The ending ${owner.ending} of ${owner.scene} won't go on to a scene: the story ends there. You can undo this.`,confirmLabel:'End the story here',run:()=>aim(owner,undefined)});
    else aim(owner,undefined);
  };
  /** A new scene (or map) made, listed, and the way's destination: one step. */
  const makeFor=(owner:FlowOwner,title:string,id:string)=>{
    const changes=(change:FileChange|undefined)=>()=>change?[change]:[];
    if(owner.kind==='ending')make('scene',title,id,{others:()=>changes(sceneChange(owner.scene,s=>setNodeField(s,owner.ending,'next',id)))()});
    else if(owner.kind==='region')make('scene',title,id,{others:()=>changes(mapChange(owner.map,m=>setRegionField(m,owner.index,'sceneId',id)))()});
    else if(owner.kind==='exits'){const at=landingOn(newMap(title,id));make('map',title,id,{others:()=>changes(mapChange(owner.map,exitsTo(owner,id,()=>at)))()})}
    else if(owner.kind==='start')make('map',title,id,{pick:next=>withStart(next,id,landingOn(newMap(title,id)))});
    else make('scene',title,id,{pick:next=>setScenarioField(next,'firstScene',id)});
  };
  const exitLanding=(map:string,index:number,at:Tile2)=>write(mapChange(map,m=>setExit(m,index,{...m.exits[index],to:{...m.exits[index].to,at}})));
  const regionPlays=(map:string,index:number,scene:string|undefined)=>write(mapChange(map,m=>setRegionField(m,index,'sceneId',scene)));
  const startTile=(at:Tile2)=>edits.commit(withStart(edits.current.current,edits.current.current.start.map,at));
  return {aim,unwire,makeFor,exitLanding,regionPlays,startTile,landing,sceneFile,mapFile,known};
}

const sceneOptions=(doc:ScenarioDocument,wiring:Wiring,none?:string):Option[]=>[...(none?[{value:'',label:none}]:[]),...doc.scenes.map(key=>({value:sceneCard(key),label:`${wiring.sceneFile(key)?.doc?.title??key} (${key})`}))];
const mapOptions=(doc:ScenarioDocument,wiring:Wiring,none?:string):Option[]=>[...(none?[{value:'',label:none}]:[]),...doc.maps.map(key=>({value:mapCard(key),label:`${wiring.mapFile(key)?.doc?.title??key} (${key})`}))];

/** A way out, wired: its destination (one of the scenario's, or a new one), and what else its owner says of it. */
export function PortEditor({port,doc,wiring}:{port:FlowPort;doc:ScenarioDocument;wiring:Wiring}){
  const owner=port.owner;
  const taken=(kind:'scenes'|'maps')=>wiring.known?.present[kind]??[];
  const newScene=<NewFile kind="scene" label="New scene" taken={taken('scenes')} onCreate={(title,id)=>wiring.makeFor(owner,title,id)}/>;
  if(owner.kind==='ending')return <>
    <SelectField label={`${port.label}: next scene`} field="next" hint="The scene the story goes on to, in the scene's file." value={port.target??''} options={sceneOptions(doc,wiring,'Nowhere: the story ends here')} onChange={value=>wiring.aim(owner,value||undefined)}/>
    {newScene}
  </>;
  if(owner.kind==='region')return <>
    <SelectField label={`${port.label}: plays`} field="sceneId" hint="The scene played in this region, in the map's file." value={port.target??''} options={sceneOptions(doc,wiring,'No scene')} onChange={value=>wiring.aim(owner,value||undefined)}/>
    {newScene}
  </>;
  if(owner.kind==='exits'){
    const map=wiring.mapFile(owner.map)?.doc,first=map?.exits[owner.indices[0]];
    return <>
      <SelectField label={`${port.label}: to`} field="to.map" hint={`Where ${owner.indices.length===1?'this exit leads':`these ${owner.indices.length} exits lead`}, in the map's file.`} value={port.target??mapCard(owner.to)} options={mapOptions(doc,wiring)} onChange={value=>wiring.aim(owner,value)}/>
      <NewFile kind="map" label="New map" taken={taken('maps')} onCreate={(title,id)=>wiring.makeFor(owner,title,id)}/>
      {first&&owner.indices.length===1&&<TileFields label="Lands at (tile there)" at={first.to.at} onChange={at=>wiring.exitLanding(owner.map,owner.indices[0],at)}/>}
      {owner.indices.length>1&&<p className="muted">Each lands where it does: {owner.indices.map(i=>{const e=map?.exits[i];return e?`(${e.at.x}, ${e.at.y}) → (${e.to.at.x}, ${e.to.at.y})`:''}).join(', ')}. Open the map to move them.</p>}
      <button type="button" className="text-button danger" onClick={()=>wiring.aim(owner,undefined)}><Trash2 size={13}/>Delete {owner.indices.length===1?'this exit':'these exits'}…</button>
    </>;
  }
  if(owner.kind==='start')return <>
    <SelectField label="Starts on" field="start.map" hint="The map the player starts walking on, in the scenario." value={doc.start.map?mapCard(doc.start.map):''} options={mapOptions(doc,wiring,'No map: the first scene opens at once')} onChange={value=>wiring.aim(owner,value||undefined)}/>
    <NewFile kind="map" label="New map" taken={taken('maps')} onCreate={(title,id)=>wiring.makeFor(owner,title,id)}/>
    {doc.start.map&&doc.start.at&&<TileFields label="Start tile" at={{x:doc.start.at[0],y:doc.start.at[1]}} onChange={wiring.startTile}/>}
  </>;
  return <>
    <SelectField label="First lead" field="firstScene" hint="The story's first scene, in the scenario." value={doc.firstScene?sceneCard(doc.firstScene):''} options={sceneOptions(doc,wiring)} onChange={value=>wiring.aim(owner,value)}/>
    {newScene}
  </>;
}

/** A way out selected (its port or its edge): its wiring, and a way back to all of its card's. */
export function PortInspector({card,port,doc,wiring,onAll}:{card:FlowCard;port:FlowPort;doc:ScenarioDocument;known:CampaignFiles|null;wiring:Wiring;onAll:()=>void;open:(path:string)=>void}){
  return <div className="card-inspector">
    <p className="inspector-kind">{card.title}</p>
    <div className="port-editor" data-port={port.id}><PortEditor port={port} doc={doc} wiring={wiring}/></div>
    <button type="button" className="text-button" onClick={onAll}>All of {card.title}</button>
  </div>;
}

/** A card selected: the start's ways, a scene's endings, a map's ways out and every region of it. */
export function CardInspector({card,doc,wiring,open}:{card:FlowCard;doc:ScenarioDocument;known:CampaignFiles|null;wiring:Wiring;open:(path:string)=>void;onPort:(port:string)=>void}){
  if(card.kind==='start')return <div className="card-inspector">
    <p className="inspector-kind"><Flag size={13}/>The start</p>
    <p className="muted">Day {doc.start.day}, {doc.start.time.replace('-',' ')}. {doc.start.map?`The player starts walking on ${doc.start.map}${doc.start.at?` at (${doc.start.at[0]}, ${doc.start.at[1]})`:''}, and the first lead is ${doc.firstScene||'not set'}.`:`The first scene, ${doc.firstScene||'not set yet'}, opens at once.`} The day and the time are the Scenario view's.</p>
    {card.ports.map(port=><div key={port.id} className="port-editor" data-port={port.id}><PortEditor port={port} doc={doc} wiring={wiring}/></div>)}
  </div>;
  return <div className="card-inspector" data-card={card.id}>
    <p className="inspector-kind">{card.kind==='scene'?<BookOpen size={13}/>:<MapIcon size={13}/>}{card.kind==='scene'?'Scene':'Map'}<code>{card.key}</code></p>
    <h3 className="inspector-title">{card.title}</h3>
    <p className="muted">{card.subtitle}</p>
    {card.path&&<button type="button" className="wide-button" onClick={()=>open(card.path!)}>Open {card.path} <ExternalLink size={13}/></button>}
    {card.error&&<p className="scenario-warning">{card.error}</p>}
    {card.kind==='scene'&&<>{!card.ports.length&&<p className="muted">No endings: open the scene to add one.</p>}{card.ports.map(port=><div key={port.id} className="port-editor" data-port={port.id}><PortEditor port={port} doc={doc} wiring={wiring}/></div>)}</>}
    {card.kind==='map'&&<MapWiring card={card} doc={doc} wiring={wiring}/>}
  </div>;
}

/** A map's wiring: its ways out (as on its card), and every region, each able to play a scene. */
function MapWiring({card,doc,wiring}:{card:FlowCard;doc:ScenarioDocument;wiring:Wiring}){
  const file=wiring.mapFile(card.key!)?.doc;
  if(!file)return null;
  const exits=card.ports.filter(port=>port.owner.kind==='exits');
  return <>
    <div className="subheading">Ways out</div>
    {!exits.length&&<p className="muted">None: add exits on the map.</p>}
    {exits.map(port=><div key={port.id} className="port-editor" data-port={port.id}><PortEditor port={port} doc={doc} wiring={wiring}/></div>)}
    <div className="subheading">Regions</div>
    {!file.regions.length&&<p className="muted">None: add regions on the map.</p>}
    {file.regions.map((region,index)=><div key={`${region.id}:${index}`} className="port-editor" data-region={region.id}>
      <SelectField label={`${region.name||region.id}: plays`} value={region.sceneId?sceneCard(region.sceneId):''} options={sceneOptions(doc,wiring,'No scene')} onChange={value=>wiring.regionPlays(card.key!,index,value?value.slice(6):undefined)}/>
      <NewFile kind="scene" label="New scene" taken={wiring.known?.present.scenes} onCreate={(title,id)=>wiring.makeFor({kind:'region',map:card.key!,index,region:region.id},title,id)}/>
    </div>)}
  </>;
}

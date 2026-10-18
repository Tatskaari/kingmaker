// The map's own fields, each in a view of the main area beside the painter's: the Map view (its title,
// id, description and size, where the story starts on it, the ways in from other maps and the places
// laid on it), the Legend (the palette's entries), its Regions, Exits and People (by the hour), each a
// list beside the chosen one's card, the card the inspector's form with a way to show it on the map.
import React,{useEffect,useState} from 'react';
import {MapPin,Plus} from 'lucide-react';
import {ChoiceField,IdField,NumberField,TextArea,TextField} from '../scene/fields.tsx';
import {DocCard,ListView,Uses,ViewIndex,plural} from '../campaign/views.tsx';
import {Group} from '../scene/fields.tsx';
import {MAP_LIMIT,MAP_MIN,ORDER,TIMES,entryName,peopleAbout} from './model.ts';
import type {MapDocument,TimeOfDay,Tile2} from './model.ts';
import {ExitInspector,LegendInspector,PersonInspector,RegionInspector,TileFields} from './inspectors.tsx';
import type {RegionContext} from './inspectors.tsx';
import type {Option} from '../scene/fields.tsx';
import {withKey} from '../campaign/json.ts';
import {swatchOf} from './look.ts';

export type MapSelection={kind:'region'|'exit'|'person';index:number}|{kind:'legend';ch:string};

/** What the map's views ask of the editor. */
export type MapViewActions={
  /** The map changed (typing in a field is one step). */
  edit:(next:MapDocument)=>void;
  /** Switch to the painter with this selected, and the view on it. */
  showOnMap:(selection:MapSelection|{kind:'start'}|{kind:'tile';at:Tile2})=>void;
  removeRegion:(index:number)=>void;
  removeExit:(index:number)=>void;
  removePerson:(index:number)=>void;
  removeLegend:(ch:string)=>void;
  setLegend:(ch:string,entry:import('./model.ts').LegendEntry)=>void;
  renameLegend:(from:string,to:string)=>void;
  renameRegion:(index:number,to:string)=>void;
  regionIdProblem:(index:number,id:string)=>string|undefined;
  paintWith:(ch:string)=>void;
  /** A dialog for something new: a legend entry, a region, an exit, someone about. */
  add:(kind:'legend'|'region'|'exit'|'person')=>void;
  /** The map resized to `width` by `height`, from its east and south edges (asking first when it crops). */
  resizeTo:(width:number,height:number)=>void;
  /** The story's start on a tile of this map (written in the scenario). */
  startHere:(at:Tile2)=>void;
  open:(path:string)=>void;
  openMap:(key:string)=>void;
  newMapFor:(exit:number,title:string,id:string)=>void;
};

type Common={doc:MapDocument;actions:MapViewActions};

// ---------------------------------------------------------------------------------------------
// The Map view.

/** The map's own: what other files say of it, for the Map view. */
export type MapAround={
  listed:boolean;notes:string[];
  start?:{at:Tile2;day:number;time:string};
  startsElsewhere?:string;
  waysIn:Array<{from:string;fromTitle:string;label:string;at:Tile2;path:string}>;
  laid:Array<{region:string;name:string;scene:string;place?:string;placeTitle?:string;path?:string}>;
  middle:Tile2;
};

export function MapView({doc,actions,size,around}:Common&{size:{width:number;height:number};around:MapAround}){
  const set=(key:string,value:unknown)=>actions.edit(withKey(doc,key,value,ORDER.map));
  return <div className="view-content map-view">
    <ViewIndex label="The map's groups" groups={[['map-own','The map'],['map-size','Its size'],['map-start','The story\'s start'],['map-ways','Ways in'],['map-places','Places laid on it']]}/>
    <Group title="The map" anchor="map-own" field="map">
      <TextField label="Title" field="title" hint="Its name as the game shows it." value={doc.title} onChange={value=>set('title',value)}/>
      <IdField id={doc.id} label="Map id" problem={next=>/^[a-z0-9][a-z0-9-]*$/.test(next)?undefined:'An id is a slug: lower-case letters, digits and dashes.'} onRename={next=>set('id',next)}
        warning="It's the file's name (rename the file to match: the problems say until it does), and the scenario's list, the exits leading here and the start name it too."/>
      <TextArea label="Description" field="description" rows={3} value={doc.description} onChange={value=>set('description',value)}/>
      {around.notes.map(note=><p className="problems-note" key={note}>{note}</p>)}
    </Group>
    <SizeGroup size={size} actions={actions}/>
    <StartGroup around={around} actions={actions}/>
    <Group title="Ways in" anchor="map-ways" field="waysIn" hint="The exits of the scenario's other maps that lead here, and where each lands. A map's own ways out are its Exits.">
      <Uses title="From other maps" uses={around.waysIn.map((way,i)=>({key:`${way.from}:${i}`,label:`${way.label}, from ${way.fromTitle}`,detail:`lands at (${way.at.x}, ${way.at.y})`,onOpen:()=>actions.open(way.path)}))} none="None: no way leads here from another map (an exit to it is added on that map)."/>
    </Group>
    <Group title="Places laid on it" anchor="map-places" field="places" hint="A region that plays a scene can lay the scene's place on the map: each is drawn over its region when it's selected.">
      <Uses title="Its regions' places" uses={around.laid.map(laid=>({key:laid.region,label:`${laid.placeTitle??'No place'}, at ${laid.name}`,detail:laid.place?`${laid.path} · for ${laid.scene}`:`${laid.scene} has no place yet`,onOpen:()=>{const index=doc.regions.findIndex(region=>region.id===laid.region);if(index>=0)actions.showOnMap({kind:'region',index})}}))} none="None yet: a region that plays a scene and lays its place."/>
    </Group>
  </div>;
}

/** The map's size: its width and height, set and applied from its east and south edges (dragging its edges in the painter does the rest). */
function SizeGroup({size,actions}:{size:{width:number;height:number};actions:MapViewActions}){
  const [width,setWidth]=useState(size.width),[height,setHeight]=useState(size.height);
  useEffect(()=>{setWidth(size.width);setHeight(size.height)},[size.width,size.height]);
  const changed=width!==size.width||height!==size.height;
  return <Group title="Its size" anchor="map-size" field="grid" hint={`In tiles of five feet: from ${MAP_MIN} up to ${MAP_LIMIT.w} by ${MAP_LIMIT.h}. New tiles are the Erase material; the Resize tool (S) in the Paint view moves any edge.`}>
    <div className="field-row size-row">
      <NumberField label="Width" field="width" min={MAP_MIN} max={MAP_LIMIT.w} value={width} onChange={setWidth}/>
      <NumberField label="Height" field="height" min={MAP_MIN} max={MAP_LIMIT.h} value={height} onChange={setHeight}/>
      <button type="button" className="primary" disabled={!changed} onClick={()=>actions.resizeTo(width,height)}>Resize to {width} × {height}</button>
    </div>
  </Group>;
}

function StartGroup({around,actions}:{around:MapAround;actions:MapViewActions}){
  const [at,setAt]=useState<Tile2>(around.start?.at??around.middle);
  return <Group title="The story's start" anchor="map-start" field="start" hint="Where the player starts walking, in the scenario's file.">
    {around.start?<>
      <p className="muted">Day {around.start.day}, {around.start.time.replace('-',' ')}: the player starts walking here, at ({around.start.at.x}, {around.start.at.y}).</p>
      <TileFields label="Start tile" field="start.at" at={around.start.at} onChange={actions.startHere}/>
      <button type="button" className="text-button" onClick={()=>actions.showOnMap({kind:'start'})}><MapPin size={12}/>Show it on the map</button>
    </>:<>
      <p className="muted">{around.startsElsewhere?`The story starts on ${around.startsElsewhere}.`:'The story doesn\'t start on a map: its first scene opens at once.'}</p>
      <TileFields label="Start here, at" at={at} onChange={setAt}/>
      <button type="button" className="add-item" onClick={()=>actions.startHere(at)}><Plus size={13}/>Start the story on this map</button>
    </>}
  </Group>;
}

// ---------------------------------------------------------------------------------------------
// The Legend, Regions, Exits and People views: a list beside the chosen one's card.

/** The legend: every entry in the palette, its swatch, character and name, beside the chosen one's card. */
export function LegendView({doc,actions,counts,chosen,onChoose}:Common&{counts:Map<string,number>;chosen?:string;onChoose:(ch:string)=>void}){
  const entries=Object.entries(doc.legend);
  const ch=chosen&&chosen in doc.legend?chosen:entries[0]?.[0];
  const entry=ch?doc.legend[ch]:undefined;
  return <ListView title="Legend" label="The legend" chosen={ch} onChoose={onChoose} empty="No entries: a map paints in its legend's characters."
    items={entries.map(([c,e])=>({id:c,swatch:<span className="legend-swatch" style={{background:swatchOf(e)}}/>,label:<><code>{c}</code> {entryName(e)}</>,detail:plural(counts.get(c)??0,'tile')}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('legend')}><Plus size={13}/>New entry</button>}
    card={ch&&entry?<DocCard key={ch} label={`Legend entry ${ch}`} title={entryName(entry)} data={{legend:ch}}>
      <LegendInspector doc={doc} ch={ch} entry={entry} uses={counts.get(ch)??0} onChange={next=>actions.setLegend(ch,next)} onRename={to=>actions.renameLegend(ch,to)} onRemove={()=>actions.removeLegend(ch)} onPaint={()=>actions.paintWith(ch)}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add an entry to paint with it.</p></section>}/>;
}

/** The regions: each named part of the map, what it plays, beside the chosen one's card. */
export function RegionsView({doc,actions,context,chosen,onChoose,placeNote}:Common&{context:RegionContext;chosen?:number;onChoose:(index:number)=>void;placeNote:(index:number)=>string|undefined}){
  const index=chosen!==undefined&&doc.regions[chosen]?chosen:doc.regions.length?0:undefined;
  const region=index!==undefined?doc.regions[index]:undefined;
  return <ListView title="Regions" label="The regions" chosen={index!==undefined?String(index):undefined} onChoose={id=>onChoose(Number(id))} empty="None yet: a street, a yard, the room a scene is played in."
    items={doc.regions.map((r,i)=>({id:String(i),label:r.name||r.id,detail:<><code>{r.id}</code> · {r.rect.w} × {r.rect.h} at ({r.rect.x}, {r.rect.y})</>,note:r.sceneId?`${r.worldOrigin?'lays':'opens'} ${r.sceneId}`:undefined}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('region')}><Plus size={13}/>Add region</button>}
    card={region&&index!==undefined?<DocCard key={`${region.id}:${index}`} label={`Region ${region.id}`} title={region.name||region.id} data={{region:region.id}} actions={<button type="button" onClick={()=>actions.showOnMap({kind:'region',index})}><MapPin size={12}/>Show on the map</button>}>
      <RegionInspector doc={doc} index={index} context={context} onChange={actions.edit} onRemove={()=>actions.removeRegion(index)} placeNote={placeNote(index)} onRename={to=>actions.renameRegion(index,to)}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add a region to write it here.</p></section>}/>;
}

/** The exits: each way to another map, beside the chosen one's card. */
export function ExitsView({doc,actions,maps,taken,chosen,onChoose}:Common&{maps:Option[];taken:string[];chosen?:number;onChoose:(index:number)=>void}){
  const index=chosen!==undefined&&doc.exits[chosen]?chosen:doc.exits.length?0:undefined;
  const exit=index!==undefined?doc.exits[index]:undefined;
  return <ListView title="Exits" label="The exits" chosen={index!==undefined?String(index):undefined} onChoose={id=>onChoose(Number(id))} empty="None yet: a door, a gate, a path off the map to another."
    items={doc.exits.map((e,i)=>({id:String(i),label:e.label||'An exit',detail:`(${e.at.x}, ${e.at.y}) → ${e.to.map} (${e.to.at.x}, ${e.to.at.y})`}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('exit')}><Plus size={13}/>Add exit</button>}
    card={exit&&index!==undefined?<DocCard key={index} label={`Exit ${index+1}`} title={exit.label||'An exit'} data={{exit:String(index)}} actions={<button type="button" onClick={()=>actions.showOnMap({kind:'exit',index})}><MapPin size={12}/>Show on the map</button>}>
      <ExitInspector doc={doc} index={index} maps={maps} taken={taken} onChange={actions.edit} onRemove={()=>actions.removeExit(index)} onOpen={actions.openMap} onNewMap={actions.newMapFor}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add an exit to write it here.</p></section>}/>;
}

/** The people about: by the hour (each hour's, or everyone), beside the chosen one's card. */
export function PeopleView({doc,actions,chosen,onChoose,hour,onHour}:Common&{chosen?:number;onChoose:(index:number)=>void;hour:TimeOfDay|'';onHour:(hour:TimeOfDay|'')=>void}){
  const about=peopleAbout(doc,hour||undefined);
  const index=chosen!==undefined&&doc.people?.[chosen]?chosen:about[0]?.index;
  const person=index!==undefined?doc.people?.[index]:undefined;
  return <ListView title="People" label="The people about" chosen={index!==undefined?String(index):undefined} onChoose={id=>onChoose(Number(id))} empty={hour?`Nobody's about in the ${hour.replace('-',' ')}.`:'Nobody yet: a sweeper in the morning, a lamplighter at dusk.'}
    filter={<div className="hour-filter"><ChoiceField label="About at" field="hour" value={hour} options={[{value:'',label:'Any hour'},...TIMES.map(time=>({value:time,label:time.replace('-',' ')}))]} onChange={value=>onHour(value as TimeOfDay|'')}/></div>}
    items={about.map(({person:p,index:i})=>({id:String(i),swatch:<span className="pick-glyph" style={{color:p.color??'#b8ad9c'}}>{p.glyph}</span>,label:p.name,detail:`(${p.at.x}, ${p.at.y}) · ${p.times.length===TIMES.length?'all day':p.times.map(t=>t.replace('-',' ')).join(', ')}`}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('person')}><Plus size={13}/>Add person</button>}
    card={person&&index!==undefined?<DocCard key={index} label={`Person ${person.name}`} title={person.name||'Someone'} data={{person:String(index)}} actions={<button type="button" onClick={()=>actions.showOnMap({kind:'person',index})}><MapPin size={12}/>Show on the map</button>}>
      <PersonInspector doc={doc} index={index} onChange={actions.edit} onRemove={()=>actions.removePerson(index)}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add someone to write them here.</p></section>}
    className="people-view"/>;
}

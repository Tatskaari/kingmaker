// The place's own fields, each in a view of the main area beside the plan's: the Place view (its title,
// id, description and size, where it's laid on a map and the scenes played in it), its Areas, Things and
// People (who starts there), each a list beside the chosen one's card.
import React from 'react';
import {MapPin,Plus} from 'lucide-react';
import {Group,IdField,NumberField,TextArea,TextField} from '../scene/fields.tsx';
import {DocCard,ListView,OtherKeys,Uses,ViewIndex,plural} from '../campaign/views.tsx';
import type {Use} from '../campaign/views.tsx';
import {ORDER,setPlaceField} from './model.ts';
import type {PlaceDocument} from './model.ts';
import {PlacePartInspector} from './inspectors.tsx';
import type {PlacePart} from './inspectors.tsx';
import {withKey} from '../campaign/json.ts';

/** What the place's views ask of the editor. */
export type PlaceViewActions={
  edit:(next:PlaceDocument)=>void;
  /** Switch to the plan with this selected. */
  showOnPlan:(part:PlacePart)=>void;
  confirm:(title:string,description:string,label:string,run:()=>void)=>void;
  /** A dialog for something new: an area, a thing, someone's start. */
  add:(kind:'area'|'thing'|'starts',area?:string)=>void;
  open:(path:string)=>void;
  renamed:(part:PlacePart,to:string)=>void;
  /** A part of the place chosen in the view that lists its kind. */
  choose:(part:PlacePart)=>void;
};

/** The place's own: what the campaign's other files say of it, for the Place view. */
export type PlaceAround={
  notes:string[];
  laid:Array<{map:string;mapTitle:string;region:string;name:string;origin:{x:number;y:number};path:string;fits?:string}>;
  scenes:Array<{key:string;title:string;path:string}>;
  startPlace:boolean;
};

type Common={doc:PlaceDocument;actions:PlaceViewActions;cast:Array<{id:string;name:string}>;uses:(part:PlacePart)=>Use[]};

export function PlaceView({doc,actions,around}:{doc:PlaceDocument;actions:PlaceViewActions;around:PlaceAround}){
  const set=(key:string,value:unknown)=>actions.edit(setPlaceField(doc,key,value));
  const setSize=(key:'w'|'h',value:number)=>actions.edit(setPlaceField(doc,'size',withKey(doc.size,key,value,ORDER.size)));
  return <div className="view-content place-view">
    <ViewIndex label="The place's groups" groups={[['place-own','The place'],['place-size','Its size'],['place-uses','Where it\'s used']]}/>
    <Group title="The place" anchor="place-own" field="place">
      <TextField label="Title" field="title" hint="The place's name." value={doc.title} onChange={value=>set('title',value)}/>
      <IdField id={doc.id} label="Place id" problem={next=>/^[a-z0-9][a-z0-9-]*$/.test(next)?undefined:'An id is a slug: lower-case letters, digits and dashes.'} onRename={next=>set('id',next)}
        warning="It's the file's name (rename the file to match: the problems say until it does), and the scenario's list and the scenes played here name it too."/>
      <TextArea label="Description" field="description" rows={3} hint="What the place is, all of it: the GM's first sight of it." value={doc.description} onChange={value=>set('description',value)}/>
      <OtherKeys value={doc} known={ORDER.place} onChange={set}/>
      {around.notes.map(note=><p className="problems-note" key={note}>{note}</p>)}
    </Group>
    <Group title="Its size" anchor="place-size" field="size" hint="In feet, from above (five feet a tile on a map). What's off its floor is a problem, as the campaign check has it.">
      <div className="field-row">
        <NumberField label="Width (feet)" field="size.w" min={5} max={9999} value={doc.size.w} onChange={value=>setSize('w',value)}/>
        <NumberField label="Depth (feet)" field="size.h" min={5} max={9999} value={doc.size.h} onChange={value=>setSize('h',value)}/>
      </div>
      <p className="muted">{Math.ceil(doc.size.w/5)} × {Math.ceil(doc.size.h/5)} tiles on a map · {plural(doc.areas.length,'area')} · {plural(doc.things.length,'thing')} · {plural(Object.keys(doc.people).length,'start')}</p>
    </Group>
    <Group title="Where it's used" anchor="place-uses" field="uses" hint="A scene names its place; a region of a map that plays the scene lays it there.">
      <Uses title="Played in by" uses={around.scenes.map(scene=>({key:scene.key,label:scene.title,detail:scene.key,onOpen:()=>actions.open(scene.path)}))} none="No scene of the scenario is played here yet (a scene's Place names it)."/>
      <Uses title="Laid on" uses={around.laid.map(laid=>({key:`${laid.map}:${laid.region}`,label:`${laid.mapTitle}, over the region “${laid.name}”`,detail:`from (${laid.origin.x}, ${laid.origin.y})${laid.fits?` · ${laid.fits}`:''}`,onOpen:()=>actions.open(laid.path)}))} none="No region lays it on a map: it's edited on its own plan."/>
      {around.startPlace&&<p className="muted">It's the scenario's start place: a scene with no place of its own is played here.</p>}
    </Group>
  </div>;
}

/** Shown on the plan: a card's own button. */
const showButton=(actions:PlaceViewActions,part:PlacePart)=><button type="button" onClick={()=>actions.showOnPlan(part)}><MapPin size={12}/>Show on the plan</button>;

export function AreasView({doc,actions,cast,uses,chosen,onChoose}:Common&{chosen?:string;onChoose:(id:string)=>void}){
  const id=chosen&&doc.areas.some(a=>a.id===chosen)?chosen:doc.areas[0]?.id;
  const area=doc.areas.find(a=>a.id===id);
  return <ListView title="Areas" label="The areas" chosen={id} onChoose={onChoose} empty="None yet: a place's floor is its areas."
    items={doc.areas.map(a=>({id:a.id,label:a.name||a.id,detail:<><code>{a.id}</code> · {a.rect.w} × {a.rect.h} ft at ({a.rect.x}, {a.rect.y})</>}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('area')}><Plus size={13}/>Add area</button>}
    card={area?<DocCard key={area.id} label={`Area ${area.id}`} title={area.name||area.id} data={{area:area.id}} actions={showButton(actions,{kind:'area',id:area.id})}>
      <PlacePartInspector part={{kind:'area',id:area.id}} doc={doc} onChange={actions.edit} onSelect={part=>{if(part)actions.choose(part)}} confirm={actions.confirm} cast={cast} uses={uses} onAdd={(kind,inArea)=>actions.add(kind,inArea)} onRenamed={(part,to)=>{actions.renamed(part,to);onChoose(to)}}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add an area to write it here.</p></section>}/>;
}

export function ThingsView({doc,actions,cast,uses,chosen,onChoose}:Common&{chosen?:string;onChoose:(id:string)=>void}){
  const id=chosen&&doc.things.some(t=>t.id===chosen)?chosen:doc.things[0]?.id;
  const thing=doc.things.find(t=>t.id===id);
  return <ListView title="Things" label="The things" chosen={id} onChoose={onChoose} empty="None yet: what the scenes' clue paths and effects name (the boot, the page, the cleat)."
    items={doc.things.map(t=>({id:t.id,label:t.name||t.id,detail:<><code>{t.id}</code> · {t.at?`at ${t.at[0]}, ${t.at[1]} ft`:`in ${t.in}`}</>}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('thing')}><Plus size={13}/>Add thing</button>}
    card={thing?<DocCard key={thing.id} label={`Thing ${thing.id}`} title={thing.name||thing.id} data={{thing:thing.id}} actions={thing.at?showButton(actions,{kind:'thing',id:thing.id}):undefined}>
      <PlacePartInspector part={{kind:'thing',id:thing.id}} doc={doc} onChange={actions.edit} onSelect={part=>{if(part)actions.choose(part)}} confirm={actions.confirm} cast={cast} uses={uses} onRenamed={(part,to)=>{actions.renamed(part,to);onChoose(to)}}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Add a thing to write it here.</p></section>}/>;
}

export function StartsView({doc,actions,cast,uses,chosen,onChoose}:Common&{chosen?:string;onChoose:(id:string)=>void}){
  const people=Object.entries(doc.people);
  const id=chosen&&chosen in doc.people?chosen:people[0]?.[0];
  const person=id?doc.people[id]:undefined;
  const name=(who:string)=>who==='player'?'The player':cast.find(member=>member.id===who)?.name??who;
  return <ListView title="People" label="Who starts here" chosen={id} onChoose={onChoose} empty="Nobody starts here yet: the scene's cast, and the player."
    items={people.map(([who,p])=>({id:who,label:name(who),detail:<><code>{who}</code> · in {doc.areas.find(a=>a.id===p.in)?.name??p.in}</>}))}
    add={<button type="button" className="add-item" onClick={()=>actions.add('starts')}><Plus size={13}/>Start someone here</button>}
    card={person&&id?<DocCard key={id} label={`Start ${id}`} title={name(id)} data={{starts:id}} actions={showButton(actions,{kind:'person',id})}>
      <PlacePartInspector part={{kind:'person',id}} doc={doc} onChange={actions.edit} onSelect={part=>{if(part)actions.choose(part)}} confirm={actions.confirm} cast={cast} uses={uses}/>
    </DocCard>:<section className="doc-card empty"><p className="muted">Start someone here to write it.</p></section>}/>;
}

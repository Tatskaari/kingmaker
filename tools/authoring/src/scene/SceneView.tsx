// The Scene view: the scene's own fields, grouped as an author thinks of them (what the player knows,
// the prep, when and where, the world, the story and the lore), in the main area beside the graph's.
import React from 'react';
import {useScene} from './api.ts';
import {Checkbox,Group,IdField,ListField,LoreLinks,SelectField,TextArea,TextField} from './fields.tsx';
import {EffectsEditor} from './effects.tsx';
import {storyScenes} from './inspectors.tsx';
import {SLUG,optionalList,optionalText,setSceneField} from './model.ts';

const TIMES=['morning','afternoon','evening','night','next-morning'];
const GROUPS:Array<[string,string]>=[['scene-identity','The scene'],['scene-player','What the player knows'],['scene-prep','The prep'],['scene-when','When and where'],['scene-world','The world'],['scene-story','The story'],['scene-lore','Lore']];

export function SceneView(){
  const {doc,edit,campaign,loreNames,openLore,pickLore,place,openPlace}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setSceneField(scene,key,value));
  const list=(key:'limits'|'known'|'background'|'assumes')=>doc[key]??[];
  const scenes=storyScenes(campaign,doc.id);
  const places=(campaign?.places??[]).map(place=>({value:place.key,label:`${place.name} (${place.key})`}));
  const linkLore=(path:string)=>edit(scene=>scene.lore.includes(path)?scene:setSceneField(scene,'lore',[...scene.lore,path]));
  const talk=doc.id===campaign?.talk||doc.companion!==undefined;
  return <div className="view-content scene-view">
    <nav className="view-index" aria-label="The scene's groups">
      {GROUPS.map(([anchor,title])=><button type="button" key={anchor} onClick={event=>event.currentTarget.closest('.scene-view')?.querySelector(`[data-anchor="${anchor}"]`)?.scrollIntoView({block:'start',behavior:'smooth'})}>{title}</button>)}
    </nav>
    <Group title="The scene" anchor="scene-identity" field="identity">
      <TextField label="Title" field="title" value={doc.title} onChange={value=>set('title',value)}/>
      <IdField id={doc.id} label="Scene id" problem={next=>SLUG.test(next)?undefined:'An id is a slug: lower-case letters, digits and dashes, starting with a letter or digit.'} onRename={next=>set('id',next)}
        warning="It's the file's name: rename the file to match (the problems say until it does), and the scenario and any ending going on to this scene name it too. Game state keys on it: never rename a scene that's been played."/>
      <TextField label="Description" field="description" hint="One line for listings and the map." value={doc.description} onChange={value=>set('description',value)}/>
    </Group>
    <Group title="What the player knows" anchor="scene-player" field="player">
      <TextArea label="Hook" field="hook" rows={4} hint="What the player knows walking in: the player sees this (the map's lead, the card between scenes)." value={doc.hook} onChange={value=>set('hook',value)}/>
    </Group>
    <Group title="The prep" anchor="scene-prep" field="prep" hint="For the GM, behind the screen.">
      <TextArea label="Setting" field="setting" rows={5} hint="Where and when, in sensory detail." value={doc.setting} onChange={value=>set('setting',value)}/>
      <TextArea label="Premise" field="premise" rows={2} hint="The dramatic question the scene answers, in a line." value={doc.premise} onChange={value=>set('premise',value)}/>
      <TextArea label="Truth" field="truth" rows={6} hint="What really happened: never said outright, it comes out through the discoveries' paths." value={doc.truth} onChange={value=>set('truth',value)}/>
      <TextArea label="Clock" field="clock" rows={3} hint="What happens if the player dawdles: the pressure, and its outer limit." value={doc.clock??''} onChange={value=>set('clock',optionalText(value))}/>
    </Group>
    <Group title="When and where" anchor="scene-when" field="when">
      <div className="field-row">
        <SelectField label="Time" field="time" value={doc.time??''} options={[{value:'',label:'Not set'},...TIMES.map(time=>({value:time,label:time}))]} onChange={value=>set('time',optionalText(value))}/>
        <SelectField label="Rest" field="rest" hint="Time passes before it opens: a short rest (an hour) or a long one (a night)." value={doc.rest??''} options={[{value:'',label:'None'},{value:'short',label:'Short'},{value:'long',label:'Long'}]} onChange={value=>set('rest',optionalText(value))}/>
      </div>
      <SelectField label="Place" field="place" hint="The place's world (places/<key>.kmplace): its areas, its things and who stands where." value={doc.place??''} options={[{value:'',label:'None'},...places]} onChange={value=>set('place',optionalText(value))}/>
      {place&&<details className="place-things" data-field="place.things">
        <summary>{place.name}: its things <span className="count">{place.things.length}</span></summary>
        <ul>{place.things.map(thing=><li key={thing.id}><b>{thing.name}</b> <code>{thing.id}</code><small>{thing.at?` at ${thing.at[0]}, ${thing.at[1]} ft`:` in ${thing.in}`}</small></li>)}</ul>
        <button type="button" className="text-button" onClick={()=>openPlace(place.key)}>Open the place</button>
      </details>}
      <Checkbox label="Interlude" field="interlude" hint="Downtime between scenes, standing in for the map: the story skips it, going on from one of its endings." checked={!!doc.interlude} onChange={checked=>set('interlude',checked?true:undefined)}/>
      <Checkbox label="Milestone" field="milestone" hint="Reaching it is a milestone: the player's character goes up a level as it opens." checked={!!doc.milestone} onChange={checked=>set('milestone',checked?true:undefined)}/>
    </Group>
    <Group title="The world" anchor="scene-world" field="world">
      <ListField label="Limits" field="limits" addLabel="Add a limit" rows={2} hint="Tempting things that don't exist or can't work here, so the GM can say “no, but” honestly." items={list('limits')} onChange={items=>set('limits',optionalList(items))}/>
      <ListField label="Known" field="known" addLabel="Add what locals know" hint="What any local knows and a newcomer wouldn't (customs, prices, common talk). Never a secret." items={list('known')} onChange={items=>set('known',optionalList(items))}/>
    </Group>
    <Group title="The story" anchor="scene-story" field="story" hint="How the scene sits in the story: what it carries in, what it takes for granted, and what every ending does.">
      <ListField label="Background" field="background" addLabel="Add a fact carried in" hint="Facts carried in from earlier scenes, for the GM." items={list('background')} onChange={items=>set('background',optionalList(items))}/>
      <ListField label="Assumes" field="assumes" addLabel="Add an assumption" hint="What the prep takes for granted (and play could overtake)." items={list('assumes')} onChange={items=>set('assumes',optionalList(items))}/>
      <SelectField label="Overtaken" field="overtaken" hint="Where the story goes instead when play has overtaken what it assumes." value={doc.overtaken??''} options={[{value:'',label:'Nowhere'},...scenes]} onChange={value=>set('overtaken',optionalText(value))}/>
      <EffectsEditor label="On every ending" field="onEnd" at={{kind:'scene',field:'onEnd'}} hint="Effects on every ending, before the ending's own (Kell walks with the player after the granary)."/>
      <EffectsEditor label="Afterwards" field="afterwards" world at={{kind:'scene',field:'afterwards'}} hint="World ops applied to the place as the scene ends, whatever the ending (the body taken away)."/>
      <LoreLinks label="Fronts" field="fronts" hint="The GM-only fronts doc for this scene's world." paths={doc.fronts?[doc.fronts]:[]} names={loreNames} onOpen={openLore} onUnlink={()=>set('fronts',undefined)} addLabel={doc.fronts?'Choose another':'Choose the fronts doc'} onAdd={()=>pickLore({title:'The fronts doc',kinds:['world','note'],linked:doc.fronts?[doc.fronts]:[],onPick:path=>set('fronts',path)})}/>
      {talk&&<TextField label="Companion" field="companion" hint="The talk template's: the companion's cast id ({companion})." value={doc.companion??''} onChange={value=>set('companion',optionalText(value))}/>}
    </Group>
    <Group title="Lore" anchor="scene-lore" field="lore-group">
      <LoreLinks label="The GM's always-in docs" field="lore" hint="Notes about this place and its world, under the campaign's lore/." paths={doc.lore} names={loreNames} onOpen={openLore} onUnlink={path=>set('lore',doc.lore.filter(other=>other!==path))} onAdd={()=>pickLore({title:'Lore for the scene',linked:doc.lore,onPick:linkLore})}/>
    </Group>
  </div>;
}

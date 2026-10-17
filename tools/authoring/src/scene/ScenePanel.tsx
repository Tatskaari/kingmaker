// The scene itself: its prep, when and where, what's true here, its facts, its story wiring and its lore.
import React,{useId,useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {useScene} from './api.ts';
import {Checkbox,ListField,LoreLinks,SelectField,TextArea,TextField,Section} from './fields.tsx';
import {EffectsEditor,WorldOpsEditor} from './effects.tsx';
import type {EffectData} from './effects.tsx';
import {effectChoices} from './inspectors.tsx';
import {addFact,optionalList,optionalText,removeFact,setSceneField,settlersOf,slugOf,titleOf} from './model.ts';

const TIMES=['morning','afternoon','evening','night','next-morning'];

export function ScenePanel(){
  const {doc,edit,campaign,loreNames,openLore,pickLore}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setSceneField(scene,key,value));
  const text=(key:'clock'|'overtaken')=>doc[key]??'';
  const list=(key:'limits'|'known'|'background'|'assumes')=>doc[key]??[];
  const scenes=(campaign?.scenes??[]).filter(scene=>scene.id!==campaign?.talk&&scene.id!==doc.id).map(scene=>({value:scene.id,label:`${scene.title} (${scene.id})`}));
  const places=(campaign?.places??[]).map(place=>({value:place.key,label:`${place.name} (${place.key})`}));
  const choices=effectChoices(doc,campaign?.quests??{});
  const linkLore=(path:string)=>edit(scene=>scene.lore.includes(path)?scene:setSceneField(scene,'lore',[...scene.lore,path]));
  return <div className="scene-panel">
    <Section title="The scene" field="prep">
      <TextField label="Id" field="id" readOnly hint="The scene's id is its file's name. Game state keys on it: never rename a played scene." value={doc.id}/>
      <TextField label="Title" field="title" value={doc.title} onChange={value=>set('title',value)}/>
      <TextField label="Description" field="description" hint="One line for listings and the map." value={doc.description} onChange={value=>set('description',value)}/>
      <TextArea label="Hook" field="hook" rows={4} hint="What the player knows walking in: the player sees this." value={doc.hook} onChange={value=>set('hook',value)}/>
      <TextArea label="Setting" field="setting" rows={5} hint="Where and when, in sensory detail." value={doc.setting} onChange={value=>set('setting',value)}/>
      <TextArea label="Premise" field="premise" rows={2} hint="The dramatic question the scene answers, in a line." value={doc.premise} onChange={value=>set('premise',value)}/>
      <TextArea label="Truth" field="truth" rows={6} hint="What really happened, behind the screen: never said outright, it comes out through the discoveries' paths." value={doc.truth} onChange={value=>set('truth',value)}/>
      <TextArea label="Clock" field="clock" rows={3} hint="What happens if the player dawdles: the pressure, and its outer limit." value={text('clock')} onChange={value=>set('clock',optionalText(value))}/>
    </Section>
    <Section title="When and where" field="when">
      <div className="field-row">
        <SelectField label="Time" field="time" value={doc.time??''} options={[{value:'',label:'Not set'},...TIMES.map(time=>({value:time,label:time}))]} onChange={value=>set('time',optionalText(value))}/>
        <SelectField label="Rest" field="rest" hint="A rest before it." value={doc.rest??''} options={[{value:'',label:'None'},{value:'short',label:'Short'},{value:'long',label:'Long'}]} onChange={value=>set('rest',optionalText(value))}/>
      </div>
      <SelectField label="Place" field="place" hint="The place's world (places/<key>.kmplace): its areas, things and who stands where." value={doc.place??''} options={[{value:'',label:'None'},...places]} onChange={value=>set('place',optionalText(value))}/>
      <Checkbox label="Interlude" field="interlude" hint="Downtime between scenes, standing in for the map: the story skips it." checked={!!doc.interlude} onChange={checked=>set('interlude',checked?true:undefined)}/>
      <Checkbox label="Milestone" field="milestone" checked={!!doc.milestone} onChange={checked=>set('milestone',checked?true:undefined)}/>
    </Section>
    <Section title="What's true here" field="world">
      <ListField label="Limits" field="limits" addLabel="Add a limit" rows={3} hint="Tempting things that don't exist or can't work here, so the GM can say “no, but” honestly." items={list('limits')} onChange={items=>set('limits',optionalList(items))}/>
      <ListField label="Known" field="known" addLabel="Add what locals know" hint="What any local knows and a newcomer wouldn't. Never a secret." items={list('known')} onChange={items=>set('known',optionalList(items))}/>
    </Section>
    <Section title="Facts" field="facts" count={Object.keys(doc.facts??{}).length}>
      <FactsEditor/>
    </Section>
    <Section title="Story" field="story">
      <ListField label="Background" field="background" addLabel="Add a fact carried in" hint="Facts carried in from earlier scenes." items={list('background')} onChange={items=>set('background',optionalList(items))}/>
      <ListField label="Assumes" field="assumes" addLabel="Add an assumption" hint="What the prep takes for granted." items={list('assumes')} onChange={items=>set('assumes',optionalList(items))}/>
      <SelectField label="Overtaken" field="overtaken" hint="Where the story goes instead if play has overtaken what it assumes." value={text('overtaken')} options={[{value:'',label:'Nowhere'},...scenes]} onChange={value=>set('overtaken',optionalText(value))}/>
      <EffectsEditor label="On every ending" field="onEnd" hint="Effects on every ending, before the ending's own." effects={(doc.onEnd??[]) as EffectData[]} choices={choices} onChange={effects=>set('onEnd',optionalList(effects))}/>
      <WorldOpsEditor label="Afterwards" field="afterwards" hint="World ops applied to the place as the scene ends, whatever the ending." ops={(doc.afterwards??[]) as EffectData[]} onChange={ops=>set('afterwards',optionalList(ops))}/>
      <LoreLinks label="Fronts" field="fronts" hint="The GM-only fronts doc for this scene's world." paths={doc.fronts?[doc.fronts]:[]} names={loreNames} onOpen={openLore} onUnlink={()=>set('fronts',undefined)} addLabel={doc.fronts?'Choose another':'Choose the fronts doc'} onAdd={()=>pickLore({title:'The fronts doc',kinds:['world','note'],linked:doc.fronts?[doc.fronts]:[],onPick:path=>set('fronts',path)})}/>
      {doc.companion!==undefined&&<TextField label="Companion" field="companion" hint="The talk template's: the companion's cast id." value={doc.companion} onChange={value=>set('companion',value)}/>}
    </Section>
    <Section title="Lore" field="lore" count={doc.lore.length}>
      <LoreLinks label="The GM's always-in docs" field="lore" paths={doc.lore} names={loreNames} onOpen={openLore} onUnlink={path=>set('lore',doc.lore.filter(other=>other!==path))} onAdd={()=>pickLore({title:'Lore for the scene',linked:doc.lore,onPick:linkLore})}/>
    </Section>
  </div>;
}

/** The scene's facts: each an id (made once, never changed) and the sentence the GM is told when it's settled. */
function FactsEditor(){
  const {doc,edit,confirm}=useScene();
  const sentenceId=useId();
  const [id,setId]=useState(''),[sentence,setSentence]=useState('');
  const facts=Object.entries(doc.facts??{});
  const add=()=>{if(!sentence.trim()&&!id.trim())return;edit(scene=>addFact(scene,id||sentence,sentence).doc);setId('');setSentence('')};
  const remove=(fact:string)=>{
    const settlers=settlersOf(doc,fact);
    confirm({title:'Remove fact?',confirmLabel:'Remove fact',description:`Remove the fact ${fact}?${settlers.length?` ${settlers.map(where=>titleOf(doc,where)).join(', ')} settle${settlers.length===1?'s':''} it, and won't any more.`:''} An effect that tests it will be named in the problems. You can undo this.`,onConfirm:()=>edit(scene=>removeFact(scene,fact))});
  };
  return <div className="facts" data-field="facts">
    {!facts.length&&<p className="muted">No facts yet. A fact is settled by a beat or a route, and endings' effects test it.</p>}
    {facts.map(([fact,text])=>{const settlers=settlersOf(doc,fact);return <article className="fact" key={fact}>
      <header><code>{fact}</code><button type="button" title={`Remove fact ${fact}`} aria-label={`Remove fact ${fact}`} onClick={()=>remove(fact)}><Trash2 size={13}/></button></header>
      <TextArea label={`Fact ${fact}`} rows={2} value={text} onChange={value=>edit(scene=>setSceneField(scene,'facts',{...(scene.facts??{}),[fact]:value}))}/>
      <small className="field-hint">{settlers.length?`Settled by ${settlers.map(where=>titleOf(doc,where)).join(', ')}.`:'Nothing settles it yet.'}</small>
    </article>})}
    <div className="new-fact">
      <label className="field-label" htmlFor={sentenceId}>New fact</label>
      <textarea id={sentenceId} rows={2} placeholder="The sentence the GM is told when it's settled" value={sentence} onChange={event=>setSentence(event.target.value)}/>
      <input aria-label="New fact id" placeholder={`Its id (${slugOf(sentence).slice(0,24)||'a-slug'})`} value={id} onChange={event=>setId(event.target.value)}/>
      <button type="button" className="add-item" onClick={add}><Plus size={13}/>Add fact</button>
    </div>
  </div>;
}

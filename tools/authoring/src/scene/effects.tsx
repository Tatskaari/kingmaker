// Effects: an ending's, the scene's onStart and onEnd, and its afterwards (world ops alone, and no conditions). Every
// op the format has is a form (the story's, the world's and the fight's set-up), with its conditions on
// the scene's facts picked from them or made new; anything the form doesn't show is named, and any
// effect can be edited as JSON, kept only once it's whole.
import React,{useContext,useEffect,useId,useMemo,useState} from 'react';
import {Braces,ListChecks,Plus} from 'lucide-react';
import {useScene} from './api.ts';
import type {EffectsAt} from './api.ts';
import {AddPicker,Chips,EditSession,ItemCard,ListField,NumberField,SelectField,TextArea,TextField,moved} from './fields.tsx';
import type {Option} from './fields.tsx';
import {FactAdder,FactRows} from './facts.tsx';
import {EFFECT_ORDER,addFact,conditionOf,factsIn,optionalList,setNodeField,setSceneField,withKey} from './model.ts';
import type {ConditionKey,EffectLike,EndingData,SceneDocument} from './model.ts';

/** An effect as the file has it: an op and its fields (shared/scene/files.ts Effect), kept whole. */
export type EffectData=EffectLike;


type FieldKind='text'|'prose'|'person'|'party'|'quest'|'step'|'attitude'|'target'|'how'|'thing-kind'|'bleed'|'number'|'states'|'people'|'enemies';
type FieldSpec={key:string;label:string;kind:FieldKind;optional?:boolean;hint?:string};
type OpSpec={label:string;group:'The story'|'The world'|'A fight';detail:string;fields:FieldSpec[]};

const who:FieldSpec={key:'who',label:'Who',kind:'person'};
const what=(label='What',hint='What it acts on: a person of the cast, a thing or a part of the place, by its id.'):FieldSpec=>({key:'what',label,kind:'target',hint});

/** Every op an effect may have, its fields in the order the campaign's files have them. */
export const OPS:Record<string,OpSpec>={
  quest:{label:'Quest',group:'The story',detail:'A step in one of the campaign\'s quests: start, advance, complete or fail it.',fields:[{key:'quest',label:'Quest',kind:'quest'},{key:'do',label:'Step',kind:'step'},{key:'title',label:'Quest title',kind:'text',optional:true,hint:'When it starts: the title the journal shows.'},{key:'stage',label:'Stage',kind:'text',optional:true,hint:'A name for where the quest has got to.'},{key:'text',label:'Journal text',kind:'prose'}]},
  flag:{label:'Flag',group:'The story',detail:'A story flag set to a value, for later scenes to read.',fields:[{key:'name',label:'Flag name',kind:'text'},{key:'value',label:'Flag value',kind:'text'}]},
  attitude:{label:'Attitude',group:'The story',detail:'How someone feels about the player from now on.',fields:[who,{key:'to',label:'Attitude',kind:'attitude'},{key:'text',label:'Text',kind:'prose',hint:'Why: what the player did.'}]},
  remember:{label:'Remember',group:'The story',detail:'Something someone remembers of how it went.',fields:[who,{key:'text',label:'What they remember',kind:'prose'}]},
  journal:{label:'Journal',group:'The story',detail:'A line in the player\'s journal.',fields:[{key:'text',label:'Text',kind:'prose'}]},
  follow:{label:'Follow',group:'The story',detail:'Someone walks with the player between scenes from now on.',fields:[who]},
  promise:{label:'Promise',group:'The story',detail:'A promise made, by whom to whom.',fields:[{key:'by',label:'Promised by',kind:'party'},{key:'to',label:'Promised to',kind:'party'},{key:'text',label:'The promise',kind:'prose'}]},
  move:{label:'Move',group:'The world',detail:'Someone or something goes somewhere.',fields:[what('What moves'),{key:'to',label:'Where to',kind:'target'},{key:'how',label:'How',kind:'how',optional:true},{key:'feet',label:'Feet',kind:'number',optional:true,hint:'How far, away from or toward it.'}]},
  place:{label:'Place',group:'The world',detail:'Something is put somewhere, in relation to something.',fields:[what(),{key:'to',label:'Where',kind:'target'},{key:'how',label:'How',kind:'how',optional:true},{key:'feet',label:'Feet',kind:'number',optional:true,hint:'How far, away from or toward it.'}]},
  give:{label:'Give',group:'The world',detail:'Something changes hands.',fields:[what(),{key:'to',label:'To whom',kind:'target'},{key:'quantity',label:'How many',kind:'number',optional:true,hint:'Of a stack; all of it when empty.'}]},
  drop:{label:'Drop',group:'The world',detail:'Something is dropped, where its holder is or near something.',fields:[what(),{key:'to',label:'Near',kind:'target',optional:true},{key:'quantity',label:'How many',kind:'number',optional:true,hint:'Of a stack; all of it when empty.'}]},
  create:{label:'Create',group:'The world',detail:'Something new is here.',fields:[{key:'name',label:'Name',kind:'text'},{key:'kind',label:'Kind',kind:'thing-kind'},{key:'to',label:'Near',kind:'target',optional:true},{key:'how',label:'In their hands',kind:'how',optional:true},{key:'text',label:'A note on it',kind:'prose',optional:true},{key:'add',label:'States',kind:'states',optional:true}]},
  state:{label:'State',group:'The world',detail:'Something gains or loses states (lit, open, burning…).',fields:[what(),{key:'add',label:'States it gains',kind:'states',optional:true},{key:'remove',label:'States it loses',kind:'states',optional:true},{key:'text',label:'A note',kind:'prose',optional:true}]},
  note:{label:'Note',group:'The world',detail:'A note on something, for the GM to see there.',fields:[what(),{key:'to',label:'Also on',kind:'target',optional:true},{key:'text',label:'The note',kind:'prose'}]},
  forget:{label:'Forget',group:'The world',detail:'Notes on something that have stopped being true.',fields:[what(),{key:'text',label:'Notes containing',kind:'prose',optional:true,hint:'All but the rules\' notes when empty.'}]},
  remove:{label:'Remove',group:'The world',detail:'Someone or something leaves the place.',fields:[what('Who or what leaves'),{key:'text',label:'Where they went, or why',kind:'prose',optional:true}]},
  destroy:{label:'Destroy',group:'The world',detail:'Something is destroyed.',fields:[what(),{key:'text',label:'What\'s left',kind:'prose',optional:true}]},
  break:{label:'Break',group:'The world',detail:'Something is broken (and what it held falls out).',fields:[what(),{key:'text',label:'What\'s left',kind:'prose',optional:true}]},
  ignite:{label:'Ignite',group:'The world',detail:'Something catches fire.',fields:[what()]},
  douse:{label:'Douse',group:'The world',detail:'A fire is put out.',fields:[what()]},
  chill:{label:'Chill',group:'The world',detail:'Something is chilled or frozen.',fields:[what()]},
  bleed:{label:'Bleed',group:'The world',detail:'Someone bleeds.',fields:[what('Who'),{key:'how',label:'How badly',kind:'bleed',optional:true}]},
  spill:{label:'Spill',group:'The world',detail:'A liquid spills (water, oil, spirits, ale, blood or grease).',fields:[what('What\'s spilled','What spills, in words with the liquid in them (“a jug of oil”).'),{key:'to',label:'Where',kind:'target',optional:true},{key:'feet',label:'Feet',kind:'number',optional:true,hint:'How far it spreads.'}]},
  startFight:{label:'Start a fight',group:'A fight',detail:'A combat ending\'s set-up: who fights the player, their allies and where. Recorded for when fights are built.',fields:[{key:'enemies',label:'Enemies',kind:'enemies'},{key:'allies',label:'Allies',kind:'people',optional:true},{key:'at',label:'Where',kind:'target',optional:true,hint:'A part or a thing of the place, by its id: where it breaks out.'}]},
};
const WORLD_OPS=Object.keys(OPS).filter(op=>OPS[op].group==='The world');
const QUEST_STEPS=['start','advance','complete','fail'];
const ATTITUDES=['hostile','unfriendly','wary','neutral','friendly','devoted'];
const HOWS=['near','behind','beside','under','on','in','away','toward'];
const THING_KINDS=['object','item','feature','person','creature'];

/** What an effect's fields choose from: the cast, the campaign's quests, and what a world op can name. */
type Choices={cast:Option[];quests:Option[];targets:Option[]};

/** A new effect of an op: the fields its form needs, filled where there's an obvious first choice (shown, and changeable). */
function newEffect(op:string,choices:Choices):EffectData{
  const first=choices.cast[0]?.value??'';
  if(op==='quest')return {op,quest:choices.quests[0]?.value??'',do:'advance',text:''};
  if(op==='flag')return {op,name:'',value:''};
  if(op==='attitude')return {op,who:first,to:'friendly',text:''};
  if(op==='remember')return {op,who:first,text:''};
  if(op==='journal')return {op,text:''};
  if(op==='follow')return {op,who:first};
  if(op==='promise')return {op,by:'$player',to:first,text:''};
  if(op==='startFight')return {op,enemies:[]};
  if(op==='create')return {op,name:'',kind:'object'};
  if(op==='give')return {op,what:'',to:'$player'};
  if(op==='note')return {op,what:'',text:''};
  return {op,what:''};
}

/** An effect's op changed: a new one of that op, keeping what the two ops share (who, what, the text: a field of the same kind in both) and its conditions. */
function withOp(effect:EffectData,op:string,choices:Choices):EffectData{
  let next=newEffect(op,choices);
  const before=new Map((OPS[effect.op]?.fields??[]).map(field=>[field.key,field.kind]));
  for(const field of OPS[op]?.fields??[])if(effect[field.key]!==undefined&&before.get(field.key)===field.kind)next=withKey(next,field.key,effect[field.key],EFFECT_ORDER);
  for(const key of ['if','unless'])if(effect[key]!==undefined)next=withKey(next,key,effect[key],EFFECT_ORDER);
  return next;
}

/** Why a value can't be an effect, or undefined when it can: an object with an op. */
export function effectProblem(value:unknown):string|undefined{
  if(!value||typeof value!=='object'||Array.isArray(value))return 'An effect is a JSON object.';
  if(typeof (value as {op?:unknown}).op!=='string'||!(value as {op:string}).op)return 'An effect needs an "op".';
  return undefined;
}

/** Why a value can't be a world op of afterwards, or undefined when it can: an object with an op and what it acts on. */
export function worldOpProblem(value:unknown):string|undefined{
  const problem=effectProblem(value);
  if(problem)return problem;
  const what=(value as {what?:unknown}).what;
  return typeof what==='string'&&what?undefined:'It\'s saved once it says what it acts on.';
}

/**
 * The effects at `at`: each a card (its op's form, its conditions, move up and down, remove) and
 * [+ Add effect]. Afterwards (`world`) has world ops alone, without conditions: the game applies them
 * whatever the ending. Something new that the file can't hold yet (a world op of afterwards that doesn't
 * say what it acts on, JSON that isn't whole) is a draft under the list until it can.
 */
export function EffectsEditor({label,hint,field,at,world=false}:{label:string;hint?:string;field:string;at:EffectsAt;world?:boolean}){
  const {doc,edit,campaign,place}=useScene();
  const [draft,setDraft]=useState<{effect:EffectData;json:boolean}|null>(null);
  const get=(scene:SceneDocument):EffectData[]=>(at.kind==='node'?(scene.nodes.find(node=>node.id===at.id)?.data as EndingData|undefined)?.effects:scene[at.field])as EffectData[]|undefined??[];
  const put=(scene:SceneDocument,effects:EffectData[])=>at.kind==='node'?setNodeField(scene,at.id,'effects',optionalList(effects)):setSceneField(scene,at.field,optionalList(effects));
  const effects=get(doc);
  const choices=useMemo(()=>choicesOf(doc,campaign?.quests??{},place),[doc,campaign,place]);
  const update=(index:number,change:(effect:EffectData)=>EffectData)=>edit(scene=>put(scene,get(scene).map((effect,i)=>i===index?change(effect):effect)));
  const createFact=(index:number,key:ConditionKey,id:string,sentence:string)=>edit(scene=>{
    const added=addFact(scene,id,sentence);
    return put(added.doc,get(added.doc).map((effect,i)=>i===index?setCondition(effect,key,[...factsIn(effect[key]),added.id]):effect));
  });
  const valid=world?worldOpProblem:effectProblem;
  const ops=world?WORLD_OPS:Object.keys(OPS);
  const add=(op:string)=>{
    if(op==='json'){setDraft({effect:{op:''},json:true});return}
    const effect=newEffect(op,choices);
    if(valid(effect))setDraft({effect,json:false});
    else edit(scene=>put(scene,[...get(scene),effect]));
  };
  const draftChange=(effect:EffectData)=>{
    if(valid(effect))setDraft(old=>old&&{...old,effect});
    else{setDraft(null);edit(scene=>put(scene,[...get(scene),effect]))}
  };
  const options:Option[]=[...ops.map(op=>({value:op,label:OPS[op].label,detail:`${OPS[op].group}: ${OPS[op].detail}`})),{value:'json',label:'Another op, as JSON',detail:'For an op this editor has no form for: kept once it\'s an object with an op.'}];
  // The draft is the list's last card, keyed as the card it becomes once it's saved, so typing goes on in the same fields.
  const cards=[...effects.map((effect,index)=>({effect,index,draft:false})),...(draft?[{effect:draft.effect,index:effects.length,draft:true}]:[])];
  return <fieldset className="effects" data-field={field}>
    <legend className="field-label">{label}<span className="count">{effects.length}</span></legend>
    {!cards.length&&<p className="muted">None.</p>}
    {cards.map(({effect,index,draft:isDraft})=><ItemCard key={index} index={index} count={cards.length} field={isDraft?undefined:`${field}.${index}`} className={`effect${isDraft?' draft':''}`} label={isDraft?`New ${label.toLowerCase()}`:`${label} ${index+1}`}
      title={`${isDraft?'New: ':''}${OPS[effect.op]?.label??(effect.op||'an op, as JSON')}`} badges={<ConditionBadges effect={effect}/>} removeLabel={isDraft?'Discard':'Remove effect'}
      onMove={isDraft?undefined:by=>edit(scene=>put(scene,moved(get(scene),index,by)))} onRemove={isDraft?()=>setDraft(null):()=>edit(scene=>put(scene,get(scene).filter((_,i)=>i!==index)))}>
      {isDraft&&<p className="draft-note">{valid(effect)} Not saved yet.</p>}
      <EffectForm effect={effect} choices={choices} world={world} validate={valid} startRaw={isDraft&&draft?.json} onChange={isDraft?draftChange:next=>update(index,()=>next)}
        onCondition={(key,facts)=>{if(!isDraft)update(index,old=>setCondition(old,key,facts))}} onNewFact={(key,id,sentence)=>{if(!isDraft)createFact(index,key,id,sentence)}}/>
    </ItemCard>)}
    {!draft&&<AddPicker label={world?'Add world op':'Add effect'} title={world?'Add a world op':'Add an effect'} options={options} onPick={add}/>}
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

/** What a card's header says of its conditions. */
function ConditionBadges({effect}:{effect:EffectData}){
  const only=factsIn(effect.if),unless=factsIn(effect.unless);
  if(!only.length&&!unless.length)return null;
  return <span className="condition-badge" title={[only.length?`Only if ${only.join(', ')}`:'',unless.length?`Unless ${unless.join(', ')}`:''].filter(Boolean).join('; ')}>{only.length?'if':''}{only.length&&unless.length?' · ':''}{unless.length?'unless':''}</span>;
}

/** An effect with a condition set to these facts (none takes the condition out). */
function setCondition(effect:EffectData,key:ConditionKey,facts:string[]):EffectData{
  return withKey(effect,key,conditionOf(facts),EFFECT_ORDER);
}

/** What a world op can name, and the people and quests the story's ops choose from. */
function choicesOf(doc:SceneDocument,quests:Record<string,string>,place:{name:string;areas:Array<{id:string;name:string}>;things:Array<{id:string;name:string}>}|undefined):Choices{
  const cast=doc.cast.map(member=>({value:member.id,label:`${member.name||member.id} (${member.id})`}));
  const carried=[...new Set(doc.nodes.flatMap(node=>node.data.kind==='beat'?node.data.carry?.things??[]:[]))];
  return {
    cast,
    quests:Object.entries(quests).map(([id,title])=>({value:id,label:`${title} (${id})`})),
    targets:[
      {value:'$player',label:'the player'},
      ...doc.cast.map(member=>({value:member.id,label:member.name||member.id})),
      ...(place?.areas??[]).map(area=>({value:area.id,label:`${area.name} (part of ${place!.name})`})),
      ...(place?.things??[]).map(thing=>({value:thing.id,label:`${thing.name} (a thing)`})),
      ...carried.filter(id=>!place?.things.some(thing=>thing.id===id)).map(id=>({value:id,label:'carried into the scene'})),
    ],
  };
}

/** One effect: its op's form and its conditions; or its JSON (the only way for an op there's no form for). */
function EffectForm({effect,choices,world,validate,onChange,onCondition,onNewFact,startRaw=false}:{effect:EffectData;choices:Choices;world:boolean;validate:(value:unknown)=>string|undefined;onChange:(effect:EffectData)=>void;onCondition:(key:ConditionKey,facts:string[])=>void;onNewFact:(key:ConditionKey,id:string,sentence:string)=>void;startRaw?:boolean}){
  const [raw,setRaw]=useState(startRaw||!(effect.op in OPS));
  const spec=OPS[effect.op];
  if(raw||!spec)return <>
    <RawJson value={effect} validate={validate} onChange={value=>onChange(value as EffectData)}/>
    {spec&&<button type="button" className="text-button" onClick={()=>setRaw(false)}><ListChecks size={12}/>Edit as a form</button>}
  </>;
  const shown=new Set(['op',...spec.fields.map(field=>field.key),...(world?[]:['if','unless'])]);
  const others=Object.keys(effect).filter(key=>!shown.has(key));
  const ops=(world?WORLD_OPS:Object.keys(OPS)).map(op=>({value:op,label:`${OPS[op].label} (${OPS[op].group.toLowerCase()})`}));
  return <div className="effect-form">
    <SelectField label="Op" field="op" value={effect.op} options={ops} hint={spec.detail} onChange={op=>onChange(withOp(effect,op,choices))}/>
    {spec.fields.map(field=><EffectField key={field.key} spec={field} effect={effect} choices={choices} onChange={onChange}/>)}
    {!world&&<Conditions effect={effect} onCondition={onCondition} onNewFact={onNewFact}/>}
    {others.length>0&&<p className="field-hint">It also has {others.map(key=><code key={key}>{key}</code>)}, which the form doesn't show: edit it as JSON to change {others.length===1?'it':'them'}.</p>}
    <button type="button" className="text-button" onClick={()=>setRaw(true)}><Braces size={12}/>Edit as JSON</button>
  </div>;
}

/** One field of an effect's form. An optional one left empty is taken out. */
function EffectField({spec,effect,choices,onChange}:{spec:FieldSpec;effect:EffectData;choices:Choices;onChange:(effect:EffectData)=>void}){
  const listId=useId();
  const set=(value:unknown)=>onChange(withKey(effect,spec.key,value,EFFECT_ORDER));
  const text=typeof effect[spec.key]==='string'?effect[spec.key] as string:'';
  const setText=(value:string)=>set(spec.optional&&!value.trim()?undefined:value);
  const {key,label,hint}=spec;
  const parties=[{value:'$player',label:'The player'},...choices.cast];
  switch(spec.kind){
    case 'text':return <TextField label={label} field={key} hint={hint} value={text} onChange={setText}/>;
    case 'prose':return <TextArea label={label} field={key} hint={hint} rows={2} value={text} onChange={setText}/>;
    case 'person':return <SelectField label={label} field={key} hint={hint} value={text} options={choices.cast} placeholder="Choose someone…" onChange={set}/>;
    case 'party':return <SelectField label={label} field={key} hint={hint} value={text} options={parties} onChange={set}/>;
    case 'quest':return <SelectField label={label} field={key} hint={hint??'One of the scenario\'s quests.'} value={text} options={choices.quests} placeholder="Choose a quest…" onChange={set}/>;
    case 'step':return <SelectField label={label} field={key} value={text} options={QUEST_STEPS.map(step=>({value:step,label:step}))} onChange={set}/>;
    case 'attitude':return <SelectField label={label} field={key} value={text} options={ATTITUDES.map(attitude=>({value:attitude,label:attitude}))} onChange={set}/>;
    case 'thing-kind':return <SelectField label={label} field={key} value={text} options={THING_KINDS.map(kind=>({value:kind,label:kind}))} onChange={set}/>;
    case 'how':return effect.op==='create'
      ?<SelectField label={label} field={key} hint="Made in the hands of who it's near." value={text} options={[{value:'',label:'No: beside them'},{value:'in',label:'Yes'}]} onChange={value=>set(value||undefined)}/>
      :<SelectField label={label} field={key} hint="Near, when it's empty." value={text} options={[{value:'',label:'(near)'},...HOWS.map(how=>({value:how,label:how}))]} onChange={value=>set(value||undefined)}/>;
    case 'bleed':return <SelectField label={label} field={key} value={text} options={[{value:'',label:'Heavily'},{value:'light',label:'Lightly'}]} onChange={value=>set(value||undefined)}/>;
    case 'target':return <>
      <datalist id={listId}>{choices.targets.map(option=><option key={`${option.value}:${option.label}`} value={option.value}>{option.label}</option>)}</datalist>
      <TextField label={label} field={key} hint={hint} list={listId} value={text} onChange={setText}/>
    </>;
    case 'number':return <NumberField label={label} field={key} hint={hint} optional min={0} max={500} value={typeof effect[key]==='number'?effect[key] as number:undefined} onChange={set}/>;
    case 'states':return <ListField label={label} field={key} rows={1} addLabel="Add a state" items={Array.isArray(effect[key])?(effect[key] as unknown[]).map(String):[]} onChange={items=>set(spec.optional?optionalList(items):items)}/>;
    case 'people':{
      const people=Array.isArray(effect[key])?(effect[key] as unknown[]).map(String):[];
      return <div className="field" data-field={key}>
        <span className="field-label">{label}</span>
        <Chips label={label} items={people.map(id=>({value:id,label:choices.cast.find(option=>option.value===id)?.label??id}))} empty="Nobody." onRemove={id=>{const rest=people.filter(other=>other!==id);set(spec.optional?optionalList(rest):rest)}}/>
        <AddPicker label="Add person" title={`Add to ${label.toLowerCase()}`} options={choices.cast.filter(option=>!people.includes(option.value))} empty="Everyone of the cast is here already." onPick={id=>set([...people,id])}/>
      </div>;
    }
    case 'enemies':return <EnemiesField effect={effect} choices={choices} onChange={set}/>;
  }
}

/** A fight's enemies: each a group with a leader of the cast (or none), its statblock and how many. */
function EnemiesField({effect,choices,onChange}:{effect:EffectData;choices:Choices;onChange:(enemies:unknown[])=>void}){
  const enemies=Array.isArray(effect.enemies)?effect.enemies as Array<Record<string,unknown>>:[];
  const set=(index:number,key:string,value:unknown)=>onChange(enemies.map((enemy,i)=>i===index?withKey(enemy,key,value,['asset','count','leader']):enemy));
  return <fieldset className="enemies" data-field="enemies">
    <legend className="field-label">Enemies</legend>
    {!enemies.length&&<p className="muted">Nobody yet.</p>}
    {enemies.map((enemy,index)=><ItemCard key={index} index={index} count={enemies.length} field={`enemies.${index}`} label={`Enemy ${index+1}`} title={`${typeof enemy.count==='number'?enemy.count:1} × ${String(enemy.asset??'?')}`} removeLabel="Remove enemies" onRemove={()=>onChange(enemies.filter((_,i)=>i!==index))}>
      <SelectField label="Led by" value={typeof enemy.leader==='string'?enemy.leader:''} options={[{value:'',label:'Nobody of the cast'},...choices.cast]} onChange={value=>set(index,'leader',value||undefined)}/>
      <div className="field-row">
        <TextField label="Statblock" hint="An SRD statblock id (bandit, guard…)." value={typeof enemy.asset==='string'?enemy.asset:''} onChange={value=>set(index,'asset',value)}/>
        <NumberField label="How many" min={1} max={40} value={typeof enemy.count==='number'?enemy.count:undefined} onChange={value=>set(index,'count',value)}/>
      </div>
    </ItemCard>)}
    <button type="button" className="add-item" onClick={()=>onChange([...enemies,{asset:'bandit',count:1}])}><Plus size={13}/>Add enemies</button>
  </fieldset>;
}

/** An effect's conditions: only if facts are settled, unless they are; each picked from the scene's facts, or made new. */
function Conditions({effect,onCondition,onNewFact}:{effect:EffectData;onCondition:(key:ConditionKey,facts:string[])=>void;onNewFact:(key:ConditionKey,id:string,sentence:string)=>void}){
  const rows:Array<[ConditionKey,string,string]>=[['if','Only if settled','Only if a fact is settled'],['unless','Unless settled','Unless a fact is settled']];
  const always=!factsIn(effect.if).length&&!factsIn(effect.unless).length;
  return <div className="conditions" data-field="conditions">
    <span className="field-label">When</span>
    {always&&<p className="muted">Always, whatever's settled.</p>}
    {rows.map(([key,label,add])=>{
      const facts=factsIn(effect[key]);
      return <div className="condition" data-field={key} key={key}>
        {facts.length>0&&<span className="condition-label">{label}</span>}
        <FactRows label={label} facts={facts} onRemove={id=>onCondition(key,facts.filter(other=>other!==id))}/>
        <FactAdder label={facts.length?'Add fact':add} chosen={facts} onAdd={id=>onCondition(key,[...facts,id])} onCreate={(id,sentence)=>onNewFact(key,id,sentence)}/>
      </div>;
    })}
  </div>;
}

/** A value as JSON to edit: kept only when it parses and passes `validate`; until then the text stays the author's, with what's wrong. */
export function RawJson({value,validate,onChange,label='JSON'}:{value:unknown;validate:(value:unknown)=>string|undefined;onChange:(value:unknown)=>void;label?:string}){
  const session=useContext(EditSession);
  const shown=JSON.stringify(value,null,2);
  const [text,setText]=useState(shown);
  const [problem,setProblem]=useState<string>();
  const id=useId();
  // An undo, or another edit of the same value, shows the value as it now is.
  useEffect(()=>{
    let same=false;
    try{same=JSON.stringify(JSON.parse(text))===JSON.stringify(value)}catch{}
    if(!same){setText(shown);setProblem(undefined)}
  },[shown]);
  const edit=(next:string)=>{
    setText(next);
    let parsed:unknown;
    try{parsed=JSON.parse(next)}catch(error){setProblem(`Not JSON yet: ${(error as Error).message}`);return}
    const wrong=validate(parsed);
    setProblem(wrong);
    if(!wrong)onChange(parsed);
  };
  return <div className="raw-json">
    <label className="field-label" htmlFor={id}>{label}</label>
    <textarea {...session} id={id} className={problem?'invalid':''} aria-invalid={!!problem} spellCheck={false} rows={Math.min(12,Math.max(3,text.split('\n').length))} value={text} onChange={event=>edit(event.target.value)}/>
    {problem&&<small className="json-problem" role="alert">{problem} Not saved until it's fixed.</small>}
  </div>;
}

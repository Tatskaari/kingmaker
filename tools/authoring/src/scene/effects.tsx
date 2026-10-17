// An ending's effects (and a scene's onEnd and afterwards): the story's common ops as forms, anything
// else as JSON, kept only once it's an op the file can hold.
import React,{useContext,useEffect,useId,useState} from 'react';
import {ArrowDown,ArrowUp,Braces,Plus,Trash2} from 'lucide-react';
import {Checklist,EditSession,SelectField,TextArea,TextField} from './fields.tsx';
import type {Option} from './fields.tsx';
import {withKey} from './model.ts';

/** An effect as the file has it: an op and its fields (shared/scene/files.ts Effect), kept whole. */
export type EffectData={op:string;[key:string]:unknown};

/** What an effect's fields choose from: the cast, the scene's facts, the campaign's quests. */
export type EffectChoices={cast:Option[];facts:Option[];quests:Option[]};

/** The story's ops the editor has forms for, each with its fields in the order the campaign's files have them. */
const FORMS:Record<string,string[]>={
  quest:['op','quest','do','title','stage','text','if','unless'],
  flag:['op','name','value','if','unless'],
  attitude:['op','who','to','text','if','unless'],
  remember:['op','who','text','if','unless'],
  journal:['op','text','if','unless'],
  follow:['op','who','if','unless'],
  promise:['op','by','to','text','if','unless'],
};
const OP_LABELS:Record<string,string>={quest:'Quest',flag:'Flag',attitude:'Attitude',remember:'Remember',journal:'Journal',follow:'Follow',promise:'Promise'};
const QUEST_STEPS=['start','advance','complete','fail'];
const ATTITUDES=['hostile','unfriendly','wary','neutral','friendly','devoted'];

/** A new effect of an op, with the fields its form needs. */
function newEffect(op:string,choices:EffectChoices):EffectData{
  const who=choices.cast[0]?.value??'';
  if(op==='quest')return {op,quest:choices.quests[0]?.value??'',do:'advance',text:''};
  if(op==='flag')return {op,name:'',value:''};
  if(op==='attitude')return {op,who,to:'friendly',text:''};
  if(op==='remember')return {op,who,text:''};
  if(op==='journal')return {op,text:''};
  if(op==='follow')return {op,who};
  if(op==='promise')return {op,by:'$player',to:who,text:''};
  return {op:'note',what:'',text:''};
}

/** An effect's facts in a condition (`if` or `unless`): one id or several. */
const factsIn=(condition:unknown):string[]=>{
  const established=(condition as {established?:unknown}|undefined)?.established;
  return typeof established==='string'?[established]:Array.isArray(established)?established.filter((id):id is string=>typeof id==='string'):[];
};
/** A condition on facts as the files write it: one fact as its id, several as a list, none as no condition. */
const conditionOf=(facts:string[])=>facts.length===0?undefined:{established:facts.length===1?facts[0]:facts};

/** The effects of an ending, or of every ending (onEnd): each a form for the common ops, or JSON. */
export function EffectsEditor({label,hint,field,effects,onChange,choices}:{label:string;hint?:string;field?:string;effects:EffectData[];onChange:(effects:EffectData[])=>void;choices:EffectChoices}){
  const [adding,setAdding]=useState('journal');
  const set=(index:number,effect:EffectData)=>onChange(effects.map((old,i)=>i===index?effect:old));
  const move=(index:number,by:number)=>{const next=[...effects];const [item]=next.splice(index,1);next.splice(index+by,0,item);onChange(next)};
  return <fieldset className="effects" data-field={field}>
    <legend className="field-label">{label}</legend>
    {!effects.length&&<p className="muted">None.</p>}
    {effects.map((effect,index)=><article className="effect" key={index} aria-label={`${label} ${index+1}`}>
      <header>
        <span className="effect-number">{index+1}</span>
        <b>{OP_LABELS[effect.op]??effect.op}</b>
        <span className="effect-actions">
          <button type="button" title="Move up" aria-label={`Move effect ${index+1} up`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={13}/></button>
          <button type="button" title="Move down" aria-label={`Move effect ${index+1} down`} disabled={index===effects.length-1} onClick={()=>move(index,1)}><ArrowDown size={13}/></button>
          <button type="button" title="Remove effect" aria-label={`Remove effect ${index+1}`} onClick={()=>onChange(effects.filter((_,i)=>i!==index))}><Trash2 size={13}/></button>
        </span>
      </header>
      <EffectForm effect={effect} choices={choices} onChange={next=>set(index,next)}/>
    </article>)}
    <div className="add-effect">
      <select aria-label={`New ${label.toLowerCase()} op`} value={adding} onChange={event=>setAdding(event.target.value)}>
        {Object.keys(FORMS).map(op=><option key={op} value={op}>{OP_LABELS[op]}</option>)}
        <option value="other">Another op (JSON)</option>
      </select>
      <button type="button" className="add-item" onClick={()=>onChange([...effects,newEffect(adding,choices)])}><Plus size={13}/>Add effect</button>
    </div>
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

/** One effect: its form when the editor has one for its op, else its JSON; either can switch to JSON. */
function EffectForm({effect,choices,onChange}:{effect:EffectData;choices:EffectChoices;onChange:(effect:EffectData)=>void}){
  const [raw,setRaw]=useState(!(effect.op in FORMS));
  if(raw||!(effect.op in FORMS))return <>
    <RawJson value={effect} validate={effectProblem} onChange={value=>onChange(value as EffectData)}/>
    {effect.op in FORMS&&<button type="button" className="text-button" onClick={()=>setRaw(false)}>Edit as a form</button>}
  </>;
  const order=FORMS[effect.op];
  const set=(key:string,value:unknown)=>onChange(withKey(effect,key,value,order));
  const text=(key:string)=>typeof effect[key]==='string'?effect[key] as string:'';
  const optional=(key:string)=>(value:string)=>set(key,value.trim()?value:undefined);
  const people=[...choices.cast];
  const parties=[{value:'$player',label:'The player'},...people];
  return <div className="effect-form">
    <SelectField label="Op" value={effect.op} options={Object.keys(FORMS).map(op=>({value:op,label:OP_LABELS[op]}))} onChange={op=>onChange(withConditions(newEffect(op,choices),effect))}/>
    {effect.op==='quest'&&<>
      <SelectField label="Quest" value={text('quest')} options={choices.quests} onChange={value=>set('quest',value)}/>
      <SelectField label="Step" value={text('do')} options={QUEST_STEPS.map(step=>({value:step,label:step}))} onChange={value=>set('do',value)}/>
      <TextField label="Quest title" hint="When it starts: the title the journal shows." value={text('title')} onChange={optional('title')}/>
      <TextField label="Stage" value={text('stage')} onChange={optional('stage')}/>
      <TextArea label="Journal text" value={text('text')} onChange={value=>set('text',value)}/>
    </>}
    {effect.op==='flag'&&<>
      <TextField label="Flag name" value={text('name')} onChange={value=>set('name',value)}/>
      <TextField label="Flag value" value={text('value')} onChange={value=>set('value',value)}/>
    </>}
    {(effect.op==='attitude'||effect.op==='remember'||effect.op==='follow')&&<SelectField label="Who" value={text('who')} options={people} onChange={value=>set('who',value)}/>}
    {effect.op==='attitude'&&<SelectField label="Attitude" value={text('to')} options={ATTITUDES.map(attitude=>({value:attitude,label:attitude}))} onChange={value=>set('to',value)}/>}
    {effect.op==='promise'&&<>
      <SelectField label="Promised by" value={text('by')} options={parties} onChange={value=>set('by',value)}/>
      <SelectField label="Promised to" value={text('to')} options={parties} onChange={value=>set('to',value)}/>
    </>}
    {['attitude','remember','journal','promise'].includes(effect.op)&&<TextArea label={effect.op==='remember'?'What they remember':effect.op==='promise'?'The promise':'Text'} value={text('text')} onChange={value=>set('text',value)}/>}
    <details className="effect-conditions" open={!!(effect.if||effect.unless)}>
      <summary>Only when…{effect.if||effect.unless?' (conditional)':''}</summary>
      <Checklist label="If established" options={choices.facts} selected={factsIn(effect.if)} empty="The scene has no facts." onChange={facts=>set('if',conditionOf(facts))}/>
      <Checklist label="Unless established" options={choices.facts} selected={factsIn(effect.unless)} empty="The scene has no facts." onChange={facts=>set('unless',conditionOf(facts))}/>
    </details>
    <button type="button" className="text-button" onClick={()=>setRaw(true)}><Braces size={12}/>Edit as JSON</button>
  </div>;
}

/** A new effect keeps the conditions of the one it replaces. */
function withConditions(effect:EffectData,old:EffectData):EffectData{
  const order=FORMS[effect.op]??['op','if','unless'];
  return withKey(withKey(effect,'if',old.if,order),'unless',old.unless,order);
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
  return typeof what==='string'&&what?undefined:'A world op needs "what" it acts on.';
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

/** The scene's afterwards: world ops applied to the place as it ends, each as JSON. A new one is a draft until it's whole (an op, and what it acts on). */
export function WorldOpsEditor({label,hint,field,ops,onChange}:{label:string;hint?:string;field?:string;ops:EffectData[];onChange:(ops:EffectData[])=>void}){
  const [draft,setDraft]=useState(false);
  return <fieldset className="effects" data-field={field}>
    <legend className="field-label">{label}</legend>
    {!ops.length&&!draft&&<p className="muted">None.</p>}
    {ops.map((op,index)=><article className="effect" key={index} aria-label={`${label} ${index+1}`}>
      <header><span className="effect-number">{index+1}</span><b>{op.op}</b><span className="effect-actions"><button type="button" title="Remove" aria-label={`Remove ${label} ${index+1}`} onClick={()=>onChange(ops.filter((_,i)=>i!==index))}><Trash2 size={13}/></button></span></header>
      <RawJson value={op} validate={worldOpProblem} onChange={value=>onChange(ops.map((old,i)=>i===index?value as EffectData:old))}/>
    </article>)}
    {draft&&<article className="effect draft" aria-label={`New ${label.toLowerCase()}`}>
      <header><span className="effect-number">+</span><b>New world op</b><span className="effect-actions"><button type="button" title="Discard" aria-label="Discard the new world op" onClick={()=>setDraft(false)}><Trash2 size={13}/></button></span></header>
      <RawJson value={{op:'remove',what:'',text:''}} validate={worldOpProblem} onChange={value=>{setDraft(false);onChange([...ops,value as EffectData])}}/>
    </article>}
    {!draft&&<button type="button" className="add-item" onClick={()=>setDraft(true)}><Plus size={13}/>Add world op</button>}
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

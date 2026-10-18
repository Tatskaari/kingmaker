// The scene's facts: each an id and the sentence the GM is told once it's settled. Beats and routes
// settle them (establishes); endings' effects test them (if or unless). Here: the facts chosen where
// they're settled or tested, a new one made in place, and the Facts view, with where each is used.
import React,{useId,useState} from 'react';
import type {ReactNode} from 'react';
import {Plus,Trash2,X} from 'lucide-react';
import {useScene} from './api.ts';
import {AddPicker,IdField,TextArea} from './fields.tsx';
import {addFact,connectionId,idProblem,newFactId,nodeKind,removeFact,renameFact,setSceneField,settlesOf,testsOf,titleOf} from './model.ts';
import type {FactTest,SceneDocument} from './model.ts';

/** Facts chosen (a beat's or a route's establishes, an effect's condition): each its id and sentence, opened in the Facts view, removable. */
export function FactRows({label,facts,onRemove}:{label:string;facts:string[];onRemove:(id:string)=>void}){
  const {doc,showFact}=useScene();
  if(!facts.length)return null;
  return <ul className="fact-rows" aria-label={label}>
    {facts.map(id=><li className="fact-row" key={id}>
      <button type="button" className="fact-open" title="Open it in the Facts view" onClick={()=>showFact(id)}><code>{id}</code><span>{doc.facts?.[id]??'Not one of the scene\'s facts.'}</span></button>
      <button type="button" className="chip-remove" aria-label={`Remove ${id}`} title={`Remove ${id}`} onClick={()=>onRemove(id)}><X size={12}/></button>
    </li>)}
  </ul>;
}

/** A new fact, made in place: its sentence, and its id (a slug of the sentence unless one's typed, free among the facts). */
export function NewFactForm({onCreate,label='Or a new fact'}:{onCreate:(id:string,sentence:string)=>void;label?:string}){
  const {doc}=useScene();
  const [sentence,setSentence]=useState(''),[id,setId]=useState('');
  const sentenceId=useId(),idId=useId();
  const final=newFactId(doc,id,sentence);
  const create=()=>{if(sentence.trim())onCreate(final,sentence.trim())};
  return <div className="new-fact" role="group" aria-label="A new fact">
    <span className="field-label">{label}</span>
    <label className="sub-label" htmlFor={sentenceId}>Sentence</label>
    <textarea id={sentenceId} rows={2} placeholder="What the GM is told once it's settled (“Prout didn't hang himself…”)" value={sentence} onChange={event=>setSentence(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();create()}}}/>
    <label className="sub-label" htmlFor={idId}>Id</label>
    <input id={idId} placeholder={final} value={id} spellCheck={false} onChange={event=>setId(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();create()}}}/>
    <small className="field-hint">Its id will be <code>{final}</code>: effects test it by that, and game state keeps it.</small>
    <button type="button" className="primary" disabled={!sentence.trim()} onClick={create}><Plus size={13}/>Add new fact</button>
  </div>;
}

/** [+ Add fact]: the scene's facts not chosen yet, or a new one made there and then. */
export function FactAdder({label,chosen,onAdd,onCreate}:{label:string;chosen:string[];onAdd:(id:string)=>void;onCreate:(id:string,sentence:string)=>void}){
  const {doc}=useScene();
  const options=Object.entries(doc.facts??{}).filter(([id])=>!chosen.includes(id)).map(([id,sentence])=>({value:id,label:id,detail:sentence}));
  return <AddPicker label={label} title={label==='Add fact'?'Add a fact':label} options={options} onPick={onAdd} empty={Object.keys(doc.facts??{}).length?'Every fact of the scene is here already.':'The scene has no facts yet.'}>
    {close=><NewFactForm onCreate={(id,sentence)=>{onCreate(id,sentence);close()}}/>}
  </AddPicker>;
}

/**
 * The facts a beat or a route settles: each a row, removable, and [+ Add fact] (one of the scene's, or
 * a new one). `set` writes the list into a scene (an empty one is taken out), so making a fact and
 * settling it here are one edit, one step of undo.
 */
export function FactsField({label='Facts settled here',field='establishes',hint,facts,set}:{label?:string;field?:string;hint?:ReactNode;facts:string[];set:(scene:SceneDocument,facts:(old:string[])=>string[])=>SceneDocument}){
  const {edit}=useScene();
  return <div className="facts-field" data-field={field}>
    <span className="field-label">{label}<span className="count">{facts.length}</span></span>
    {!facts.length&&<p className="muted">None.</p>}
    <FactRows label={label} facts={facts} onRemove={id=>edit(scene=>set(scene,old=>old.filter(other=>other!==id)))}/>
    <FactAdder label="Add fact" chosen={facts} onAdd={id=>edit(scene=>set(scene,old=>[...old,id]))} onCreate={(id,sentence)=>edit(scene=>{const added=addFact(scene,id,sentence);return set(added.doc,old=>[...old,added.id])})}/>
    {hint&&<small className="field-hint">{hint}</small>}
  </div>;
}

/** The Facts view: every fact with its sentence, where it's settled and where it's tested (each opens), renamed or removed; and a new one. */
export function FactsView(){
  const {doc}=useScene();
  const facts=Object.entries(doc.facts??{});
  return <div className="view-content facts-view">
    <header className="view-header">
      <h2>Facts</h2>
      <p className="view-lede">A fact is a sentence the GM is told once it's settled. A beat settles it when it's reached, a route when it's taken (a roll's on a success), and an ending's effects test it, to do one thing or another. Each fact says where.</p>
    </header>
    {!facts.length&&<p className="muted">No facts yet.</p>}
    {facts.map(([id,sentence])=><FactCard key={id} id={id} sentence={sentence}/>)}
    <AddFact/>
  </div>;
}

function FactCard({id,sentence}:{id:string;sentence:string}){
  const {doc,edit,confirm,showFact}=useScene();
  const settles=settlesOf(doc,id),tests=testsOf(doc,id);
  const remove=()=>confirm({title:'Remove fact?',confirmLabel:'Remove fact',onConfirm:()=>edit(scene=>removeFact(scene,id)),description:[
    `Remove the fact ${id}?`,
    settles.length?`${settles.map(where=>where.kind==='node'?titleOf(doc,where.id):doc.edges.find(route=>route.id===where.id)?.label||where.id).join(', ')} settle${settles.length===1?'s':''} it, and won't any more.`:'',
    tests.length?`${tests.length} effect${tests.length===1?' tests':'s test'} it: the condition on it goes, so an effect that ran only if it was settled runs whatever happens.`:'',
    'You can undo this.',
  ].filter(Boolean).join(' ')});
  return <article className="fact-card" data-fact={id} aria-label={`Fact ${id}`}>
    <header>
      <IdField id={id} label="Fact id" problem={next=>idProblem(next,Object.keys(doc.facts??{}),id)} onRename={next=>{edit(scene=>renameFact(scene,id,next));showFact(next)}}
        warning="Every beat, route and effect naming it follows. Game state keeps facts by their ids: a game already played keeps what it settled under the old one."/>
      <button type="button" className="icon-button danger" aria-label={`Remove fact ${id}`} title="Remove fact" onClick={remove}><Trash2 size={14}/></button>
    </header>
    <TextArea label="Sentence" field="sentence" rows={2} hint="What the GM is told once it's settled." value={sentence} onChange={value=>edit(scene=>setSceneField(scene,'facts',{...(scene.facts??{}),[id]:value}))}/>
    <div className="fact-uses">
      <div className="fact-use" data-field="settled">
        <span className="field-label">Settled by</span>
        {settles.length?<ul aria-label={`Where ${id} is settled`}>{settles.map(where=><li key={`${where.kind}:${where.id}`}><SettlerLink at={where}/></li>)}</ul>
          :<p className="muted">Nothing settles it yet: add it to a beat's or a route's facts settled.</p>}
      </div>
      <div className="fact-use" data-field="tested">
        <span className="field-label">Tested by</span>
        {tests.length?<ul aria-label={`Where ${id} is tested`}>{tests.map(test=><li key={`${JSON.stringify(test.at)}:${test.index}:${test.key}`}><TestLink test={test}/></li>)}</ul>
          :<p className="muted">No effect tests it.</p>}
      </div>
    </div>
  </article>;
}

const KINDS={start:'Start',discovery:'Discovery',event:'Event',ending:'Ending'} as const;

function SettlerLink({at}:{at:{kind:'node'|'route';id:string}}){
  const {doc,showNode,showRoute}=useScene();
  if(at.kind==='node'){
    const node=doc.nodes.find(other=>other.id===at.id);
    return <button type="button" className="use-link" onClick={()=>showNode(at.id,'establishes')}><span className={`kind-dot ${node?nodeKind(node):''}`}/><span>{node?KINDS[nodeKind(node)]:'Node'} · {titleOf(doc,at.id)}</span></button>;
  }
  const route=doc.edges.find(other=>other.id===at.id);
  return <button type="button" className="use-link" onClick={()=>showRoute(at.id,'establishes')} data-connection={route?connectionId(route.source,route.target):undefined}><span className="kind-dot route"/><span>Route · {route?.label||at.id}{route&&<small> ({titleOf(doc,route.source)} → {titleOf(doc,route.target)})</small>}</span></button>;
}

function TestLink({test}:{test:FactTest}){
  const {doc,showEffect}=useScene();
  const where=test.at.kind==='node'?`Ending · ${titleOf(doc,test.at.id)}`:'Every ending (onEnd)';
  return <button type="button" className="use-link" onClick={()=>showEffect(test.at,test.index,test.key)}><span className={`kind-dot ${test.at.kind==='node'?'ending':'scene'}`}/><span>{where} · effect {test.index+1} ({test.op}), {test.key==='if'?'only if settled':'unless settled'}</span></button>;
}

/** [+ Add fact] in the Facts view: a new fact, its sentence and its id. */
function AddFact(){
  const {edit,showFact}=useScene();
  const [open,setOpen]=useState(false);
  if(!open)return <button type="button" className="add-item" onClick={()=>setOpen(true)}><Plus size={13}/>Add fact</button>;
  return <div className="add-picker" role="group" aria-label="Add a fact" data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false)}}}>
    <header><b>Add a fact</b><button type="button" className="icon-button" aria-label="Cancel" onClick={()=>setOpen(false)}><X size={13}/></button></header>
    <NewFactForm label="A new fact" onCreate={(id,sentence)=>{edit(scene=>addFact(scene,id,sentence).doc);setOpen(false);showFact(id)}}/>
  </div>;
}

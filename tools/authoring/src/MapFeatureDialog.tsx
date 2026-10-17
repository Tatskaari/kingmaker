import {useEffect,useRef,useState} from 'react';
import type {CardNode} from './model';
import type {Point} from './map-model';
import type {FeatureValues} from './map-features';

export type FeatureEditor={id:string;type:'spawn'|'interaction';at:Point;node?:CardNode};
export function MapFeatureDialog({feature,onSave,onDelete,onClose}:{feature:FeatureEditor;onSave:(values:FeatureValues)=>void;onDelete:()=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),name=useRef<HTMLInputElement>(null);
  const [values,setValues]=useState<FeatureValues>({title:feature.node?.data.title??'',eventMessage:feature.node?.data.eventMessage??'',exitPort:feature.node?.data.exitPort??'',script:feature.node?.data.script??''});
  const [error,setError]=useState(''),[confirm,setConfirm]=useState<'delete'|'port'|null>(null);
  useEffect(()=>{const el=dialog.current!,previous=document.activeElement as HTMLElement|null;el.showModal();name.current?.focus();return()=>{el.close();previous?.focus()}},[]);
  const save=()=>{try{onSave(values)}catch(e){setError(e instanceof Error?e.message:String(e));setConfirm(null)}};
  const field=(key:keyof FeatureValues)=>(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setValues(v=>({...v,[key]:e.target.value}));
  return <dialog className="map-feature-dialog" ref={dialog} aria-labelledby="map-feature-title" onCancel={e=>{e.preventDefault();if(confirm)setConfirm(null);else onClose()}} onKeyDown={e=>e.stopPropagation()}>
    <form onSubmit={e=>{e.preventDefault();if(confirm)return;if(feature.node?.data.exitPort&&!values.exitPort.trim())setConfirm('port');else save()}}>
      <header><div><small>TILE {feature.at.x}, {feature.at.y}</small><h2 id="map-feature-title">{feature.node?'Edit':'Add'} {feature.type==='spawn'?'spawn point':'interaction'}</h2></div><button type="button" aria-label="Close editor" onClick={onClose}>×</button></header>
      {confirm?<section role="alert"><h3>{confirm==='delete'?'Delete this '+(feature.type==='spawn'?'spawn point':'interaction')+'?':'Remove this exit port?'}</h3><p>{confirm==='delete'?'This removes the placement and its port, if any.':'This removes the scenario output and clears its destination.'} Scenario transitions using a removed port will need reconnecting. You can undo this.</p><footer><button autoFocus type="button" onClick={()=>setConfirm(null)}>Cancel</button><button type="button" className="danger" onClick={()=>confirm==='delete'?onDelete():save()}>{confirm==='delete'?`Delete ${feature.type==='spawn'?'spawn point':'interaction'}`:'Remove port and save'}</button></footer></section>:<>
        <label>Name<input ref={name} aria-label={feature.type==='spawn'?'Spawn point name':'Interaction name'} value={values.title} onChange={field('title')} placeholder={feature.type==='spawn'?'From the tavern':'Open door'} required/></label>
        {feature.type==='spawn'?<p>This named position becomes an input port on the map in the scenario graph. Connect a scene or map output to it.</p>:<>
          <label>Event log message<textarea aria-label="Event log message" value={values.eventMessage} onChange={field('eventMessage')} placeholder="You open the door and step into the tavern." rows={3}/></label>
          <label>Exit port (optional)<input aria-label="Exit port" value={values.exitPort} onChange={field('exitPort')} placeholder="To tavern"/></label>
          <p>A name here exposes an output on this map’s scenario node. Wire its destination in the scenario graph. Leave blank for an interaction that stays here.</p>
          <label>Script / implementation notes (future)<textarea aria-label="Script notes" value={values.script} onChange={field('script')} placeholder="Describe what this should do. Stored only—not executed." rows={3}/></label>
          <p>Messages and script notes are saved for future game integration; this editor does not run interactions.</p>
          {feature.node?.data.file&&<p>Destination: {feature.node.data.file} → {feature.node.data.entry}</p>}
        </>}
        {error&&<p role="alert">{error}</p>}
        <footer>{feature.node&&<button className="danger" type="button" onClick={()=>setConfirm('delete')}>Delete…</button>}<button type="button" onClick={onClose}>Cancel</button><button type="submit">Save {feature.type==='spawn'?'spawn point':'interaction'}</button></footer>
      </>}
    </form>
  </dialog>;
}

// What the scenario, map and place editors share: the campaign around their file, read now and again
// whenever a file of the vault changes, and their undo, which spans the file and the others an edit
// wrote to (a scene's ending set from the scenario, a place's thing moved from its map).
import {useEffect,useMemo,useRef,useState} from 'react';
import type {FileHost} from './host.ts';
import {readCampaignFiles} from './files.ts';
import type {CampaignFiles} from './files.ts';

/** The campaign around the host's file: read at once, and again shortly after any file of the vault changes. */
export function useCampaignFiles(host:FileHost<any>|FileHost<unknown>,onError:(message:string)=>void):CampaignFiles|null{
  const [campaign,setCampaign]=useState<CampaignFiles|null>(null);
  useEffect(()=>{
    let alive=true,request=0,timer:ReturnType<typeof setTimeout>|undefined;
    const load=()=>{const mine=++request;readCampaignFiles(host.filePath,host.files).then(next=>{if(alive&&mine===request)setCampaign(next)}).catch(error=>{if(alive)onError(`Couldn't read the campaign: ${messageOf(error)}`)})};
    load();
    const unsubscribe=host.subscribe(()=>{clearTimeout(timer);timer=setTimeout(load,150)});
    return()=>{alive=false;clearTimeout(timer);unsubscribe()};
  },[host]);
  return campaign;
}

/** Another file's text changed by an edit: what it was and what it is. */
export type FileChange={path:string;before:string;after:string};
/** One step of undo: the editor's own file, and the other files it wrote. */
type Step<T>={own?:{before:T;after:T};files:FileChange[]};

/**
 * An editor's edits and their undo. `commit` is an edit of the editor's own file; `write` an edit of
 * other files (and, with `own`, of its own as well), written in order, the step kept only when they
 * all are. Typing in one field, from its focus to its blur, is one step, in this file or another
 * (a place's thing named from its map). Writes queue, so a second edit made while the first is being
 * written follows it. Undo writes each file back to what it was, refusing when one has changed since
 * (nothing is overwritten); the own file is the editor's to put back.
 */
export function useEdits<T>({host,initial,shape,serialize,onError}:{host:FileHost<T>;initial:T;shape:(doc:T)=>string[];serialize:(doc:T)=>string;onError:(message:string)=>void}){
  const [doc,setDoc]=useState(initial),current=useRef(initial);
  const [history,setHistory]=useState<{past:Step<T>[];future:Step<T>[]}>({past:[],future:[]}),steps=useRef(history);
  const [pending,setPending]=useState(0),queue=useRef<Promise<unknown>>(Promise.resolve());
  const session=useRef<string|null>(null),lastSession=useRef<string|null>(null);
  const keep=(next:{past:Step<T>[];future:Step<T>[]})=>{steps.current=next;setHistory(next)};
  const publish=(next:T)=>{current.current=next;setDoc(next);host.change(next)};
  const remember=(step:Step<T>,coalesce=false)=>{
    const past=steps.current.past,last=past.at(-1);
    const same=coalesce&&!!session.current&&lastSession.current===session.current&&!!last;
    const ownOnly=(s:Step<T>)=>!!s.own&&!s.files.length,onePath=(s:Step<T>)=>!s.own&&s.files.length===1;
    let merged:Step<T>|undefined;
    if(same&&ownOnly(last!)&&ownOnly(step))merged={own:{before:last!.own!.before,after:step.own!.after},files:[]};
    else if(same&&onePath(last!)&&onePath(step)&&last!.files[0].path===step.files[0].path)merged={files:[{path:step.files[0].path,before:last!.files[0].before,after:step.files[0].after}]};
    keep({past:merged?[...past.slice(0,-1),merged]:[...past.slice(-99),step],future:[]});
    lastSession.current=coalesce?session.current:null;
  };
  /** The editor's own file changed; refused (with a note) when the game couldn't load it like that. */
  const commit=(next:T,coalesce=false):boolean=>{
    const before=current.current;
    if(next===before||serialize(next)===serialize(before))return false;
    const problems=shape(next);
    if(problems.length){onError(`Not saved: the game couldn't load the file like that (${problems[0]}).`);return false}
    publish(next);
    remember({own:{before,after:next},files:[]},coalesce);
    return true;
  };
  /** One operation after another: the writes and the undos, each waiting for the last. */
  const enqueue=(work:()=>Promise<void>):Promise<boolean>=>{
    setPending(n=>n+1);
    const run=queue.current.then(work).then(()=>true,error=>{onError(messageOf(error));return false}).finally(()=>setPending(n=>n-1));
    queue.current=run;
    return run;
  };
  /** Other files written (in order; each refused unless it's `before` now), and with `own` this file too, as one step. */
  const write=(changes:FileChange[],own?:T,coalesce=false)=>{
    const live=changes.filter(change=>change.before!==change.after);
    // The first file is written at once (so the editor sees it straight away); the rest follow it.
    const first=live[0]?host.write(live[0].path,live[0].before,live[0].after):Promise.resolve();
    return enqueue(async()=>{
      const done:FileChange[]=[];
      try{
        if(live[0]){await first;done.push(live[0])}
        for(const change of live.slice(1)){await host.write(change.path,change.before,change.after);done.push(change)}
      }catch(error){
        // Put back what was written before the one that failed, so the step is all or nothing.
        for(const change of [...done].reverse()){try{await host.write(change.path,change.after,change.before)}catch{}}
        throw error;
      }
      const before=current.current;
      const ownChanged=own!==undefined&&serialize(own)!==serialize(before);
      if(ownChanged)publish(own!);
      if(done.length||ownChanged)remember({...(ownChanged?{own:{before,after:own!}}:{}),files:done},coalesce);
    });
  };
  const travel=(direction:'undo'|'redo')=>enqueue(async()=>{
    const {past,future}=steps.current;
    const step=direction==='undo'?past.at(-1):future[0];
    if(!step)return;
    const files=direction==='undo'?[...step.files].reverse().map(change=>({path:change.path,before:change.after,after:change.before})):step.files;
    const done:FileChange[]=[];
    try{for(const change of files){await host.write(change.path,change.before,change.after);done.push(change)}}
    catch(error){
      for(const change of [...done].reverse()){try{await host.write(change.path,change.after,change.before)}catch{}}
      throw new Error(`Couldn't ${direction} that: ${messageOf(error)} Nothing was overwritten.`);
    }
    if(step.own)publish(direction==='undo'?step.own.before:step.own.after);
    lastSession.current=null;
    keep(direction==='undo'?{past:past.slice(0,-1),future:[step,...future]}:{past:[...past,step],future:future.slice(1)});
  });
  const sessionHandlers=useMemo(()=>({onFocus:()=>{session.current=crypto.randomUUID()},onBlur:()=>{session.current=null}}),[]);
  return {doc,current,commit,write,undo:()=>travel('undo'),redo:()=>travel('redo'),canUndo:history.past.length>0,canRedo:history.future.length>0,busy:pending>0,sessionHandlers,
    /** Edit this file with `change`, applied to it as it is now (typing in a field is one step). */
    edit:(change:(doc:T)=>T)=>commit(change(current.current),true)};
}

export const messageOf=(error:unknown)=>error instanceof Error?error.message:String(error);

/**
 * What an editor has written to other files, until the campaign is read again with it: so the editor
 * shows its edit at once, and a second edit of a file, made before the first has been written (or the
 * vault's change has come back round), starts from the first's result. `writer` is the host with its
 * writes seen at once and made one after another; `textOf` a file's text as this editor knows it;
 * `version` changes with every write.
 */
export function useWritten<T>(host:FileHost<T>,campaign:import('./files.ts').CampaignFiles|null){
  const written=useRef(new Map<string,string>()),[version,setVersion]=useState(0);
  const chain=useRef<Promise<unknown>>(Promise.resolve());
  const writer=useMemo<FileHost<T>>(()=>({...host,write:(path,before,after)=>{
    written.current.set(path,after);setVersion(n=>n+1);
    const run=chain.current.then(()=>host.write(path,before,after));
    chain.current=run.catch(()=>{});
    return run.catch(error=>{
      if(written.current.get(path)===after)written.current.delete(path);
      setVersion(n=>n+1);
      throw error;
    });
  }}),[host]);
  useEffect(()=>{
    if(!campaign)return;
    const read=new Map<string,string|undefined>([
      [campaign.scenarioPath??'',campaign.scenarioText],
      ...campaign.scenes.map(file=>[file.path,file.text] as [string,string|undefined]),
      ...campaign.maps.map(file=>[file.path,file.text] as [string,string|undefined]),
      ...campaign.places.map(file=>[file.path,file.text] as [string,string|undefined]),
    ]);
    for(const [path,text] of [...written.current])if(read.get(path)===text)written.current.delete(path);
  },[campaign]);
  const textOf=(path:string|undefined,campaignText:string|undefined)=>path!==undefined&&written.current.has(path)?written.current.get(path):campaignText;
  return {writer,textOf,version};
}

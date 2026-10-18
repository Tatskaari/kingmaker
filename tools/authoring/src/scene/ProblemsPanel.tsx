// The problems: the game's own rules for a scene (shared/scene/rules.ts), run as the scene is edited,
// each taking the author to where it is.
import React from 'react';
import {AlertTriangle,CheckCircle2,Info} from 'lucide-react';
import {titleOf} from './model.ts';
import type {Problem,ProblemAt,SceneDocument} from './model.ts';

/** Where a problem is, in a few words: the scene and its field, a node, a route, a person. */
export function placeOf(doc:SceneDocument,at:ProblemAt):string{
  if(at.kind==='scene')return at.field?`Scene · ${at.field}`:'Scene';
  if(at.kind==='node')return `Node · ${titleOf(doc,at.id)}`;
  if(at.kind==='route')return `Route · ${doc.edges.find(route=>route.id===at.id)?.label||at.id}`;
  return `Cast · ${doc.cast.find(member=>member.id===at.id)?.name||at.id}`;
}

export function ProblemsPanel({doc,problems,warnings=[],notes,onGo}:{doc:SceneDocument;problems:Problem[];warnings?:Problem[];notes:string[];onGo:(at:ProblemAt)=>void}){
  return <div className="problems-panel">
    {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
    {problems.length?<p className="muted">The campaign check would refuse this scene for {problems.length===1?'this':`these ${problems.length}`}. Each takes you to where it is.</p>
      :<p className="problems-clear"><CheckCircle2 size={15}/>No problems: the campaign check holds this scene to the format's rules and finds nothing.</p>}
    <ol className="problems">
      {problems.map((problem,index)=><li key={`${index}:${problem.message}`}>
        <button type="button" className="problem" data-at={JSON.stringify(problem.at)} onClick={()=>onGo(problem.at)}>
          <AlertTriangle size={14}/><span><b>{problem.message}</b><small>{placeOf(doc,problem.at)}</small></span>
        </button>
      </li>)}
    </ol>
    {warnings.length>0&&<>
      <p className="muted warnings-head">{warnings.length===1?'A warning':`${warnings.length} warnings`}: the game takes {warnings.length===1?'it':'them'} as {warnings.length===1?'it is':'they are'}, but the GM is told of something the scene hasn't got. Pick from the cast or the place's things.</p>
      <ol className="warnings">
        {warnings.map((warning,index)=><li key={`${index}:${warning.message}`}>
          <button type="button" className="warning" data-at={JSON.stringify(warning.at)} onClick={()=>onGo(warning.at)}>
            <Info size={14}/><span><b>{warning.message}</b><small>{placeOf(doc,warning.at)}</small></span>
          </button>
        </li>)}
      </ol>
    </>}
  </div>;
}

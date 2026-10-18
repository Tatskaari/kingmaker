// The Problems view: the game's own rules for a scene (shared/scene/rules.ts), run as the scene is
// edited, each saying where it is and taking the author there: the node or the route on the graph, the
// person's card, the fact, or the scene's field, the very part of it focused. Under them, apart and not
// counted with them, the warnings: what the game takes as it is but the author should look at (a path
// via something the scene hasn't got).
import React from 'react';
import {AlertTriangle,CheckCircle2,Info} from 'lucide-react';
import {nodeKind,titleOf} from './model.ts';
import type {Problem,ProblemAt,SceneDocument} from './model.ts';

const SCENE_FIELDS:Record<string,string>={id:'Scene id',title:'Title',description:'Description',hook:'Hook',setting:'Setting',premise:'Premise',truth:'Truth',clock:'Clock',time:'Time',place:'Place',rest:'Rest',interlude:'Interlude',milestone:'Milestone',limits:'Limits',known:'Known',facts:'Facts',background:'Background',assumes:'Assumes',overtaken:'Overtaken',onStart:'As it starts',onEnd:'On every ending',afterwards:'Afterwards',reinforcements:'Who comes to a fight',fronts:'Fronts',lore:'Lore',companion:'Companion'};
const PARTS:Record<string,string>={id:'Id',title:'Title',closing:'Closing',revelation:'Revelation',paths:'Paths',required:'Required',lore:'Lore',next:'Next scene',carry:'The story carries it',cast:'Conversation roles',fight:'Fight',after:'After rounds',why:'Why they come',statblock:'Statblock',effects:'Effects',requires:'Requires',condition:'Condition',via:'Via',clue:'Clue',earn:'Earn',name:'Name',look:'Look',voice:'Voice',wants:'Wants',whyHere:'Why here',attitude:'Attitude',enters:'Enters'};
const DESCRIPTIONS={start:'Opening',discovery:'How to play it',event:'What happens',ending:'What\'s true'};

/** A part of a thing, in words: "Closing", "Path 2 · Clue", "Effect 1". */
function partOf(field:string,description:string):string{
  const [head,index,rest]=field.split('.');
  const name=head==='description'?description:PARTS[head]??SCENE_FIELDS[head]??head;
  if(index===undefined)return name;
  const item=head==='paths'?'Path':head==='effects'||head==='onStart'||head==='onEnd'?'Effect':head==='afterwards'?'World op':head==='reinforcements'?'Who comes':name;
  return [head==='onStart'||head==='onEnd'||head==='afterwards'||head==='reinforcements'?name:'',`${item} ${Number(index)+1}`,rest?PARTS[rest]??rest:''].filter(Boolean).join(' · ');
}

/** Where a problem is, in a few words: the scene and its field, a node, a route, a person, and the part of it. */
export function placeOf(doc:SceneDocument,at:ProblemAt):string{
  if(at.kind==='scene')return at.field?`Scene · ${partOf(at.field,'Description')}`:'Scene';
  const field=at.field;
  if(at.kind==='node'){
    const node=doc.nodes.find(other=>other.id===at.id);
    return [`Node · ${titleOf(doc,at.id)}`,field?partOf(field,node?DESCRIPTIONS[nodeKind(node)]:'Description'):''].filter(Boolean).join(' · ');
  }
  if(at.kind==='route')return [`Route · ${doc.edges.find(route=>route.id===at.id)?.label||at.id}`,field?partOf(field,'Description'):''].filter(Boolean).join(' · ');
  return [`Cast · ${doc.cast.find(member=>member.id===at.id)?.name||at.id}`,field?partOf(field,'Description'):''].filter(Boolean).join(' · ');
}

export function ProblemsView({doc,problems,warnings=[],notes,onGo,checking}:{doc:SceneDocument;problems:Problem[];warnings?:Problem[];notes:string[];onGo:(at:ProblemAt)=>void;checking:boolean}){
  return <div className="view-content problems-view">
    <header className="view-header">
      <h2>Problems</h2>
      <p className="view-lede">The game's own rules for a scene, the ones <code>npm run campaign -- check</code> holds every scene to, run against the campaign around this file as you edit. Each problem takes you to where it is.</p>
    </header>
    {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
    {!checking&&(problems.length?<p className="muted">The campaign check would refuse this scene for {problems.length===1?'this':`these ${problems.length}`}.</p>
      :<p className="problems-clear"><CheckCircle2 size={15}/>No problems: the campaign check holds this scene to the format's rules and finds nothing.</p>)}
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

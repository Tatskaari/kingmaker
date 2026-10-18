// The Cast view: the scene's people, a list to pick from beside the chosen person's card, with every
// field of one (grouped: who they are, how they come across, what drives them, what they know, playing
// them, in the scene), where the scene uses them, and a way to add someone.
import React,{useState} from 'react';
import {Plus,Trash2,UserPlus,X} from 'lucide-react';
import {useScene} from './api.ts';
import {Group,IdField,ItemCard,ListField,LoreLinks,SelectField,TextArea,TextField} from './fields.tsx';
import {ORDER,SLUG,addCast,eventsOf,idProblem,isBeat,isEnding,optionalList,optionalText,removeCast,renameCast,setCastField,slugOf,titleOf,uniqueId,updateCast,withKey} from './model.ts';
import type {CastMember} from './model.ts';

type Member=NonNullable<CastMember['members']>[number];

/** The cast: each person in a list, the chosen one's card beside it (the first when none is chosen). */
export function CastView({open,onOpen}:{open:string|null;onOpen:(id:string|null)=>void}){
  const {doc}=useScene();
  const chosen=doc.cast.find(member=>member.id===open)??doc.cast[0];
  return <div className="view-content cast-view">
    <aside className="cast-list" aria-label="The cast">
      <h2 className="group-title">People<span className="count">{doc.cast.length}</span></h2>
      {!doc.cast.length&&<p className="muted">Nobody yet. Who is here, and what do they want?</p>}
      <ul>
        {doc.cast.map(member=><li key={member.id}>
          <button type="button" className={`cast-pick${chosen?.id===member.id?' active':''}`} aria-current={chosen?.id===member.id||undefined} onClick={()=>onOpen(member.id)}>
            <b>{member.name||'Unnamed'}</b>
            <small>{member.called?`“${member.called}” · `:''}<code>{member.id}</code></small>
            <small>{member.enters?`Arrives at ${titleOf(doc,member.enters)}`:'Here from the start'}</small>
          </button>
        </li>)}
      </ul>
      <NewPerson onAdded={onOpen}/>
    </aside>
    {chosen?<CastCard key={chosen.id} member={chosen}/>:<section className="cast-detail empty"><p className="muted">Add someone to the cast to write their card.</p></section>}
  </div>;
}

/** [+ Add person]: someone new, their name and an id (a slug, short: how the GM, the paths and the effects name them). */
function NewPerson({onAdded}:{onAdded:(id:string)=>void}){
  const {doc,edit}=useScene();
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[id,setId]=useState('');
  const close=()=>{setOpen(false);setName('');setId('')};
  const add=()=>{
    if(!name.trim())return;
    let added='';
    edit(scene=>{const next=addCast(scene,name.trim(),id.trim()||undefined);added=next.id;return next.doc});
    close();onAdded(added);
  };
  if(!open)return <button type="button" className="add-item" onClick={()=>setOpen(true)}><UserPlus size={13}/>Add person</button>;
  return <div className="add-picker new-person" role="group" aria-label="Add a person" data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}}}>
    <header><b>Add a person</b><button type="button" className="icon-button" aria-label="Cancel" onClick={close}><X size={13}/></button></header>
    <input autoFocus aria-label="New person's name" placeholder="Their name (Sergeant Agnes Kell)" value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
    <input aria-label="New person's id" placeholder={`Their id (${uniqueId(slugOf(id)||slugOf(name)||'a-slug',doc.cast.map(member=>member.id))})`} value={id} onChange={event=>setId(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
    <small className="field-hint">The id is how the GM, the paths and the effects name them: short (“kell”).</small>
    <button type="button" className="primary" disabled={!name.trim()} onClick={add}><UserPlus size={13}/>Add person</button>
  </div>;
}

/** A person's card: every field of one, grouped, and where the scene uses them. */
function CastCard({member}:{member:CastMember}){
  const {edit,confirm,doc,loreNames,openLore,pickLore,renamed}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setCastField(scene,member.id,key,value));
  const optional=(key:string)=>(value:string)=>set(key,optionalText(value));
  const roles=member.roles??{};
  const setRole=(key:string,value:string)=>edit(scene=>updateCast(scene,member.id,old=>{
    const next=withKey(old.roles??{},key,optionalText(value),ORDER.roles);
    return withKey(old,'roles',Object.keys(next).length?next:undefined,ORDER.cast);
  }));
  const events=eventsOf(doc).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`}));
  const remove=()=>confirm({title:'Remove person?',confirmLabel:'Remove person',description:`Remove ${member.name||member.id} from the cast, with the start's and the events' roles for them? Paths via ${member.id} and effects naming them stay, and the problems will name them. You can undo this.`,onConfirm:()=>edit(scene=>removeCast(scene,member.id))});
  return <section className="cast-detail" data-cast={member.id} aria-label={`Cast card ${member.name||member.id}`}>
    <header className="cast-head">
      <div><h2>{member.name||'Unnamed'}</h2>{member.called&&<p className="cast-called">“{member.called}”</p>}</div>
      <button type="button" className="text-button danger" onClick={remove}><Trash2 size={13}/>Remove person</button>
    </header>
    <IdField id={member.id} problem={next=>idProblem(next,doc.cast.map(other=>other.id),member.id)} onRename={next=>{edit(scene=>renameCast(scene,member.id,next));renamed('cast',member.id,next)}}
      warning="Their roles at the start and the events, the paths via them and the effects naming them follow; the place's people and looks.json name them too (the problems say where). Game state keys on it: a game already played loses track of them under the old id."/>
    <Uses member={member}/>
    <Group title="Who they are">
      <TextField label="Name" field="name" value={member.name} onChange={value=>set('name',value)}/>
      <TextField label="Called" field="called" hint="What the player calls them until they've heard the name (“the boy in the too-big boots”)." value={member.called??''} onChange={optional('called')}/>
      <ListField label="Also known as" field="aka" addLabel="Add a name" rows={1} hint="Other names people use for them: hearing one counts as hearing the name." items={member.aka??[]} onChange={items=>set('aka',optionalList(items))}/>
      <LoreLinks label="Lore note" field="lore" hint="Their card in the campaign's lore/: the GM's memory of them lives beside it." paths={member.lore?[member.lore]:[]} names={loreNames} onOpen={openLore} onUnlink={()=>set('lore',undefined)} addLabel={member.lore?'Choose another note':'Link their lore note'} onAdd={()=>pickLore({title:`${member.name||member.id}'s lore note`,kinds:['character'],linked:member.lore?[member.lore]:[],onPick:path=>set('lore',path)})}/>
    </Group>
    <Group title="How they come across">
      <TextArea label="Look" field="look" hint="Appearance and manner, for narration." value={member.look} onChange={value=>set('look',value)}/>
      <TextArea label="Voice" field="voice" hint="How they talk." value={member.voice} onChange={value=>set('voice',value)}/>
      <TextArea label="Attitude" field="attitude" rows={4} hint="How they meet the player, and what moves them either way." value={member.attitude} onChange={value=>set('attitude',value)}/>
    </Group>
    <Group title="What drives them">
      <TextArea label="Wants" field="wants" value={member.wants} onChange={value=>set('wants',value)}/>
      <TextArea label="Fears" field="fears" value={member.fears??''} onChange={optional('fears')}/>
      <TextArea label="Why here" field="whyHere" hint="Why they're in this scene, now." value={member.whyHere} onChange={value=>set('whyHere',value)}/>
    </Group>
    <Group title="What they know">
      <ListField label="Knows" field="knows" addLabel="Add what they know" hint="What they know and will share when it makes sense." items={member.knows} onChange={items=>set('knows',items)}/>
      <ListField label="Secrets" field="secrets" addLabel="Add a secret" rows={3} hint="What they keep back: how it shows, what pulls them both ways, what opens it, and the first thing they'd say." items={member.secrets??[]} onChange={items=>set('secrets',optionalList(items))}/>
    </Group>
    <Group title="Playing them" hint="The co-GM's palette for their conversation role, climbing from what we see first to what invites the player in. Their clues are the discoveries' paths via them.">
      <div className="roles" data-field="roles">
        <TextArea label="Characterise" rows={2} hint="What we see first." value={roles.characterise??''} onChange={value=>setRole('characterise',value)}/>
        <TextArea label="Inconsistency" rows={2} hint="The discrepancy that invites a question." value={roles.inconsistency??''} onChange={value=>setRole('inconsistency',value)}/>
        <TextArea label="Hooks" rows={2} hint="What invites the player in." value={roles.hooks??''} onChange={value=>setRole('hooks',value)}/>
      </div>
      <TextArea label="Limits" field="limits" hint="What never works on them and what they never do (“coin buys boasts, not trust”)." value={member.limits??''} onChange={optional('limits')}/>
    </Group>
    <Group title="In the scene">
      <SelectField label="Enters" field="enters" hint="The event where they arrive; here from the start otherwise." value={member.enters??''} options={[{value:'',label:'Here from the start'},...events]} onChange={value=>set('enters',optionalText(value))}/>
      <TextField label="Group" field="group" hint="A group voiced through its leader (“four goblins”)." value={member.group??''} onChange={optional('group')}/>
      <MembersEditor member={member}/>
      <div className="field-row">
        <TextField label="Statblock" field="statblock" hint="An SRD statblock id (commoner, guard…): their stats when the rules need them." value={member.statblock??''} onChange={optional('statblock')}/>
        <TextField label="Weapon" field="weapon" hint="An SRD weapon id, when it isn't their statblock's usual one." value={member.weapon??''} onChange={optional('weapon')}/>
      </div>
    </Group>
  </section>;
}

/** Where the scene uses someone: where they arrive, their roles, the paths via them, the effects naming them. Each opens. */
function Uses({member}:{member:CastMember}){
  const {doc,showNode,showScene}=useScene();
  const id=member.id;
  const roles=doc.nodes.filter(node=>'cast' in node.data&&node.data.cast&&id in node.data.cast);
  const paths=doc.nodes.filter(isBeat).flatMap(node=>(node.data.paths??[]).flatMap((path,index)=>path.via===id?[{node:node.id,index}]:[]));
  const names=(effect:Record<string,unknown>)=>['who','by','to','what'].some(key=>effect[key]===id)||(Array.isArray(effect.allies)&&effect.allies.includes(id))||(Array.isArray(effect.enemies)&&effect.enemies.some(enemy=>(enemy as {leader?:unknown})?.leader===id));
  const effects=[
    ...(doc.onStart??[]).flatMap((effect,index)=>names(effect as Record<string,unknown>)?[{at:'onStart',index}]:[]),
    ...(doc.onEnd??[]).flatMap((effect,index)=>names(effect as Record<string,unknown>)?[{at:'onEnd',index}]:[]),
    ...doc.nodes.filter(isEnding).flatMap(node=>(node.data.effects??[]).flatMap((effect,index)=>names(effect as Record<string,unknown>)?[{at:node.id,index}]:[])),
  ];
  return <div className="cast-uses" data-field="uses">
    <span className="field-label">In this scene</span>
    <ul>
      <li>{member.enters?<>Arrives at <button type="button" className="use-link" onClick={()=>showNode(member.enters!,'arrivals')}>{titleOf(doc,member.enters)}</button></>:'Here from the start.'}</li>
      <li>{roles.length?<>Has a conversation role at {roles.map(node=><button type="button" key={node.id} className="use-link" onClick={()=>showNode(node.id,'cast')}>{titleOf(doc,node.id)}</button>)}</>:'Has no conversation role yet: add one at the start or an event.'}</li>
      {paths.length>0&&<li>Holds {paths.length} path{paths.length===1?'':'s'}: {paths.map(({node,index})=><button type="button" key={`${node}:${index}`} className="use-link" onClick={()=>showNode(node,`paths.${index}`)}>{titleOf(doc,node)} (path {index+1})</button>)}</li>}
      {effects.length>0&&<li>Named by {effects.length} effect{effects.length===1?'':'s'}: {effects.map(({at,index})=><button type="button" key={`${at}:${index}`} className="use-link" onClick={()=>at==='onStart'||at==='onEnd'?showScene(`${at}.${index}`):showNode(at,`effects.${index}`)}>{at==='onStart'?'as it starts':at==='onEnd'?'every ending':titleOf(doc,at)} (effect {index+1})</button>)}</li>}
    </ul>
  </div>;
}

/** A group's members, who stand, fight and fall separately in the world and the rules. */
function MembersEditor({member}:{member:CastMember}){
  const {edit}=useScene();
  const members=member.members??[];
  const setMembers=(list:Member[])=>edit(scene=>setCastField(scene,member.id,'members',optionalList(list)));
  const setMember=(index:number,key:string,value:unknown)=>setMembers(members.map((old,i)=>i===index?withKey(old,key,value,ORDER.member):old));
  const add=()=>setMembers([...members,{id:uniqueId(`${member.id}-${members.length+1}`,members.map(other=>other.id)),name:''}]);
  return <fieldset className="members" data-field="members">
    <legend className="field-label">Members</legend>
    {!members.length&&<p className="muted">None: they're one person.</p>}
    {members.map((one,index)=><ItemCard key={index} index={index} count={members.length} field={`members.${index}`} label={`Member ${index+1}`} title={one.name||one.id} removeLabel="Remove member" onRemove={()=>setMembers(members.filter((_,i)=>i!==index))}>
      <div className="field-row">
        <TextField label="Member name" value={one.name} onChange={value=>setMember(index,'name',value)}/>
        <TextField label="Member id" hint="Kept only when it's a slug." value={one.id} onChange={value=>{if(SLUG.test(value))setMember(index,'id',value)}}/>
      </div>
      <div className="field-row">
        <TextField label="Member statblock" value={one.statblock??''} onChange={value=>setMember(index,'statblock',optionalText(value))}/>
        <TextField label="Member weapon" value={one.weapon??''} onChange={value=>setMember(index,'weapon',optionalText(value))}/>
      </div>
      <TextField label="Member look" value={one.look??''} onChange={value=>setMember(index,'look',optionalText(value))}/>
    </ItemCard>)}
    <button type="button" className="add-item" onClick={add}><Plus size={13}/>Add member</button>
  </fieldset>;
}


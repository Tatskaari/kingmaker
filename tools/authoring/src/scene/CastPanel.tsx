// The cast: a card for each person, every field of it, and their lore note.
import React,{useState} from 'react';
import {ChevronDown,ChevronRight,Plus,Trash2,UserPlus} from 'lucide-react';
import {useScene} from './api.ts';
import {ListField,LoreLinks,SelectField,TextArea,TextField} from './fields.tsx';
import {ORDER,SLUG,addCast,eventsOf,optionalList,optionalText,removeCast,setCastField,slugOf,titleOf,uniqueId,updateCast,withKey} from './model.ts';
import type {CastMember} from './model.ts';

type Member=NonNullable<CastMember['members']>[number];

/** The cast panel: each person's card, one open at a time, and a way to add someone. */
export function CastPanel({open,onOpen}:{open:string|null;onOpen:(id:string|null)=>void}){
  const {doc,edit}=useScene();
  const [name,setName]=useState(''),[id,setId]=useState('');
  const add=()=>{
    if(!name.trim())return;
    let added='';
    edit(scene=>{const next=addCast(scene,name.trim(),id.trim()||undefined);added=next.id;return next.doc});
    setName('');setId('');onOpen(added);
  };
  return <div className="cast-panel">
    {!doc.cast.length&&<p className="muted">Nobody yet. Who is here, and what do they want?</p>}
    {doc.cast.map(member=><CastCard key={member.id} member={member} open={open===member.id} onToggle={()=>onOpen(open===member.id?null:member.id)}/>)}
    <div className="new-person">
      <span className="field-label">Add a person</span>
      <input aria-label="New person's name" placeholder="Their name (Sergeant Agnes Kell)" value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
      <input aria-label="New person's id" placeholder={`Their id (${uniqueId(slugOf(name)||'a-slug',doc.cast.map(member=>member.id))})`} value={id} onChange={event=>setId(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
      <small className="field-hint">The id is how the GM, the paths and the effects name them: short (“kell”), and never changed once the scene is played.</small>
      <button type="button" className="add-item" disabled={!name.trim()} onClick={add}><UserPlus size={13}/>Add person</button>
    </div>
  </div>;
}

/** A person's card: a summary, or every field of it. */
function CastCard({member,open,onToggle}:{member:CastMember;open:boolean;onToggle:()=>void}){
  const {doc,loreNames}=useScene();
  const arrives=member.enters?`Arrives at ${titleOf(doc,member.enters)}`:'Here from the start';
  return <article className={`cast-card ${open?'open':''}`} data-cast={member.id} aria-label={`Cast card ${member.name||member.id}`}>
    <button type="button" className="cast-summary" aria-expanded={open} onClick={onToggle}>
      {open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}
      <span><b>{member.name||'Unnamed'}</b>{member.called&&<small> “{member.called}”</small>}</span>
      <code>{member.id}</code>
      <small className="cast-meta">{arrives}{member.lore?` · ${loreNames.get(member.lore)??member.lore}`:''}</small>
    </button>
    {open&&<CastFields member={member}/>}
  </article>;
}

function CastFields({member}:{member:CastMember}){
  const {doc,edit,confirm,loreNames,openLore,pickLore}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setCastField(scene,member.id,key,value));
  const optional=(key:string)=>(value:string)=>set(key,optionalText(value));
  const roles=member.roles??{};
  const setRole=(key:string,value:string)=>edit(scene=>updateCast(scene,member.id,old=>{
    const next=withKey(old.roles??{},key,optionalText(value),ORDER.roles);
    return withKey(old,'roles',Object.keys(next).length?next:undefined,ORDER.cast);
  }));
  const events=eventsOf(doc).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`}));
  const remove=()=>confirm({title:'Remove person?',confirmLabel:'Remove person',description:`Remove ${member.name||member.id} from the cast, with the start's and the events' notes for them? Paths via ${member.id} and effects naming them stay, and the problems will name them. You can undo this.`,onConfirm:()=>edit(scene=>removeCast(scene,member.id))});
  return <div className="cast-fields">
    <TextField label="Name" field="name" value={member.name} onChange={value=>set('name',value)}/>
    <TextField label="Called" field="called" hint="What the player calls them until they've heard the name (“the boy in the too-big boots”)." value={member.called??''} onChange={optional('called')}/>
    <ListField label="Also known as" field="aka" addLabel="Add a name" rows={1} items={member.aka??[]} onChange={items=>set('aka',optionalList(items))}/>
    <LoreLinks label="Lore note" field="lore" hint="Their card in the campaign's lore/: the GM's memory of them lives beside it." paths={member.lore?[member.lore]:[]} names={loreNames} onOpen={openLore} onUnlink={()=>set('lore',undefined)} addLabel={member.lore?'Choose another note':'Link their lore note'} onAdd={()=>pickLore({title:`${member.name||member.id}'s lore note`,kinds:['character'],linked:member.lore?[member.lore]:[],onPick:path=>set('lore',path)})}/>
    <TextArea label="Look" field="look" hint="Appearance and manner, for narration." value={member.look} onChange={value=>set('look',value)}/>
    <TextArea label="Voice" field="voice" value={member.voice} onChange={value=>set('voice',value)}/>
    <TextArea label="Wants" field="wants" value={member.wants} onChange={value=>set('wants',value)}/>
    <TextArea label="Fears" field="fears" value={member.fears??''} onChange={optional('fears')}/>
    <TextArea label="Why here" field="whyHere" hint="Why they're in this scene, now." value={member.whyHere} onChange={value=>set('whyHere',value)}/>
    <ListField label="Knows" field="knows" addLabel="Add what they know" hint="What they know and will share when it makes sense." items={member.knows} onChange={items=>set('knows',items)}/>
    <ListField label="Secrets" field="secrets" addLabel="Add a secret" rows={3} hint="What they keep back: how it shows, what pulls them both ways, what opens it, and the first thing they'd say." items={member.secrets??[]} onChange={items=>set('secrets',optionalList(items))}/>
    <TextArea label="Attitude" field="attitude" rows={4} hint="How they meet the player, and what moves them either way." value={member.attitude} onChange={value=>set('attitude',value)}/>
    <TextArea label="Limits" field="limits" hint="What never works on them and what they never do." value={member.limits??''} onChange={optional('limits')}/>
    <fieldset className="roles" data-field="roles">
      <legend className="field-label">Roles</legend>
      <small className="field-hint">The co-GM's palette for their conversation role. Their clues are the discoveries' paths via them.</small>
      <TextArea label="Characterise" rows={2} hint="What we see first." value={roles.characterise??''} onChange={value=>setRole('characterise',value)}/>
      <TextArea label="Inconsistency" rows={2} hint="The discrepancy that invites a question." value={roles.inconsistency??''} onChange={value=>setRole('inconsistency',value)}/>
      <TextArea label="Hooks" rows={2} hint="What invites the player in." value={roles.hooks??''} onChange={value=>setRole('hooks',value)}/>
    </fieldset>
    <SelectField label="Enters" field="enters" hint="The event where they arrive; present from the start otherwise." value={member.enters??''} options={[{value:'',label:'Here from the start'},...events]} onChange={value=>set('enters',optionalText(value))}/>
    <TextField label="Group" field="group" hint="A group voiced through its leader (“four goblins”)." value={member.group??''} onChange={optional('group')}/>
    <MembersEditor member={member}/>
    <div className="field-row">
      <TextField label="Statblock" field="statblock" hint="An SRD statblock id (commoner, guard…)." value={member.statblock??''} onChange={optional('statblock')}/>
      <TextField label="Weapon" field="weapon" hint="An SRD weapon id." value={member.weapon??''} onChange={optional('weapon')}/>
    </div>
    <button type="button" className="text-button danger" onClick={remove}><Trash2 size={13}/>Remove person</button>
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
    {members.map((one,index)=><article className="member" key={index} aria-label={`Member ${index+1}`}>
      <div className="field-row">
        <TextField label="Member name" value={one.name} onChange={value=>setMember(index,'name',value)}/>
        <TextField label="Member id" hint="Kept only when it's a slug." value={one.id} onChange={value=>{if(SLUG.test(value))setMember(index,'id',value)}}/>
      </div>
      <div className="field-row">
        <TextField label="Member statblock" value={one.statblock??''} onChange={value=>setMember(index,'statblock',optionalText(value))}/>
        <TextField label="Member weapon" value={one.weapon??''} onChange={value=>setMember(index,'weapon',optionalText(value))}/>
      </div>
      <TextField label="Member look" value={one.look??''} onChange={value=>setMember(index,'look',optionalText(value))}/>
      <button type="button" className="text-button danger" onClick={()=>setMembers(members.filter((_,i)=>i!==index))}><Trash2 size={13}/>Remove member</button>
    </article>)}
    <button type="button" className="add-item" onClick={add}><Plus size={13}/>Add member</button>
  </fieldset>;
}

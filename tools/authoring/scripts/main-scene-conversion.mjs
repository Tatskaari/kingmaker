/**
 * Pure authoring import of a main-repository Scene object.
 * This module never imports the game, touches the filesystem, or invokes an authored function.
 * Callers supply the already-loaded scene plus literal source files for its closed-over helpers.
 */

const unique=values=>[...new Set(values)];
const titleCase=value=>String(value).replace(/[-_]/g,' ').replace(/^./,letter=>letter.toUpperCase());
const normalizedName=value=>String(value).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const section=(title,contents)=>contents?`## ${title}\n\n${contents}`:'';
const bullets=values=>(values??[]).map(value=>`- ${value}`).join('\n');

function inertSnapshot(value,path,functionSnapshots,ancestors=new Set()){
  if(typeof value==='function'){
    const text=Function.prototype.toString.call(value);
    functionSnapshots[path]=text;
    return text;
  }
  if(value===undefined)return undefined;
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw Error(`Cannot preserve a non-finite number at ${path}.`);
    return value;
  }
  if(typeof value==='bigint')return {$type:'bigint',value:String(value)};
  if(typeof value!=='object')throw Error(`Unsupported authored value at ${path}: ${typeof value}`);
  if(ancestors.has(value))throw Error(`Circular authored data at ${path}.`);
  ancestors.add(value);
  let result;
  if(Array.isArray(value))result=value.map((item,index)=>inertSnapshot(item,`${path}.${index}`,functionSnapshots,ancestors)??null);
  else {
    result={};
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
      if(!descriptor.enumerable)continue;
      // Accessors are also source, not instructions to run during an import.
      if(!('value' in descriptor)){
        result[key]={$type:'accessor-source',...(descriptor.get?{get:inertSnapshot(descriptor.get,`${path}.${key}.get`,functionSnapshots,ancestors)}:{}),...(descriptor.set?{set:inertSnapshot(descriptor.set,`${path}.${key}.set`,functionSnapshots,ancestors)}:{})};
        continue;
      }
      const item=inertSnapshot(descriptor.value,`${path}.${key}`,functionSnapshots,ancestors);
      if(item!==undefined)result[key]=item;
    }
  }
  ancestors.delete(value);
  return result;
}

function resolveLore(scene,lorePaths){
  const existing=unique(lorePaths.filter(path=>typeof path==='string'&&path.endsWith('.md'))),available=new Set(existing);
  const unresolvedLore=[],scenePaths=[],cast={};
  for(const path of scene.lore??[]){
    if(available.has(path))scenePaths.push(path);
    else unresolvedLore.push({kind:'scene',value:path});
  }
  const fronts=scene.fronts&&available.has(scene.fronts)?scene.fronts:undefined;
  if(scene.fronts&&!fronts)unresolvedLore.push({kind:'fronts',value:scene.fronts});
  const castCandidates=existing.filter(path=>path.startsWith('Cast/')).map(path=>{
    const segments=path.split('/'),filename=segments.at(-1),name=segments.length===2?filename.replace(/\.md$/,''):segments[1];
    const canonical=segments.length===2||segments.length===3&&['public.md','index.md','gm.md','private.md'].includes(filename);
    return {path,name:normalizedName(name),canonical,rank:filename==='public.md'?0:filename==='index.md'?1:segments.length===2?2:filename==='gm.md'?3:4};
  }).filter(candidate=>candidate.canonical);
  for(const character of scene.cast??[]){
    // Match names, never guess a note path from a character id or a mention in prose.
    const names=[character.name,...character.aka??[]].map(normalizedName);
    let candidates=[];
    for(const name of names){candidates=castCandidates.filter(candidate=>candidate.name===name);if(candidates.length)break}
    candidates.sort((a,b)=>a.rank-b.rank||a.path.localeCompare(b.path,'en'));
    if(candidates.length)cast[character.id]=candidates[0].path;
    else unresolvedLore.push({kind:'cast',value:character.name,characterId:character.id});
  }
  return {scene:unique(scenePaths),...(fronts?{fronts}:{}),cast,unresolvedLore};
}

function castDescription(character){
  const lines=[`### ${character.name} (${character.id})`];
  const strings=[['Called','called'],['Look','look'],['Voice','voice'],['Wants','wants'],['Fears','fears'],['Attitude','attitude'],['Enters at beat','enters'],['Group','group'],['Statblock','statblock'],['Weapon','weapon']];
  for(const [label,key] of strings)if(character[key])lines.push(`**${label}:** ${character[key]}`);
  if(character.aka?.length)lines.push(`**Also known as:** ${character.aka.join(', ')}`);
  if(character.knows?.length)lines.push(`**Knows**\n\n${bullets(character.knows)}`);
  if(character.secrets?.length)lines.push(`**Secrets**\n\n${bullets(character.secrets)}`);
  if(character.members?.length)lines.push(`**Group members**\n\n${character.members.map(member=>`- ${member.name} (${member.id})${member.look?`: ${member.look}`:''}${member.statblock?`; statblock ${member.statblock}`:''}${member.weapon?`; weapon ${member.weapon}`:''}`).join('\n')}`);
  return lines.join('\n\n');
}

function essentialDescription(essential){
  const parts=[`### ${essential.id}`,essential.what,`**Placed with:** ${(essential.placedWith??[]).join('; ')}`,`**Unlocks:** ${essential.unlocks}`];
  for(const [label,key] of [['Carriers','carriers'],['World objects','things']])if(essential[key]?.length)parts.push(`**${label}:** ${essential[key].join(', ')}`);
  if(essential.later)parts.push(`**Needed later:** ${essential.later}`);
  if(essential.missed)parts.push(`**If missed earlier:** ${essential.missed}`);
  return parts.filter(Boolean).join('\n\n');
}

function sceneDescription(scene){
  const context=[];
  for(const [label,key] of [['Time','time'],['Rest before opening','rest'],['Overtaken continuation','overtaken'],['Companion','companion']])if(scene[key])context.push(`- ${label}: ${scene[key]}`);
  for(const [label,key] of [['Creates character','createsCharacter'],['Downtime interlude','interlude'],['Milestone on arrival','milestone']])if(scene[key]!==undefined)context.push(`- ${label}: ${scene[key]?'yes':'no'}`);
  if(scene.anchors?.length)context.push(`- Authored anchors: ${scene.anchors.join(', ')}`);
  if(scene.fronts)context.push(`- Fronts document: ${scene.fronts}`);
  return [scene.summary,
    section('Setting',scene.setting),section('Premise',scene.premise),section('Hook',scene.hook),section('Opening',scene.opening),
    section('Cast',(scene.cast??[]).map(castDescription).join('\n\n')),
    section('Background',bullets(scene.background)),section('Common knowledge',bullets(scene.known)),section('Limits',bullets(scene.limits)),
    section('Essentials',(scene.essentials??[]).map(essentialDescription).join('\n\n')),
    section('Assumptions',bullets(scene.assumes)),section('Scene context',context.join('\n')),
    section('Authored world',scene.world?`${scene.world.name}\n\n${scene.world.description}\n\nThe complete authored areas, objects and starting positions are retained in the structured source snapshot.`:''),
    section('Import note','Editable local authoring copy of the main game scene. Script functions and their supporting source files are retained as inert text, never executed by this import or editor. The source snapshot does not change when graph content is edited.'),
  ].filter(Boolean).join('\n\n');
}

function beatDescription(beat,names){
  const cast=Object.entries(beat.cast??{}).map(([id,direction])=>`### ${names.get(id)??id} (${id})\n\n${direction}`).join('\n\n');
  return [section('Direction',beat.direction),section('Cast in this beat',cast),section('Pressure',beat.pressure)].filter(Boolean).join('\n\n');
}

function layout(scene){
  const beatIds=new Set(scene.beats.map(beat=>beat.id)),depths=new Map([[scene.start,0]]),queue=[scene.start];
  for(let index=0;index<queue.length;index++){
    const from=queue[index],beat=scene.beats.find(beat=>beat.id===from),depth=depths.get(from);
    for(const transition of [...beat.transitions??[],...scene.anytime??[]]){
      const targets=transition.check?[transition.check.onSuccess,transition.check.onFailure??from]:[transition.to??from];
      for(const target of targets)if(beatIds.has(target)&&!depths.has(target)){depths.set(target,depth+1);queue.push(target)}
    }
  }
  const reachableDepth=Math.max(0,...depths.values());
  for(const beat of scene.beats)if(!depths.has(beat.id))depths.set(beat.id,reachableDepth+1);
  const columns=new Map();
  for(const beat of scene.beats){const depth=depths.get(beat.id);if(!columns.has(depth))columns.set(depth,[]);columns.get(depth).push(beat.id)}
  const positions=new Map();
  for(const [depth,ids] of columns)ids.forEach((id,index)=>positions.set(id,{x:depth*440,y:(index-(ids.length-1)/2)*350}));
  const exitX=(Math.max(...depths.values())+1)*440+80;
  scene.exits.forEach((exit,index)=>positions.set(exit.id,{x:exitX,y:(index-(scene.exits.length-1)/2)*330}));
  return positions;
}

/** Convert one authored Scene to an editable graph; neither arguments nor external state change. */
export function convertScene(scene,{revision,sourcePath,sourceFiles={},lorePaths=[],destinations={}}={}){
  if(!scene||typeof scene.id!=='string'||typeof scene.title!=='string'||!Array.isArray(scene.beats)||!Array.isArray(scene.exits)||!Array.isArray(scene.cast))throw Error('Expected an authored Scene with id, title, cast, beats and exits.');
  const ids=new Set();
  for(const node of [...scene.beats,...scene.exits]){
    if(typeof node.id!=='string'||ids.has(node.id))throw Error(`Scene ${scene.id} has a missing or duplicate beat/exit id: ${node.id}`);
    ids.add(node.id);
  }
  if(!scene.beats.some(beat=>beat.id===scene.start))throw Error(`Scene ${scene.id} has no authored start beat “${scene.start}”.`);
  const functionSnapshots={},snapshot=inertSnapshot(scene,'scene',functionSnapshots),literalSources={};
  for(const [path,contents] of Object.entries(sourceFiles instanceof Map?Object.fromEntries(sourceFiles):sourceFiles)){
    if(typeof contents!=='string')throw Error(`Source file ${path} must be supplied as literal text.`);
    literalSources[path]=contents;
  }
  const resolution=resolveLore(scene,lorePaths),positions=layout(scene),names=new Map(scene.cast.map(character=>[character.id,character.name])),unresolvedDestinations=[];
  const sceneLore=unique([...resolution.scene,...(resolution.fronts?[resolution.fronts]:[])]),castLore=Object.values(resolution.cast);
  const nodes=scene.beats.map((beat,index)=>({
    id:beat.id,type:'story',position:positions.get(beat.id),
    data:{kind:'beat',title:beat.title,description:beatDescription(beat,names),lore:unique([...sceneLore,...Object.keys(beat.cast??{}).map(id=>resolution.cast[id]).filter(Boolean),...(beat.id===scene.start?castLore:[])]),sourceId:beat.id,sourceFile:sourcePath,sourceBeat:snapshot.beats[index],...(beat.id===scene.start?{start:true}:{})},
  }));
  for(const [index,exit] of scene.exits.entries()){
    const mapped=exit.next?(destinations instanceof Map?destinations.get(exit.next):destinations[exit.next]):undefined;
    const known=!!mapped&&typeof mapped.file==='string'&&!!mapped.file&&typeof mapped.entry==='string'&&!!mapped.entry&&(!mapped.kind||['scene','map'].includes(mapped.kind));
    if(exit.next&&!known)unresolvedDestinations.push({exitId:exit.id,next:exit.next});
    nodes.push({id:exit.id,type:'story',position:positions.get(exit.id),data:{
      kind:'exit',title:exit.title,description:[section('Outcome',exit.outcome),section('Closing',exit.closing)].filter(Boolean).join('\n\n'),lore:sceneLore.slice(),sourceId:exit.id,sourceFile:sourcePath,sourceExit:snapshot.exits[index],exitKind:exit.kind,
      ...(exit.next!==undefined?{next:exit.next}:{}),...(known?{file:mapped.file,entry:mapped.entry,destinationKind:mapped.kind??'scene'}:{}),
      ...(exit.script!==undefined?{scriptSource:snapshot.exits[index].script}:{}),
    }});
  }
  const edges=[];
  const addTransition=(from,transition,scope,index,snapshotRoute)=>{
    const branches=transition.check?[['success',transition.check.onSuccess,transition.check.success],['failure',transition.check.onFailure??from,transition.check.failure]]:[['direct',transition.to??from,'']];
    for(const [branch,target,outcomeText] of branches){
      if(!ids.has(target))throw Error(`Scene ${scene.id}: ${scope}.${from}.${transition.id} ${branch} targets unknown node “${target}”.`);
      const establishes=unique([...(transition.establishes??[]),...(branch==='direct'?[]:transition.check?.establishes?.[branch]??[])]);
      edges.push({id:`route:${JSON.stringify([scope,from,transition.id,index,branch])}`,source:from,target,type:'smoothstep',
        label:`${titleCase(transition.id)}${branch==='direct'?'':` · ${branch}`}${scope==='anytime'?' · anytime':''}`,
        data:{condition:transition.when,phase:transition.on??(transition.check?'attempt':'outcome'),skill:transition.check?.skill??'',dc:transition.check?.dc??0,scope,branch,outcomeText,sourceRoute:snapshotRoute,establishes,
          ...(transition.check?.reason?{checkReason:transition.check.reason}:{}),...(transition.given!==undefined?{given:transition.given}:{}),...(transition.essential!==undefined?{essential:transition.essential}:{}),...(transition.towards!==undefined?{towards:transition.towards}:{}),
          ...(transition.check&&branch==='failure'&&transition.check.onFailure===undefined?{staysInCurrentBeat:true}:{}),
        }});
    }
  };
  scene.beats.forEach((beat,beatIndex)=>{
    (beat.transitions??[]).forEach((transition,index)=>addTransition(beat.id,transition,'beat',index,snapshot.beats[beatIndex].transitions[index]));
    (scene.anytime??[]).forEach((transition,index)=>addTransition(beat.id,transition,'anytime',index,snapshot.anytime[index]));
  });
  const {beats,exits,...prep}=snapshot;
  return {
    format:'kingmaker',version:1,kind:'scene',id:scene.id,title:scene.title,description:sceneDescription(scene),nodes,edges,lore:unique([...sceneLore,...castLore]),prep,
    source:{kind:'main-typescript-scene-import',revision:revision??null,path:sourcePath??null,
      note:'An editable authoring copy, not a live game module. The complete Scene and literal supporting source files are preserved below. Functions are inert source strings; closed-over helpers and constants remain in sourceFiles and are not executable effects. The source snapshot remains the original even when graph content is edited. Check outcomes are separate branches; omitted failure destinations stay in the current beat; anytime transitions are expanded from each beat, not duplicated source rules. Runtime eligibility still applies.',
      scene:snapshot,sourceFiles:literalSources,functionSnapshots,loreResolution:{scene:resolution.scene,...(resolution.fronts?{fronts:resolution.fronts}:{}),cast:resolution.cast},unresolvedLore:resolution.unresolvedLore,unresolvedDestinations,
    },
  };
}

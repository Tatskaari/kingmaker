// Where the campaign's scenes name a place's parts: a thing by a clue path's via (as words: its id or
// its name) or by an effect's target, someone by the scene's cast. Shown on the part's card, each a
// link to the scene, so a thing renamed or removed is seen to be named.
import type {CampaignScene} from '../campaign/files.ts';
import type {PlaceDocument} from './model.ts';

export type PartUse={scene:string;sceneTitle:string;path:string;where:string};

/** A via or a name as words: no case, no leading article, nothing in brackets (the scene editor's comparison). */
const words=(text:string)=>text.toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[’]/g,"'").replace(/\s+/g,' ').trim().replace(/^(the|a|an) /,'');
const TARGETS=['what','to','who','in','by'];

/** Every path and effect of the scenes played in the place that names the thing `id`. */
export function thingUsesOf(place:PlaceDocument,id:string,scenes:CampaignScene[]):PartUse[]{
  const thing=place.things.find(t=>t.id===id);
  if(!thing)return [];
  const names=new Set([words(thing.id),words(thing.name)].filter(Boolean));
  return scenes.filter(scene=>scene.doc?.place===place.id).flatMap(scene=>{
    const doc=scene.doc!,title=doc.title||scene.key;
    const paths=doc.nodes.flatMap(node=>((node.data as {paths?:Array<{via:string}>}).paths??[]).flatMap((path,i)=>names.has(words(path.via))?[{scene:scene.key,sceneTitle:title,path:scene.path,where:`${node.data.title||node.id}: path ${i+1}`}]:[]));
    const named=(effects:unknown[]|undefined,where:string)=>(effects??[]).flatMap((effect,i)=>TARGETS.some(key=>(effect as Record<string,unknown>)[key]===id)?[{scene:scene.key,sceneTitle:title,path:scene.path,where:`${where}: effect ${i+1}`}]:[]);
    const effects=[
      ...named(doc.onEnd as unknown[]|undefined,'on every ending'),
      ...named(doc.afterwards as unknown[]|undefined,'afterwards'),
      ...doc.nodes.filter(node=>node.data.kind==='exit').flatMap(node=>named((node.data as {effects?:unknown[]}).effects,node.data.title||node.id)),
    ];
    return [...paths,...effects];
  });
}

/** The scenes played in the place whose cast someone is. */
export function castUsesOf(place:PlaceDocument,id:string,scenes:CampaignScene[]):PartUse[]{
  return scenes.filter(scene=>scene.doc?.place===place.id).flatMap(scene=>{
    const member=scene.doc!.cast.find(person=>person.id===id);
    return member?[{scene:scene.key,sceneTitle:scene.doc!.title||scene.key,path:scene.path,where:`${member.name||id} of its cast`}]:[];
  });
}

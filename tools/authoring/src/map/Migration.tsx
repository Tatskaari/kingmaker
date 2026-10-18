// A version 1 map, opened: what it is, and the offer to migrate it to the game's map format (version 2),
// its spawn point the scenario's start if the author says so.
import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,Lock,Map as MapIcon} from 'lucide-react';
import type {MigrationHost} from '../campaign/host.ts';
import {useCampaignFiles} from '../campaign/edits.ts';
import {keyOfPath,kindOfPath,pathIn} from '../campaign/files.ts';
import {slugOf} from '../campaign/json.ts';
import {migrateV1Map,readV1Map,spawnsOf} from './migrate.ts';
import type {V1Map} from './migrate.ts';
import type {Tile2} from './model.ts';
import {entryName,serializeMap,openMapFile} from './model.ts';
import {landingOn,serializeScenario,withStart} from '../scenario/model.ts';
import {openSceneFile} from '../scene/model.ts';
import {swatchOf} from './look.ts';
import '../map.css';

/** A version 1 map file: what's in it, and its migration, written back over it when the author asks. */
export function MapMigration({text,host}:{text:string;host:MigrationHost}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const campaign=useCampaignFiles(host,setError);
  const v1=useMemo<V1Map|string>(()=>{try{return readV1Map(text)}catch(e){return (e as Error).message}},[text]);
  const id=slugOf(keyOfPath(host.filePath))||'map';
  const spawns=typeof v1==='string'?[]:spawnsOf(v1);
  const [start,setStart]=useState<string>('');
  // Where its interactions' exits went: each file read once, as the vault has it now.
  const [destinations,setDestinations]=useState<Map<string,Found|undefined>|null>(null);
  useEffect(()=>{
    if(typeof v1==='string')return;
    let alive=true;
    const files=[...new Set(v1.nodes.flatMap(node=>node.data?.mapFeature==='interaction'&&node.data.exitPort?.trim()&&node.data.file?[node.data.file]:[]))];
    void Promise.all(files.map(async file=>[file,await destinationOf(file,host)] as const)).then(found=>{if(alive)setDestinations(new Map(found))});
    return()=>{alive=false};
  },[v1]);
  const scenario=campaign?.scenario;
  const atCampaign=!!campaign&&host.filePath===pathIn.map(campaign.root,id);
  const canStart=!!scenario&&atCampaign&&spawns.length>0;
  const plan=useMemo(()=>{
    if(typeof v1==='string'||!destinations)return undefined;
    try{
      const taken=campaign?.maps.filter(map=>map.key!==id).flatMap(map=>map.doc?.regions.map(r=>r.id)??[])??[];
      return migrateV1Map(v1,{id,start:canStart&&start?start:undefined,takenRegionIds:taken,destination:(file,entry)=>{
        const found=destinations.get(file);
        return found?.kind==='map'?{kind:'map',id:found.id,at:(entry!==undefined?found.spawns?.[entry]:undefined)??found.at}:found;
      }});
    }catch(e){return (e as Error).message}
  },[v1,destinations,start,canStart,campaign]);

  const migrate=async()=>{
    if(!plan||typeof plan==='string')return;
    setBusy(true);setError('');
    try{
      const spawn=spawns.find(s=>s.id===start);
      if(canStart&&spawn&&campaign?.scenarioPath&&campaign.scenarioText&&scenario){
        let next=withStart(scenario,id,spawn.at);
        if(!next.maps.includes(id))next={...next,maps:[...next.maps,id]};
        await host.write(campaign.scenarioPath,campaign.scenarioText,serializeScenario(next));
      }
      const migrated=serializeMap(plan.doc);
      openMapFile(migrated,host.filePath);
      host.replace(migrated);
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };

  if(typeof v1==='string')return <div className="km-file-error" style={{padding:24}}><h3>Cannot open this Kingmaker file</h3><p>It's a version 1 map that can't be migrated: {v1}</p><p>The file has been left unchanged.</p></div>;
  const size=v1.terrain?`${v1.terrain.width} × ${v1.terrain.height}`:'32 × 24 (nothing painted yet)';
  return <div className="km-workshop km-forms km-map km-migration" role="region" aria-label="A version 1 map">
    <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">A version 1 map: nothing is written until it's migrated</span></header>
    <div className="migration-body">
      <h2><Lock size={18}/>{v1.title||host.filePath}</h2>
      <p><b>This is a version 1 map, the plugin's own format before M4: the game doesn't load it.</b> The game's maps are the scenario format's (<code>docs/scenario-format.md</code>): rows of legend characters, each a terrain with its look and the decor on it, with regions, exits and people. Migrating writes this file as one of those, with the same tiles. The original stays in the vault's history (Obsidian's file recovery, and git).</p>
      <dl className="migration-facts">
        <dt>Size</dt><dd>{size} tiles</dd>
        <dt>Spawn points</dt><dd>{spawns.length?spawns.map(s=>`${s.title} (${s.at.x}, ${s.at.y})`).join(', '):'none'}</dd>
        <dt>Interactions</dt><dd>{v1.nodes.filter(n=>n.data?.mapFeature==='interaction').length}</dd>
        <dt>Its id</dt><dd><code>{id}</code>{!atCampaign&&<small> · a campaign's map is <code>maps/{id}.kmmap</code> in the campaign folder: move it there to play it</small>}</dd>
      </dl>
      {spawns.length>0&&<fieldset className="migration-start">
        <legend className="field-label">The scenario's start</legend>
        {canStart?<>
          <label><input type="radio" name="start" checked={!start} onChange={()=>setStart('')}/>Keep {spawns.length===1?'the spawn point':'each spawn point'} as a region of the map; the scenario's start stays {scenario!.start.map?`on ${scenario!.start.map} (${scenario!.start.at?.join(', ')})`:'as it is'}</label>
          {spawns.map(spawn=><label key={spawn.id}><input type="radio" name="start" checked={start===spawn.id} onChange={()=>setStart(spawn.id)}/>Make “{spawn.title}” ({spawn.at.x}, {spawn.at.y}) the scenario's start{scenario!.maps.includes(id)?'':`, and list ${id} among its maps`}</label>)}
        </>:<p className="muted">{!scenario?'There\'s no scenario around this file, so':'The story can only start on one of the campaign\'s maps (maps/<id>.kmmap), so'} {spawns.length===1?'its spawn point is kept as a region':'its spawn points are kept as regions'} of the map. Set the start later from a tile's menu.</p>}
      </fieldset>}
      {plan&&typeof plan!=='string'&&<>
        <div className="eyebrow">ITS LEGEND</div>
        <ul className="migration-legend">{plan.legend.map(({ch,was})=><li key={ch}><span className="legend-swatch" style={{background:swatchOf(plan.doc.legend[ch])}}/><code>{ch}</code>{entryName(plan.doc.legend[ch])}<small>from {was}</small></li>)}</ul>
        {plan.notes.length>0&&<><div className="eyebrow">ITS FEATURES</div><ul className="migration-notes">{plan.notes.map(note=><li key={note}>{note}</li>)}</ul></>}
      </>}
      {typeof plan==='string'&&<p className="map-error" role="alert">{plan}</p>}
      {error&&<p className="map-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy||!plan||typeof plan==='string'} onClick={()=>void migrate()}><MapIcon size={15}/>Migrate to version 2<ArrowRight size={14}/></button>
    </div>
  </div>;
}

/** A version 1 interaction's destination, as the vault has it: a map (its id, where it lands, and a version 1 map's spawn points by their ids), or a scene. */
type Found={kind:'map';id:string;at:Tile2;spawns?:Record<string,Tile2>}|{kind:'scene';id:string};

/** Where a version 1 interaction's exit went, as the vault has the file now. */
async function destinationOf(file:string,host:MigrationHost):Promise<Found|undefined>{
  const text=await host.files.read(file);
  if(text===undefined)return undefined;
  const kind=kindOfPath(file);
  try{
    if(kind==='map'){
      const value=JSON.parse(text) as {version?:unknown};
      if(value.version===1){
        const spawns=Object.fromEntries(spawnsOf(readV1Map(text)).map(spawn=>[spawn.id,spawn.at]));
        return {kind:'map',id:slugOf(keyOfPath(file))||'map',at:Object.values(spawns)[0]??{x:0,y:0},spawns};
      }
      const doc=openMapFile(text,file);
      return {kind:'map',id:doc.id,at:landingOn(doc)};
    }
    if(kind==='scene'){
      const opened=openSceneFile(text);
      return {kind:'scene',id:opened.kind==='scene'?opened.doc.id:slugOf(opened.title)||slugOf(keyOfPath(file))};
    }
  }catch{return undefined}
  return undefined;
}

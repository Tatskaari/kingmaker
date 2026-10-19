import React from 'react';
import {MUSIC_SLOTS,withMusicAssignment} from '../../../../shared/music/assignments.ts';
import type {MusicAssignments,MusicSlot} from '../../../../shared/music/assignments.ts';
import {SelectField} from '../scene/fields.tsx';
import type {TuneChoice} from './tunes.ts';

const LABELS:Record<MusicSlot,string>={morning:'Morning',afternoon:'Afternoon',evening:'Evening',night:'Night','next-morning':'Next morning',combat:'Combat'};

/** Shared music controls keep scene and map assignments identical to the game's six slots. */
export function MusicFields({music,tunes,onChange,scene=false}:{music:MusicAssignments|undefined;tunes:TuneChoice[];onChange:(music:MusicAssignments|undefined)=>void;scene?:boolean}){
  return <>
    <p className="muted">Choose tunes from your Tunes folder. {scene?'A scene’s choice takes priority over the map.':'These choices follow the player around this map.'} An empty choice uses the game’s default soundtrack.</p>
    {!tunes.length&&<p className="problems-note">No .kmtune files found. Add a tune in Tunes, or in the campaign’s lore/Tunes folder, to choose it here.</p>}
    {MUSIC_SLOTS.map(slot=><SelectField key={slot} label={`${LABELS[slot]} music`} field={`music.${slot}`} value={music?.[slot]??''} options={[{value:'',label:scene?'Use map or game default':'Use game default'},...tunes]} onChange={value=>onChange(withMusicAssignment(music,slot,value))}/>)}
  </>;
}

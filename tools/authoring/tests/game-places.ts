// The game's own code for a place, for the tests: where a spot falls on the map (shared/map/reconcile.ts)
// and the world the game builds from a place file (shared/world/scene-world.ts buildWorld).
import {asPlaceFile} from '../../../shared/scene/scenario.ts';
import type {PlaceDocument} from '../../../shared/scene/scenario.ts';
import {feetToTile as gameFeetToTile} from '../../../shared/map/reconcile.ts';
import {buildWorld} from '../../../shared/world/scene-world.ts';

export const feetToTile=(origin:{x:number;y:number},at:[number,number])=>gameFeetToTile({id:'r',name:'r',rect:{x:0,y:0,w:1,h:1},worldOrigin:origin},{x:at[0],y:at[1]});
export const build=(doc:PlaceDocument)=>{
  const place=asPlaceFile(doc);
  const people=Object.keys(place.people).filter(id=>id!=='player').map(id=>({id,name:id}));
  return buildWorld('test',place,people,{name:'The investigator'});
};

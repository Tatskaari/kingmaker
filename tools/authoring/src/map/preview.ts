// The Game preview: the map drawn by the game's own renderer (client/map/render.ts, by way of
// render.js), as the town is drawn in a terminal, with its decor and the people about at an hour.
import {frame} from './render.js';
import {asMapFile} from '../../../../shared/scene/scenario.ts';
import {mapOf} from '../../../../shared/map/tiles.ts';
import type {MapActor,Tile2,TileMap} from '../../../../shared/map/types.ts';
import type {MapDocument,TimeOfDay} from './model.ts';

/** The townsfolk's colour, for someone about without one of their own (shared/map/looks.ts). */
const TOWNSFOLK='#b8ad9c';

/** The map as the game builds it, with what stands on it: its decor, and who's about at `time`. */
export function compiled(doc:MapDocument,time:TimeOfDay):{map:TileMap;actors:MapActor[]}{
  const {map,decor}=mapOf(asMapFile(doc));
  const people:MapActor[]=(doc.people??[]).filter(person=>person.times.includes(time)).map((person,i)=>({
    id:`town:${i}`,name:person.name,kind:person.kind??'person',glyph:person.glyph,color:person.color??TOWNSFOLK,map:doc.id,at:{x:person.at.x,y:person.at.y},
    ...(person.states?{states:person.states}:{}),blocks:person.blocks??true,
  }));
  return {map,actors:[...decor,...people]};
}

export type Frame=ReturnType<typeof frame>;

/** A frame of the game's renderer: a viewport of character cells round the camera, and what tile each cell shows. */
export const preview=(map:TileMap,actors:MapActor[],camera:Tile2,viewport:{w:number;h:number},time:TimeOfDay,roofs:boolean):Frame=>frame(map,actors,camera,viewport,time,roofs);

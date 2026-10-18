import type {MapActor,Tile2,TileMap} from '../../../../shared/map/types.ts';
/** A frame of the game's renderer: a viewport of character cells round the camera, and what tile each cell shows. */
export function frame(map:TileMap,actors:MapActor[],camera:Tile2,viewport:{w:number;h:number},time:string,roofs:boolean):{lines:Array<Array<{text:string;fg?:string;bg?:string;bold?:boolean}>>;at:(x:number,y:number)=>Tile2|undefined};

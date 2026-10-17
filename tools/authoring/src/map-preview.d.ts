import type {gameMap,gameClutter,Point} from './map-model';
export function preview(map:ReturnType<typeof gameMap>,camera:Point,viewport:{w:number;h:number},night:boolean,roofs:boolean,actors?:ReturnType<typeof gameClutter>):{lines:Array<Array<{text:string;fg?:string;bg?:string;bold?:boolean}>>;at:(x:number,y:number)=>Point|undefined};

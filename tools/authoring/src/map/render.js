// The game's renderer (client/map/render.ts), as the Game preview draws with it. Plain JS with a
// declaration beside it, so the plugin's type check doesn't follow it into the client's code (which
// is checked under the game's own options, with Node's timers). A thin adapter, not a copy.
import {render,Picks} from '../../../../client/map/render.ts';

export function frame(map,actors,camera,viewport,time,roofs){
  const picks=new Picks();
  // The renderer addresses whole character cells, and the editor's camera moves smoothly: snap the
  // projected camera (not each tile axis), so the cells and their picks stay true.
  const col=Math.round(2*(camera.x+camera.y)),row=Math.round(camera.y-camera.x);
  const aligned={x:(col/2-row)/2,y:(col/2+row)/2};
  const lines=render(map,actors,aligned,viewport,{glyphs:'ascii',time,t:0,cutaway:false,focus:{x:-100,y:-100},roofs:!roofs,pick:picks});
  return {lines,at:(x,y)=>picks.at(x,y)?.at};
}

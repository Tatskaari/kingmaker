// Keep the runtime adapter small: this is the game's renderer, not a recreation.
// It imports nothing of Node; were it to, build.mjs maps that to the game's browser stand-ins (web/node).
import {render,Picks} from '../../../client/map/render.ts';
export function preview(map,camera,viewport,night,roofs,actors=[]){
  const picks=new Picks();
  // The runtime addresses discrete character cells. Editor drags have continuous
  // tile coordinates: snap the projected camera, not each tile axis, so we keep
  // character-cell pan precision and valid cell/pick indices.
  const col=Math.round(2*(camera.x+camera.y)),row=Math.round(camera.y-camera.x);
  const aligned={x:(col/2-row)/2,y:(col/2+row)/2};
  const lines=render(map,actors,aligned,viewport,{glyphs:'ascii',time:night?'night':'afternoon',t:0,cutaway:false,focus:{x:-100,y:-100},roofs:!roofs,pick:picks});
  return {lines,at:(x,y)=>picks.at(x,y)?.at};
}

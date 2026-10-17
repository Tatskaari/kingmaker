/** Run with node tools/door-options.ts [output.html] to compare the actual door renderer. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Picks, render } from '../src/game/map/render.ts';
import { doorSheet, DOOR_SHEET_CAMERA } from '../src/game/look/door-sheet.ts';
import { mapDoors } from '../src/game/look/overlay.ts';
import { DOOR_DETAILS, paintDoor, toHex } from '../src/game/look/door-art.ts';
const { map, doors } = doorSheet();
const picks = new Picks({ doors: true });
const lines = render(map, doors, DOOR_SHEET_CAMERA, { w: 80, h: 34 }, { pick: picks, cutaway: false, t: 0, glyphs: 'ascii' });
const shapes = mapDoors(picks, lines);
const options = DOOR_DETAILS.map(detail => ({ detail, doors: shapes.map(d => paintDoor({ ...d, detail })).map(d => ({ wall: d.wall, pixels: d.pixels.map(p => [p.X, p.Y, toHex(p.c)]) })) }));
const font = readFileSync(new URL('../assets/fonts/KingmakerGlyphs-Regular.ttf', import.meta.url)).toString('base64');
const target = resolve(process.argv[2] ?? 'test-output/door-options.html');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `<!doctype html><meta charset="utf-8"><title>Door options</title><style>
@font-face{font-family:Kingmaker;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}body{margin:0;padding:32px;background:#15131a;color:#ded6c5;font:15px system-ui}h1{font-size:26px;margin:0 0 8px}p{color:#aaa398}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:#201d24;border:1px solid #403b43;padding:16px;border-radius:8px}h2{font-size:19px}canvas{display:block;max-width:100%;image-rendering:pixelated}small{display:block;margin:12px 0;color:#aaa398}button{background:#35303b;color:#ded6c5;border:1px solid #625969;padding:8px 14px;cursor:pointer}article.selected{border-color:#e8c785}@media(max-width:1000px){main{grid-template-columns:1fr}}</style>
<h1>Doors, in the tile’s own palette</h1><p>Same wall, lighting and geometry. Three monochrome masks with half-cell detail. Click a choice to highlight it.</p><main></main>
<script>const lines=${JSON.stringify(lines)}, options=${JSON.stringify(options)}, shapes=${JSON.stringify(shapes)};
const labels=['A · Fine planks','B · Inset panels','C · ASCII hatch'];
const notes=['Quiet, broken vertical grain. Closest to the wall’s existing texture.','Small recessed panels. More architectural and deliberately shaped.','Tiny | : − marks. The most visibly ASCII-like surface.'];
function cell(ctx,x,y,ch,fg,bg){ctx.fillStyle=bg||'#15131a';ctx.fillRect(x*7,y*15,7,15);ctx.fillStyle=fg||'#aaa';ctx.font='15px Kingmaker, monospace';ctx.textBaseline='top';if(ch==='█')ctx.fillRect(x*7,y*15,7,15);else if(ch==='▀')ctx.fillRect(x*7,y*15,7,7);else if(ch==='▄')ctx.fillRect(x*7,y*15+7,7,8);else if(ch!==' ')ctx.fillText(ch,x*7,y*15);}
(async()=>{await document.fonts.load('15px Kingmaker');options.forEach((o,i)=>{const article=document.createElement('article');article.innerHTML='<h2>'+labels[i]+'</h2><p>'+notes[i]+'</p><small>Actual art resolution · both wall faces · all five states</small>';const c=document.createElement('canvas');c.width=560;c.height=510;const ctx=c.getContext('2d');ctx.fillStyle='#15131a';ctx.fillRect(0,0,560,510);lines.forEach((line,y)=>{let x=0;line.forEach(s=>{for(const ch of s.text)cell(ctx,x++,y,ch,s.fg,s.bg)})});o.doors.forEach(d=>{d.wall.forEach(w=>cell(ctx,...w));d.pixels.forEach(([x,y,col])=>{ctx.fillStyle=col;ctx.fillRect(x,y,1,1)})});article.append(c);const caption=document.createElement('small');caption.textContent='3× detail · shut / open / locked / barred / broken';article.append(caption);const z=document.createElement('canvas');z.width=480;z.height=144;const zc=z.getContext('2d');zc.imageSmoothingEnabled=false;shapes.filter(d=>d.face==='south').sort((a,b)=>['shut','open','locked','barred','broken'].indexOf(a.look)-['shut','open','locked','barred','broken'].indexOf(b.look)).forEach((d,j)=>{zc.drawImage(c,(d.x+1)*7-8,(d.y+1)*15-34,32,48,j*96,0,96,144)});article.append(z);const b=document.createElement('button');b.textContent='Choose '+labels[i][0];b.onclick=()=>{document.querySelectorAll('article').forEach(a=>a.classList.remove('selected'));article.classList.add('selected')};article.append(b);document.querySelector('main').append(article)});window.ready=true})();</script>`);
console.log(target);

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const output=await build({entryPoints:[new URL('../src/campaign/tunes.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {readTuneChoices}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const vault=values=>({list:folder=>Object.keys(values).filter(path=>path.startsWith(folder)),read:async path=>values[path]});

test('a campaign and a lore-root vault both discover Tunes by relative filename, including nested folders',async()=>{
  const files=vault({
    'Tunes/menu.kmtune':JSON.stringify({title:'The court awaits'}),
    'Tunes/town/night.kmtune':JSON.stringify({title:'Lanterns'}),
    'Tunes/ignore.md':'not a tune',
    'Tunes/../escape.kmtune':'{}',
    'Campaigns/caerwyn/lore/Tunes/menu.kmtune':JSON.stringify({title:'Campaign menu'}),
  });
  assert.deepEqual(await readTuneChoices('',files),[
    {value:'menu',label:'The court awaits (menu)',path:'Tunes/menu.kmtune'},
    {value:'town/night',label:'Lanterns (town/night)',path:'Tunes/town/night.kmtune'},
  ]);
  assert.equal((await readTuneChoices('Campaigns/caerwyn/',files))[0].path,'Campaigns/caerwyn/lore/Tunes/menu.kmtune');
});

test('an unreadable tune keeps a selectable filename so saved assignments do not disappear',async()=>{
  assert.deepEqual(await readTuneChoices('',vault({'lore/Tunes/draft.kmtune':'not json'})),[{value:'draft',label:'draft',path:'lore/Tunes/draft.kmtune'}]);
});

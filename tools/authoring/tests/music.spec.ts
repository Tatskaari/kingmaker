import {test,expect} from '@playwright/test';

test('scene and map music choices save all hours and combat, and undo restores an assignment',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
  await page.evaluate(()=>{
    const host=(window as any).__kingmakerHarness;
    host.writeDocument('Tunes/town/night.kmtune',{title:'Lanterns'});
    host.writeDocument('Tunes/battle.kmtune',{title:'Battle'});
  });
  await page.getByRole('tablist',{name:'Views of the scene'}).getByRole('tab',{name:'Scene',exact:true}).click();
  const night=page.getByRole('combobox',{name:'Night music',exact:true});
  await expect(night.locator('option[value="town/night"]')).toHaveText('Lanterns (town/night)');
  await night.selectOption('town/night');
  await page.getByRole('combobox',{name:'Combat music',exact:true}).selectOption('battle');
  const saved=(path:string)=>page.evaluate(path=>JSON.parse((window as any).__kingmakerHarness.files[path]),path);
  expect((await saved('scenes/hanged-clerk.kmscene')).music).toEqual({morning:'scene',afternoon:'scene',evening:'night',night:'town/night','next-morning':'scene',combat:'battle'});
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption('maps/caerwyn.kmmap');
  await page.getByRole('tablist',{name:'Views of the map'}).getByRole('tab',{name:'Map',exact:true}).click();
  for(const label of ['Morning','Afternoon','Evening','Night','Next morning'])await page.getByRole('combobox',{name:`${label} music`,exact:true}).selectOption('town/night');
  await page.getByRole('combobox',{name:'Combat music',exact:true}).selectOption('battle');
  expect((await saved('maps/caerwyn.kmmap')).music).toEqual({morning:'town/night',afternoon:'town/night',evening:'town/night',night:'town/night','next-morning':'town/night',combat:'battle'});
  await page.getByRole('combobox',{name:'Combat music',exact:true}).selectOption('');
  expect((await saved('maps/caerwyn.kmmap')).music.combat).toBeUndefined();
  await page.getByRole('button',{name:/^Undo/}).click();
  await expect(page.getByRole('combobox',{name:'Combat music',exact:true})).toHaveValue('battle');
});

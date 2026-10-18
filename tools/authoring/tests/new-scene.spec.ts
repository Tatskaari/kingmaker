import {test,expect,type Page,type Locator} from '@playwright/test';

// A new scene written from nothing in the browser test harness, every value through a control and none
// by editing the file, as an author writes one: New scene (Obsidian's New Kingmaker scene), the Scene
// view, the cast, the start and its roles, two discoveries (one required, with three paths and a roll),
// an event someone arrives at with a role, a pressure and a fact, three endings (good, mixed and bad)
// with effects, one only if a fact is settled, and routes with what they require. The scene it saves
// has no problems: the campaign check's rules find nothing.
const PATH='scenes/the-short-weight.kmscene';
const saved=async(page:Page)=>JSON.parse(await page.evaluate(path=>(window as any).__kingmakerHarness.files[path] as string,PATH));
const view=(page:Page,name:string)=>page.getByRole('tablist',{name:'Views of the scene'}).getByRole('tab',{name:new RegExp(`^${name}`)});
const inspector=(page:Page)=>page.locator('.scene-inspector .inspector-body');
const card=(page:Page,id:string)=>page.locator(`.scene-card[data-node-id="${id}"]`);
const routeCard=(page:Page,id:string)=>page.locator(`.scene-inspector .route-card[data-route-id="${id}"]`);
/** Text typed into a labelled field, and the field left (one step of undo). */
const write=async(within:Locator,label:string,text:string)=>{const field=within.getByLabel(label,{exact:true});await field.fill(text);await field.blur()};
/** [+ Add …] opened, and an option of it picked. */
const pick=async(within:Locator,add:string,option:RegExp)=>{
  await within.getByRole('button',{name:add,exact:true}).click();
  await within.locator('.add-picker').getByRole('button',{name:option}).first().click();
};
const settled=async(locator:Locator)=>{
  await locator.evaluate(element=>new Promise<void>(resolve=>{
    let previous='',stable=0;
    const sample=()=>{const box=element.getBoundingClientRect(),position=[box.x,box.y,box.width,box.height].join(',');stable=position===previous?stable+1:0;previous=position;if(stable>=5)resolve();else requestAnimationFrame(sample)};
    sample();
  }));
};
/** A node's card clicked on its header, the graph fitted first so it's in view. */
const select=async(page:Page,id:string)=>{
  if(await view(page,'Graph').getAttribute('aria-selected')!=='true')await view(page,'Graph').click();
  await page.getByRole('button',{name:'Fit graph'}).click();
  const target=card(page,id);
  await settled(target);
  const box=(await target.boundingBox())!;
  await target.click({position:{x:box.width/2,y:Math.min(10,box.height/5)}});
  await expect(page.locator(`.node-inspector[data-node="${id}"]`)).toBeVisible();
};
/** A connection on the graph clicked by its label. */
const connection=async(page:Page,label:string)=>{
  await page.getByRole('button',{name:'Fit graph'}).click();
  const text=page.locator('.react-flow__edge-text').filter({hasText:label}).first();
  await settled(text);
  await text.click();
};
/** A node renamed in its inspector. */
const rename=async(within:Locator,from:string,to:string)=>{
  await within.getByRole('button',{name:`Rename id ${from}`}).click();
  await within.getByLabel('New id',{exact:true}).fill(to);
  await within.getByLabel('New id',{exact:true}).press('Enter');
};
/** A new fact made in place, from a [+ Add …] of facts. */
const newFact=async(within:Locator,add:string,sentence:string,id:string)=>{
  await within.getByRole('button',{name:add,exact:true}).click();
  const form=within.getByRole('group',{name:'A new fact'});
  await form.getByLabel('Sentence',{exact:true}).fill(sentence);
  await form.getByLabel('Id',{exact:true}).fill(id);
  await form.getByRole('button',{name:'Add new fact'}).click();
};
/** A node added in the Add node dialog, from the node selected (its route comes too). */
const addNode=async(page:Page,from:string,kind:'Discovery'|'Event'|'Ending',title:string,id:string)=>{
  await select(page,from);
  await page.getByRole('button',{name:/^Add node/}).click();
  const dialog=page.getByRole('dialog',{name:'Add a node'});
  await dialog.getByRole('radio',{name:new RegExp(`^${kind}`)}).check();
  await dialog.getByLabel('Title',{exact:true}).fill(title);
  await dialog.getByLabel('Id',{exact:true}).fill(id);
  await dialog.getByRole('button',{name:`Add ${kind.toLowerCase()}`}).click();
  await expect(page.locator(`.node-inspector[data-node="${id}"]`)).toBeVisible();
};
/** A path written on a discovery's card. */
const path=async(within:Locator,index:number,via:string,clue:string,earn:string,strength:string,roll?:{skill:string;dc:number})=>{
  await within.getByRole('button',{name:'Add path',exact:true}).click();
  const item=within.locator(`[data-field="paths.${index}"]`);
  await item.getByLabel('Via',{exact:true}).fill(via);
  await write(item,'Clue',clue);
  await write(item,'Earn',earn);
  await item.getByRole('radio',{name:strength}).check();
  if(!roll)return;
  await item.getByRole('button',{name:'Add a roll'}).click();
  await item.getByLabel('Skill',{exact:true}).selectOption(roll.skill);
  await write(item,'DC',String(roll.dc));
};
/** An ending's result, exit kind and words. */
const ending=async(within:Locator,result:string,exitKind:string,true_:string,closing:string)=>{
  await within.getByRole('radio',{name:result}).check();
  await within.getByLabel('Exit kind',{exact:true}).selectOption(exitKind);
  await write(within,'What\'s true',true_);
  await write(within,'Closing',closing);
};
/** An effect added to an ending, its form filled in. */
const effect=async(within:Locator,index:number,op:RegExp,fill:(effect:Locator)=>Promise<void>)=>{
  const effects=within.locator('fieldset.effects');
  await pick(effects,'Add effect',op);
  await fill(effects.locator(`[data-field="effects.${index}"]`));
};

test('a new scene written from nothing, every value through a control: the campaign check finds no problems in it',async({page})=>{
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
  page.once('dialog',dialog=>void dialog.accept('The Short Weight'));
  await page.getByRole('button',{name:'New scene'}).click();
  await expect(page.locator('.file-path')).toHaveText(PATH);
  await expect(page.getByRole('heading',{level:1})).toHaveText('The Short Weight');

  // The scene's own fields.
  await view(page,'Scene').click();
  const scene=page.locator('.scene-view');
  await write(scene,'Description','A miller accused of short-weighting the almshouse flour.');
  await write(scene,'Hook','The almshouse flour comes up short every week, and the miller swears his weights are honest.');
  await write(scene,'Setting','Hale\'s mill on the Caer brook, mid-morning: the wheel thumping, flour dust in the sunlight.');
  await write(scene,'Premise','Who is stealing the poor\'s flour, and can the player show it before the cart goes?');
  await write(scene,'Truth','Hale is honest. His son Tam swaps the almshouse sacks for short ones at the loading door.');
  await write(scene,'Clock','At noon the almshouse cart collects the sacks.');
  await scene.getByLabel('Time',{exact:true}).selectOption('morning');

  // The cast: three people, each with the words a card must have.
  await view(page,'Cast').click();
  for(const [name,id] of [['Osric Hale','hale'],['Brother Anselm','anselm'],['Tam Hale','tam']]){
    await page.locator('.cast-view').getByRole('button',{name:'Add person',exact:true}).click();
    const form=page.getByRole('group',{name:'Add a person'});
    await form.getByLabel('New person\'s name').fill(name);
    await form.getByLabel('New person\'s id').fill(id);
    await form.getByRole('button',{name:'Add person'}).click();
    const person=page.locator(`.cast-detail[data-cast="${id}"]`);
    for(const field of ['Look','Voice','Attitude','Wants','Why here'])await write(person,field,`${name}: ${field.toLowerCase()}.`);
    await person.getByRole('button',{name:'Add what they know'}).click();
    await page.keyboard.type(`What ${name} knows.`);
    await page.keyboard.press('Tab');
  }

  // The start and two people's roles there.
  await select(page,'start');
  await write(inspector(page),'Title','At the mill door');
  await write(inspector(page),'Opening','Anselm is waving a ledger at the miller in the yard: the relief flour is short again.');
  for(const name of [/^Osric Hale/,/^Brother Anselm/]){
    await pick(inspector(page).locator('.roles-field'),'Add role',name);
    await page.keyboard.type('Defends himself, or his ledger, loudly.');
    await page.keyboard.press('Tab');
  }

  // The skeleton's discovery, renamed and written: two paths, and a fact it settles.
  await select(page,'discovery');
  await rename(inspector(page),'discovery','weights-true');
  await write(inspector(page),'Title','The weights are true');
  await write(inspector(page),'Revelation','Hale\'s weights are honest: the flour goes short after it\'s weighed.');
  await write(inspector(page),'How to play it','Let the player weigh anything they like.');
  await path(inspector(page),0,'hale','The market\'s stamp on each weight.','Free: he insists on it.','Strong');
  await path(inspector(page),1,'the counting table','A sack weighed in front of the player is full.','Free to anyone who asks.','Proof');
  await newFact(inspector(page),'Add fact','The miller\'s weights are true.','weights-checked');
  // The route into it took its new title.
  await expect(page.locator('.react-flow__edge-text').filter({hasText:'Find The weights are true'})).toHaveCount(1);

  // A required discovery from the start, beside the first (not on it): three paths, one with a roll.
  await addNode(page,'start','Discovery','Tam swaps the sacks','tam-swaps');
  await inspector(page).getByRole('checkbox',{name:'Required'}).check();
  await write(inspector(page),'Revelation','Tam swaps the full almshouse sacks for short ones at the loading door.');
  await write(inspector(page),'How to play it','The lead the scene can\'t end well without.');
  await path(inspector(page),0,'anselm','His ledger: the short sacks are always the loading door\'s.','Free, if asked.','Suggestive');
  await path(inspector(page),1,'the loading door','Short sacks stencilled for the almshouse.','Getting behind the door.','Proof');
  await path(inspector(page),2,'tam','New boots and too many jokes about weights.','Reading him.','Hook',{skill:'insight',dc:13});
  const [first,second]=[(await card(page,'weights-true').boundingBox())!,(await card(page,'tam-swaps').boundingBox())!];
  expect(second.y>=first.y+first.height||second.x>=first.x+first.width,'a new card isn\'t on another').toBe(true);

  // An event from the start: Tam arrives there, with a role, a pressure and a fact settled.
  await addNode(page,'start','Event','The cart comes early','cart-early');
  await write(inspector(page),'What happens','Tam drives the almshouse cart in an hour early and starts loading.');
  await inspector(page).getByRole('button',{name:'Add pressure'}).click();
  await page.keyboard.type('Tam loads fast, two sacks at a time.');
  await page.keyboard.press('Tab');
  await pick(inspector(page).locator('.arrivals'),'Add person',/^Tam Hale/);
  await pick(inspector(page).locator('.roles-field'),'Add role',/^Tam Hale/);
  await page.keyboard.type('Keeps himself between the player and the loading door.');
  await page.keyboard.press('Tab');
  await newFact(inspector(page),'Add fact','The almshouse cart has come early.','cart-came');

  // The endings: the skeleton's made good, then a mixed and a bad one from the event; each with effects, one only if a fact is settled.
  await select(page,'ending');
  await rename(inspector(page),'ending','tam-owns-up');
  await write(inspector(page),'Title','Tam owns up');
  await ending(inspector(page),'Good','persuaded','Tam admits the swap; the almshouse gets its flour.','Hale puts a floury hand on his son\'s shoulder.');
  await inspector(page).getByLabel('Next scene',{exact:true}).selectOption('caerwyn-afternoon');
  await effect(inspector(page),0,/^Attitude/,async item=>{
    await item.getByLabel('Who',{exact:true}).selectOption('anselm');
    await write(item,'Text','The player found the thief.');
  });
  await effect(inspector(page),1,/^Remember/,async item=>{
    await write(item,'What they remember','The investigator weighed my flour before listening to the almsbrother.');
    await pick(item.locator('[data-field="if"]'),'Only if a fact is settled',/^weights-checked/);
  });
  await addNode(page,'cart-early','Ending','The sacks are made good','sacks-made-good');
  await ending(inspector(page),'Mixed','progress','Hale makes the sacks good from his own bins.','Anselm climbs onto the cart.');
  await effect(inspector(page),0,/^Flag/,async item=>{await write(item,'Flag name','almshouse-flour');await write(item,'Flag value','made-good')});
  await addNode(page,'cart-early','Ending','Hale takes the blame','hale-blamed');
  await ending(inspector(page),'Bad','leave','The cart leaves with the short sacks; Hale is called a cheat.','Hale shuts the mill door.');
  await effect(inspector(page),0,/^Attitude/,async item=>{
    await item.getByLabel('Attitude',{exact:true}).selectOption('hostile');
    await write(item,'Text','The player stood by.');
  });

  // The routes: the conditions, a way into the good ending drawn from the required discovery (it requires it, with a roll), and the mixed one requiring the weights.
  await connection(page,'The cart comes early');
  await write(routeCard(page,'to-cart-early'),'Condition','Late in the morning, before the player has caught the swap.');
  await select(page,'tam-swaps');
  await inspector(page).getByRole('button',{name:'Add route to…'}).click();
  await settled(card(page,'tam-owns-up'));
  await card(page,'tam-owns-up').click({position:{x:40,y:10}});
  const confront=routeCard(page,'to-tam-owns-up');
  await write(confront,'Condition','The player confronts Tam with the swap, and he owns up.');
  await pick(confront,'Add beat',/^Tam swaps the sacks/);
  await confront.getByRole('button',{name:'Add a roll'}).click();
  await confront.getByLabel('Skill',{exact:true}).selectOption('persuasion');
  await connection(page,'The sacks are made good');
  const madeGood=routeCard(page,'to-sacks-made-good');
  await write(madeGood,'Condition','Hale makes the short sacks good before the cart leaves.');
  await pick(madeGood,'Add beat',/^The weights are true/);
  await connection(page,'Hale takes the blame');
  await write(routeCard(page,'to-hale-blamed'),'Condition','The cart leaves with the short sacks.');

  // No problems: the campaign check's rules find nothing; only the note that campaign.json doesn't list it yet.
  await expect(view(page,'Problems')).toHaveAttribute('aria-label','Problems (0)');
  await view(page,'Problems').click();
  await expect(page.locator('.problems-view')).toContainText('No problems');
  await expect(page.locator('.problems-view')).toContainText('the-short-weight isn\'t one of campaign.json\'s scenes');
  await page.screenshot({path:'dist/screenshots/new-scene.png'});

  // The file, as the game will read it.
  const doc=await saved(page);
  expect(doc.id).toBe('the-short-weight');
  expect(doc.nodes.map((node:any)=>[node.id,node.data.kind,node.data.result??node.data.revelation!==undefined])).toEqual([
    ['start','start',false],['weights-true','beat',true],['tam-owns-up','exit','good'],['tam-swaps','beat',true],['cart-early','beat',false],['sacks-made-good','exit','mixed'],['hale-blamed','exit','bad'],
  ]);
  expect(doc.nodes[0].data.cast).toEqual({hale:'Defends himself, or his ledger, loudly.',anselm:'Defends himself, or his ledger, loudly.'});
  expect(doc.nodes[3].data.required).toBe(true);
  expect(doc.nodes[3].data.paths.map((p:any)=>p.check??null)).toEqual([null,null,{skill:'insight',dc:13}]);
  expect(doc.nodes[4].data).toMatchObject({cast:{tam:'Keeps himself between the player and the loading door.'},pressure:'Tam loads fast, two sacks at a time.',establishes:['cart-came']});
  expect(doc.cast.find((member:any)=>member.id==='tam').enters).toBe('cart-early');
  expect(doc.facts).toEqual({'weights-checked':'The miller\'s weights are true.','cart-came':'The almshouse cart has come early.'});
  expect(doc.nodes[2].data.effects[1]).toEqual({op:'remember',who:'hale',text:'The investigator weighed my flour before listening to the almsbrother.',if:{established:'weights-checked'}});
  expect(doc.edges.map((route:any)=>[route.id,route.source,route.target,route.label,route.data.requires??null,route.data.skill])).toEqual([
    ['find-discovery','start','weights-true','Find The weights are true',null,''],
    ['find-tam-swaps','start','tam-swaps','Find Tam swaps the sacks',null,''],
    ['to-cart-early','start','cart-early','The cart comes early',null,''],
    ['to-sacks-made-good','cart-early','sacks-made-good','The sacks are made good',['weights-true'],''],
    ['to-hale-blamed','cart-early','hale-blamed','Hale takes the blame',null,''],
    ['to-tam-owns-up','tam-swaps','tam-owns-up','Tam owns up',['tam-swaps'],'persuasion'],
  ]);

  // And the story can be sent to it from another scene before campaign.json lists it: offered, and the problems say it isn't listed yet.
  await page.getByRole('combobox',{name:'Test file',exact:true}).selectOption('scenes/hanged-clerk.kmscene');
  await expect(page.locator('.file-path')).toHaveText('scenes/hanged-clerk.kmscene');
  await select(page,'failed');
  await inspector(page).getByLabel('Next scene',{exact:true}).selectOption({label:'the-short-weight (a scene file campaign.json doesn\'t list yet)'});
  await expect.poll(async()=>JSON.parse(await page.evaluate(()=>(window as any).__kingmakerHarness.files['scenes/hanged-clerk.kmscene'])).nodes.find((node:any)=>node.id==='failed').data.next).toBe('the-short-weight');
  await view(page,'Problems').click();
  await expect(page.locator('.problems-view .problem')).toHaveText([/ending failed goes on to the-short-weight, which isn't one of the campaign's scenes/]);
});

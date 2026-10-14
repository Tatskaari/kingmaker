import type { Scene } from "../src/runtime/scene.ts";

/**
 * Disco Elysium's "Pay for damages" (Garte's itemised bill) moved to the toll bridge on the King's
 * Road (docs/research/scene-sources.md §5.3, §7.3). A 1:1 negotiation: the bill has separate
 * charges, each removable by a specific key (catch the levy's wording, peace-bond the bow, settle
 * before the sunset bell, pay in kind), and one fixed charge (the King's penny). The twist is
 * underneath the haggle: Garrow is lonely, and ashamed of laughing Tam Hollis away, because a
 * goblin arrow hit his door minutes later. Bringing that home to him opens his own Book's Clause of
 * Perils, which lets the party pass free. Tricks, threats, sneaking and running all have endings;
 * going round the bridge does not.
 */
export const garrowsToll: Scene = {
  id: "garrows-toll",
  title: "Garrow's Toll",
  summary: "A petty, lonely toll warden, an itemised toll, and the farmer he laughed away this morning.",
  setting: "Late on a short winter afternoon, a mile on from the crossroads towards Caerwyn, the King's Road crosses the river by a humpbacked stone bridge. The river below is in winter spate: brown, loud and freezing. At the near end stands the toll house: whitewashed stone, a smoking chimney, a bell on a bracket by the door, and a string of Centennial bunting that someone has hung by himself, crookedly. A red-and-white striped bar on a post closes the mouth of the bridge at waist height; anyone could duck under it, and nobody does, because it's the King's. Beside it stands a painted toll board, and under that two fresh paper notices: Marshal Holt's arms order for Assembly week, and the Treasury's Assembly levy, whose small print says it 'may be collected from such travellers as are able and willing'. Through the half-door: a counter with the great ledger and the Warden's Book on a chain, a drawer under the counter, a strongbox bolted to the floor, a kettle on the hob and two cups set out. A grey goose, the Sergeant, patrols the bar and hisses at strangers. At head height in the toll-house door there's a small, fresh, splintered hole. Across the road runs a blackthorn hedge; in the frozen mud beneath it, if anyone looks, are small bare clawed footprints. The road is empty both ways.",
  premise: "What does it cost to get past Garrow's bar, and will anyone get past the petty rules man to the lonely, frightened one who laughed Tam Hollis away this morning?",
  hook: "You're travelling the King's Road towards Caerwyn for the Centennial Assembly. A mile past the crossroads the road crosses a river by an old stone bridge, with a toll house at the near end.",
  opening: "Describe the humpbacked bridge over the loud winter river, the whitewashed toll house with its crooked bunting, and the goose patrolling the bar. Garrow steps out with the ledger under his arm and lowers the bar with great ceremony, though the road is otherwise empty. Leave the small fresh splintered hole in the toll-house door visible but unexplained. He reads out the toll that applies to the party, item by item and with relish, and ends with his pencil poised over the ledger, asking for their names and business.",
  cast: [
    {
      id: "garrow",
      name: "Garrow",
      look: "Sixty, thin as a quill, a much-darned blue warden's coat with brass buttons polished to nothing, spectacles on a string, ink to the knuckles. Carries the great ledger like a hymn book; a cudgel he has never used hangs on a nail inside the door.",
      voice: "Precise and pedantic: savours sums, clause names and the word 'traveller', and reads aloud as he writes. Sarcastic when his dignity is touched, stiffly formal when frightened, tender only with his goose.",
      wants: "To take the toll properly, write everyone in the ledger and be treated as an officer of the King. Underneath: company, and a way to put right what he did to Tam Hollis without being laughed at.",
      fears: "Being made a fool of again. Goblins, since this morning. Marshal Holt hearing that he laughed off a report of goblins on the Assembly road. That he has become a small, mean man.",
      knows: [
        "The toll board: the King's penny (one silver penny a head, on foot); beasts and barrows, two pennies; after the sunset bell, the lamp penny (one penny, for lighting the lantern to write you down by). Exempt: the King's business, under seal.",
        "A traveller on foot with one weapon owes fifteen pennies: the King's penny, the twelve-penny levy and two for the weapon.",
        "The two fresh notices: Marshal Holt's arms order (two pennies for each weapon borne on the King's Road in Assembly week; weapons peace-bonded by the warden go free, and he ties them with red cord and a wax seal) and the Treasury's Assembly levy (one shilling a head, twelve pennies, to defray the costs of the Centennial), which he has been collecting from everyone.",
        "The Book allows payment in kind or in labour at the warden's valuation (he values things stingily), but no credit: no IOUs, nothing 'on the way back'. He can't change gold: the strongbox holds only pennies.",
        "The Book's fines, which he knows by heart: attempted bribery of a warden, ten pennies; false declaration, a shilling; evading or attempting to evade the toll, double the toll; threatening an officer of the Road, a shilling, and it goes in the ledger for the Marshal.",
        "Any traveller may ask to see the Book, and he must show it, though he hovers.",
        "At first light Tam Hollis, a farmer from down the drovers' track, came in muddy and wild-eyed, raving about goblins. Garrow fined him two pennies for drunkenness and spreading alarm on the King's Road, and it's in the ledger. He tells it as a funny story.",
        "His two toll-men were sent to Caerwyn at noon to line the streets for the Assembly. He's minding the bar alone, and the Book forbids leaving it unattended.",
        "Who has been through today: a turnip carter at dawn; the Kläggenheim delegation's baggage train at mid-morning (exact change, not a word); two Nine Furrows students who argued for an hour over whether a staff is a weapon (it is: two pennies); nobody since noon.",
        "Caerwyn is a few hours' walk on. Marshal Holt and the King are there for the Assembly.",
      ],
      secrets: [
        "Minutes after Tam left, a crude black-fletched arrow thunked into the toll-house door from the hedge across the road. Garrow pulled it out, shut it in the drawer under the counter and has told no one; the hole is still in the door. He hasn't written it in the ledger, which for him is nearly a crime, and he has jumped at every rustle since.",
        "The Book's Clause of Perils: a traveller who brings the warden true report of peril upon the Road passes free, and the warden must send word to the Marshal at Caerwyn without delay. He did neither for Tam, and now he has nobody to send. Applying it means admitting, in writing, that he laughed off a true report. It's there in the Book for anyone who reads it, and if asked straight out what exemptions the Book allows, he won't lie about the Book: he'll mumble it.",
        "He's lonely. Twenty-two years at this bar; his men gone to the city; nobody invited him to anything. The second cup is for whoever stops, and nobody has. He drags the toll out for the conversation. An hour of honest company would get every charge he can honestly drop dropped, and he might pay the King's penny out of his own pocket rather than waive it. He'd sooner be fined himself than say any of this.",
      ],
      attitude: "Officious and delighted to have someone to charge; suspicious of anyone who looks like trouble; scoffs at goblin talk. Warms, against his will, to anyone who takes the Book seriously or simply talks to him.",
    },
  ],
  start: "the-bill",
  beats: [
    {
      id: "the-bill",
      title: "The King's penny",
      direction: "The negotiation. Garrow has a captive audience and means to enjoy it: he tallies the toll against the party in front of him, writes as he talks, and explains any rule at length. He's petty but honest by his own lights: every charge has a reason on the board, the notices or in the Book, he never invents one, and he'll hear an argument about any of them. A point the notices or the Book plainly support wins without dice, with a pained sigh and an amendment in the ledger. The King's penny is the one charge he will not drop. Let the player enjoy the haggle, and keep the sums consistent once stated.",
      cast: { garrow: "Tally the bill and take names and business for the ledger. Treat the levy as compulsory until someone catches the notice's wording, then concede it with ill grace. Laugh off goblins and Tam Hollis; jump when the hedge rustles. Asked about the hole in the door, fob it off (a cart-shaft, woodworm) rather than say what made it." },
      pressure: "The sun touches the hedge-tops; Garrow fetches the lantern and lays a hand on the bell-rope, because after the sunset bell comes the lamp penny. Or the hedge across the road rustles, and he jumps and glances at his own door.",
      transitions: [
        { id: "pays", when: "The toll has actually been paid (coins or goods handed over, the agreed work done, or someone else paying it for them) and Garrow has lifted the bar for the party.", to: "paid" },
        {
          id: "argue-charge", on: "attempt",
          when: "The player tries to talk Garrow into dropping or cutting a charge he is entitled to, on grounds that have nothing to do with goblins or Tam Hollis: pleading poverty, offering a deal, appealing to his better nature, or arguing that a rule shouldn't apply to them. (Simply pointing out what the notices or the Book actually say, such as the levy notice's 'able and willing', needs no dice: he is honest about his rules.)",
          check: { skill: "persuasion", dc: 12, success: "Garrow consults the Book, sighs through his nose and concedes: that charge comes off, or the sum comes down, and he amends the ledger with a pained flourish. Never the King's penny, and the bar stays down until the rest is actually paid.", failure: "Garrow quotes the clause from memory and the charge stands. Pressing the same point again makes it his final offer; a new argument or a real offer still gets a hearing.", onSuccess: "the-bill" },
        },
        {
          id: "deceive", on: "attempt",
          when: "The player tries to get through free or cheaply by deceiving Garrow: claiming to be on the King's business or otherwise exempt, showing a false seal or pass, or telling some other lie. (Reports of goblins on the road are not lies: they're true.)",
          check: { skill: "deception", dc: 14, success: "Garrow peers at it, at them, and at it again, and decides to believe. He lifts the bar with ceremony and writes every word of their claim in the ledger.", failure: "Garrow knows a royal seal when he sees one, and a lie when he hears one. He's offended, and the Book has a fine for false declarations.", onSuccess: "bluffed", onFailure: "dug-in" },
        },
        {
          id: "intimidate", on: "attempt",
          when: "The player threatens Garrow (with violence, with their rank or friends, with ruin or a report to his superiors) to make him lift the bar or drop the toll.",
          check: { skill: "intimidation", dc: 14, success: "Garrow goes grey, fumbles the padlock and lifts the bar, writing with a shaking hand: it will all be in the ledger.", failure: "Garrow goes white to the lips and stands his ground: twenty-two years at this bar. The threat goes in the ledger, with the fine for it.", onSuccess: "cowed", onFailure: "dug-in" },
        },
        { id: "goblins-raised", when: "The goblins or Tam Hollis have come up in earnest: the player has reported goblins on the road, defended Tam's story, shown goblin evidence or asked about the hole in the toll-house door, and Garrow has answered without admitting anything.", to: "goblin-talk" },
        { id: "cracks", when: "Garrow has admitted (in words, or by bringing out the goblin arrow he hid) that Tam Hollis was telling the truth, because the party showed him something he couldn't wave away (goblin evidence, the tracks under the hedge, the hole in his own door) or gave him a decent way to admit it.", to: "confession", establishes: ["Garrow has admitted that Tam Hollis was telling the truth about the goblins."] },
      ],
    },
    {
      id: "goblin-talk",
      title: "Tam Hollis's goblins",
      direction: "The sore spot. Garrow's denial is loud and a little too quick: Tam was drunk, it's in the ledger, he fined him for it. But he doesn't believe himself, and it shows in the glances (at his door, at the hedge, at the drawer under the counter). This beat is for the player to notice that and decide what to do with it. Bare assertion alone won't shift him, but he has no answer to something he can see (goblin evidence, the tracks under the hedge) or to a decent way out (a kindness, a face-saving reason to set the record straight), and every push should cost his denial something visible. The bill still stands meanwhile.",
      cast: { garrow: "Insist Tam was drunk and quote the ledger. Flinch at noises from the hedge. When cornered, retreat into the toll and the rules." },
      pressure: "The goose stretches her neck towards the hedge across the road and hisses at nothing, and Garrow's hand goes to the drawer under the counter.",
      transitions: [
        { id: "cracks", when: "Garrow has admitted (in words, or by bringing out the goblin arrow he hid) that Tam Hollis was telling the truth, because the party showed him something he couldn't wave away (goblin evidence, the tracks under the hedge, the hole in his own door) or gave him a decent way to admit it.", to: "confession", establishes: ["Garrow has admitted that Tam Hollis was telling the truth about the goblins."] },
        {
          id: "read-garrow", on: "attempt",
          when: "The player quietly studies Garrow to judge whether he believes what he's saying, or what he's hiding: watching him, not arguing with him, confronting him or showing him anything.",
          check: { skill: "insight", dc: 11, success: "He doesn't believe a word of it. He's frightened, his eyes keep going to the splintered hole in his door and the drawer under the counter, and he's ashamed of something.", failure: "He gives nothing away that the player can read: he seems simply a man who thinks Tam Hollis drinks.", onSuccess: "goblin-talk" },
        },
        {
          id: "convince", on: "attempt",
          when: "The player argues or insists that Tam was telling the truth and presses Garrow to admit it, with nothing new to show him. (Showing him goblin evidence or the tracks, or offering him a decent way to admit it, needs no dice.)",
          check: { skill: "persuasion", dc: 12, success: "Something in it gets through: Garrow's bluster runs out mid-sentence, and he looks at the hole in his own door.", failure: "Garrow snaps the ledger shut and steers back to the toll, but he's rattled and it shows: the next push will find him weaker.", onSuccess: "confession" },
        },
        { id: "pays", when: "The toll has actually been paid (coins or goods handed over, the agreed work done, or someone else paying it for them) and Garrow has lifted the bar for the party.", to: "paid" },
        {
          id: "deceive", on: "attempt",
          when: "The player tries to get through free or cheaply by deceiving Garrow: claiming to be on the King's business or otherwise exempt, showing a false seal or pass, or telling some other lie. (Reports of goblins on the road are not lies: they're true.)",
          check: { skill: "deception", dc: 14, success: "Garrow peers at it, at them, and at it again, and decides to believe. He lifts the bar with ceremony and writes every word of their claim in the ledger.", failure: "Garrow knows a royal seal when he sees one, and a lie when he hears one. He's offended, and the Book has a fine for false declarations.", onSuccess: "bluffed", onFailure: "dug-in" },
        },
        {
          id: "intimidate", on: "attempt",
          when: "The player threatens Garrow (with violence, with their rank or friends, with ruin or a report to his superiors) to make him lift the bar or drop the toll.",
          check: { skill: "intimidation", dc: 14, success: "Garrow goes grey, fumbles the padlock and lifts the bar, writing with a shaking hand: it will all be in the ledger.", failure: "Garrow goes white to the lips and stands his ground: twenty-two years at this bar. The threat goes in the ledger, with the fine for it.", onSuccess: "cowed", onFailure: "dug-in" },
        },
      ],
    },
    {
      id: "confession",
      title: "The arrow in the drawer",
      direction: "The heart of the scene. Garrow has admitted it, and the rest comes out of him, stiffly or all in a rush: the arrow, the two pennies he fined a frightened man, the Clause of Perils he didn't honour, his men gone and nobody to send word to the Marshal. By his own Book the party now passes free, and he will honour that, because rules are rules; what he needs is a way to do it without being a laughing stock. Give the player room to respond to him, and don't hurry him to the bar. Whatever they do with him now, he'll remember.",
      cast: { garrow: "Admit it, then fret about the Marshal and the clause. Kindness disarms you; mockery stiffens you straight back into the rules." },
      pressure: "Garrow turns the arrow over in his ink-stained fingers and asks the player, very stiffly, what he ought to write in the ledger.",
      transitions: [
        { id: "clause-applied", when: "Garrow has lifted the bar for the party, now that he has admitted Tam was right (free under his Clause of Perils, unless they insisted on paying).", to: "tam-was-right" },
        { id: "blackmail", on: "attempt", when: "The player threatens to expose Garrow's failures (laughing off Tam's report, not sending word to the Marshal) unless he does what they want.", to: "cowed" },
      ],
    },
    {
      id: "dug-in",
      title: "By the Book",
      direction: "The cost of failure, not the end of the scene. Whatever the player just tried (a lie, a threat, a sneak or a dash) has gone in the ledger with the fine the Book sets for it, and Garrow is watching them like a hawk. He can still be paid (fines included), apologised to, or reached another way, and the truth about the goblins still rattles him. The same trick won't work twice; anything genuinely new still gets a hearing.",
      cast: { garrow: "Recite the fine with grim satisfaction. Keep a hand on the bell-rope and an eye on the player. Thaw a little for a real apology." },
      pressure: "Garrow lights the lantern, adds the lamp penny to the bill with relish, and asks whether the party means to pay or to stand at his bar all night.",
      transitions: [
        { id: "pays", when: "The toll, fines included, has actually been paid (coins or goods handed over, the agreed work done, or someone else paying it for them) and Garrow has lifted the bar for the party.", to: "paid" },
        { id: "apology", when: "The player has sincerely apologised or made amends, and Garrow has accepted it and calmed down (the fines may stand).", to: "the-bill" },
        { id: "goblins-raised", when: "The goblins or Tam Hollis have come up in earnest: the player has reported goblins on the road, defended Tam's story, shown goblin evidence or asked about the hole in the toll-house door, and Garrow has answered without admitting anything.", to: "goblin-talk" },
        { id: "cracks", when: "Garrow has admitted (in words, or by bringing out the goblin arrow he hid) that Tam Hollis was telling the truth, because the party showed him something he couldn't wave away (goblin evidence, the tracks under the hedge, the hole in his own door) or gave him a decent way to admit it.", to: "confession", establishes: ["Garrow has admitted that Tam Hollis was telling the truth about the goblins."] },
        {
          id: "threaten-again", on: "attempt",
          when: "After being caught out once, the player threatens Garrow again, or harder, to make him lift the bar or drop the toll.",
          check: { skill: "intimidation", dc: 16, success: "Something finally gives in him: he lifts the bar with shaking hands and writes it all down.", failure: "Garrow's mouth sets. Threats won't move him now, and another line goes in the ledger for the Marshal.", onSuccess: "cowed" },
        },
        {
          id: "lie-again", on: "attempt",
          when: "After being caught out once, the player tries a new deception to get through free or cheaply: a different story, pass or claim. (Reports of goblins on the road are not lies: they're true.)",
          check: { skill: "deception", dc: 16, success: "Against his better judgement Garrow wants to believe it, and does: up goes the bar, and down it all goes in the ledger.", failure: "Garrow doesn't even look up from the ledger as he writes in another fine.", onSuccess: "bluffed" },
        },
      ],
    },
  ],
  anytime: [
    {
      id: "sneak", on: "attempt",
      when: "The player tries to get past the bar without Garrow noticing: slipping under it or over the bridge parapet while he's distracted, indoors or looking away.",
      check: { skill: "stealth", dc: 13, success: "They're past the bar and over the bridge unseen; behind them the goose honks once, and Garrow tells her to hush.", failure: "The goose sees them first. Her shriek brings Garrow round, and they're caught halfway, in full view of the ledger.", onSuccess: "slipped-past", onFailure: "dug-in" },
    },
    {
      id: "run", on: "attempt",
      when: "The player openly makes for the far side of the bridge without paying or leave: dashing, ducking or vaulting the bar, or lifting it and going, in plain sight.",
      check: { skill: "acrobatics", dc: 11, success: "They're past the bar and across the frosty cobbles before Garrow can do more than shout; the goose chases them halfway over the bridge.", failure: "The goose gets there first, or the frost does: they go down in a heap on the cobbles with Garrow standing over them, pencil already moving.", onSuccess: "ran-the-bar", onFailure: "dug-in" },
    },
    { id: "attack", on: "attempt", when: "The player attacks Garrow, grabs him or shoves him aside by force, to get past or to take something.", to: "forced" },
    { id: "walk-away", on: "attempt", when: "The party gives up on crossing here and walks away from the toll house: back down the road the way they came, or off on the long trek to another crossing. (Looking for a way across nearby, or trying to ford or swim the river here, is not leaving.)", to: "turned-back" },
    { id: "other-remedy", when: "The party has got across the bridge, or Garrow has lifted the bar for them, by some other means established in play that none of the other routes covers (not by paying, his Clause of Perils, a lie, a threat, force, sneaking or running).", to: "other-remedy" },
  ],
  exits: [
    {
      id: "paid", kind: "progress", title: "Paid",
      outcome: "The party settled the toll (in coin, in kind or in labour, or with someone paying on their behalf) and crossed the bridge with Garrow's leave.",
      closing: "Garrow lifts the bar with as much ceremony as he lowered it, blots the ledger and tells the goose to let them by. Give him a last word, and end with the party on the far side of the bridge, the road to Caerwyn ahead.",
      script: (world) => {
        world.setFlag("garrows_toll", "paid");
        world.journal("Paid Garrow's toll at the bridge on the King's Road and crossed towards Caerwyn.");
      },
    },
    {
      id: "tam-was-right", kind: "persuaded", title: "Tam was right",
      outcome: "Garrow admitted Tam Hollis was right about the goblins and let the party cross free under his own Clause of Perils. Now he has to send word to Marshal Holt.",
      closing: "Garrow lifts the bar himself, formally, for travellers bringing true report of peril upon the Road. Let him say, in his own stiff way, what he means to do about Tam (and about getting word to the Marshal, unless the party is carrying it), and end with the party crossing the bridge as the lantern comes on behind them.",
      script: (world) => {
        world.setFlag("garrows_toll", "waived");
        world.setFlag("garrow_believes_tam", true);
        world.character("garrow").remember("Tam Hollis was telling the truth about the goblins. The party brought it home to him, and he let them cross under the Clause of Perils.");
        world.character("garrow").setAttitude("friendly", "They brought him the truth about Tam's goblins and let him put it right by the Book.");
        world.promise({ by: "garrow", to: "Marshal Holt", what: "Send word of goblins on the King's Road, as the Clause of Perils requires." });
        world.journal("Garrow admitted Tam Hollis was right about the goblins and let us cross his bridge free.");
      },
    },
    {
      id: "bluffed", kind: "persuaded", title: "Waved through on a story",
      outcome: "Garrow believed the party's story (a claim, a pass or a seal) and let them through free or cheaply. Their claim is written in his ledger.",
      closing: "Garrow lifts the bar with the little bow he thinks their claim deserves and reads back what he has written in the ledger. End with the party on the far side of the bridge.",
      script: (world) => {
        world.setFlag("garrows_toll", "bluffed");
        world.character("garrow").remember("Let the party through on the strength of what they told him; their claim is in the ledger.");
        world.journal("Talked our way past Garrow's toll with a story he believed.");
      },
    },
    {
      id: "cowed", kind: "persuaded", title: "Lifted under threat",
      outcome: "Garrow lifted the bar because the party threatened him. He wrote down everything, and the Marshal will hear of it.",
      closing: "Garrow lifts the bar with shaking hands and won't look at them as they pass; behind them they hear the scratch of his pencil. End on the far side of the bridge.",
      script: (world) => {
        world.setFlag("garrows_toll", "threatened");
        world.setFlag("warden_threatened", true);
        world.character("garrow").setAttitude("hostile", "The party threatened him into lifting the King's bar.");
        world.character("garrow").remember("The party threatened him at his own bar; he wrote it all down for the Marshal.");
        world.journal("Threatened Garrow into lifting his bar. He wrote it all down.");
      },
    },
    {
      id: "slipped-past", kind: "other", title: "Slipped past",
      outcome: "The party got across the bridge without paying and without Garrow seeing them go.",
      closing: "Narrate the far side of the bridge in the dusk, the toll-house window glowing behind them, and Garrow none the wiser.",
      script: (world) => {
        world.setFlag("garrows_toll", "evaded");
        world.journal("Slipped past Garrow's toll bar without paying.");
      },
    },
    {
      id: "ran-the-bar", kind: "other", title: "Ran the bar",
      outcome: "The party ran the bar in plain sight and got across without paying. Garrow can't chase them, but he saw them, and he writes everything down.",
      closing: "Garrow's shouting and the goose's honking follow them over the bridge; when they look back, he's already writing. End on the far side.",
      script: (world) => {
        world.setFlag("garrows_toll", "evaded");
        world.setFlag("warden_reports_party", true);
        world.character("garrow").setAttitude("unfriendly", "The party ran his bar without paying.");
        world.character("garrow").remember("The party ran the King's bar in front of him; he wrote down what they looked like for the Marshal.");
        world.journal("Ran Garrow's toll bar without paying. He saw us.");
      },
    },
    {
      id: "forced", kind: "other", title: "Forced the bar",
      outcome: "The party used force on Garrow to get past his bar. He's shaken, perhaps hurt, and he'll report an assault on an officer of the King's Road.",
      closing: "Close on what the force left behind at the bar, and on Garrow's voice behind them promising that the Marshal will hear of this. End on the far side of the bridge.",
      script: (world) => {
        world.setFlag("garrows_toll", "forced");
        world.setFlag("warden_assaulted", true);
        world.character("garrow").setAttitude("hostile", "The party laid hands on him and forced the King's bar.");
        world.character("garrow").remember("The party used force on him at his own bar; he'll report it to the Marshal.");
        world.journal("Forced our way past Garrow's toll bar.");
      },
    },
    {
      id: "other-remedy", kind: "progress", title: "Across another way",
      outcome: "The party got across the bridge, or Garrow lifted the bar for them, by a means of their own invention that none of the other endings covers.",
      closing: "Narrate their means working and Garrow's reaction to it, and end with the party on the far side of the bridge.",
      script: (world) => {
        world.setFlag("garrows_toll", "other");
        world.journal("Got past Garrow's toll house by our own means.");
      },
    },
    {
      id: "turned-back", kind: "leave", title: "Turned back",
      outcome: "The party gave up on the bridge and left the way they came, with the bar still down and the toll unpaid.",
      closing: "Garrow watches them go with the ledger under his arm and calls a last remark after them. Behind them, the sunset bell rings.",
      script: (world) => {
        world.setFlag("garrows_toll", "turned-back");
        world.journal("Turned back from Garrow's toll bridge without crossing.");
      },
    },
  ],
  limits: [
    "Crossing the river anywhere but this bridge (fording or swimming it, a boat, another bridge, a cross-country detour): this is the only crossing for miles. The river is in winter spate, loud, brown and freezing between steep banks, and the nearest ford is by the burnt mill, half a day north. Trying for it means leaving the road and this scene. (Slipping past the bar on the bridge itself is another matter.)",
    "Someone else to help, vouch or witness (Tam Hollis, the toll-men, guards, other travellers): nobody else is here. Garrow's two toll-men were sent to Caerwyn at noon to line the streets for the Assembly, Tam Hollis isn't with the party, and the road is empty this close to dusk. Fetching anyone would mean leaving this scene.",
    "Taking Garrow somewhere to see proof (the dead ox, the crossroads, the hedges down the road): he won't leave his bar. The Book forbids leaving it unattended and his men are gone. He'll look at whatever the party brings him, and at anything he can see from the bar.",
    "Rich pickings at the toll house (the strongbox, valuables): the strongbox is bolted to the floor and holds the week's tolls, a few shillings in pennies. Garrow owns a cudgel he has never used, a lantern, the ledger, a kettle and a goose.",
    "Someone with authority over Garrow (Marshal Holt, the King, a magistrate): they're all in Caerwyn, a few hours' walk on. A complaint can be made there, not here; at his own bar, nobody overrules the warden.",
    "Goblins turning up to settle the argument: they won't. Whatever was in the hedges this morning has moved on, and the rustles now are wind and birds. The proof here is whatever the party brings and whatever they can find at the toll house.",
  ],
  anchors: ["toll-house", "toll-bar", "bridge", "river", "hedge", "kings-road"],
};

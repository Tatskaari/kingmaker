import type { Scene } from "../src/runtime/scene.ts";

/**
 * Disco Elysium's hanged man's yard (Cuno, Cunoesse, Kim) moved behind the King's Granary in
 * Caerwyn (docs/research/scene-sources.md §5.6, §7.3). An investigation with a hostile witness and a
 * partner: two foul-mouthed granary kids who know more than they let on, and a dry watch sergeant
 * who steers without solving it. The Watch Captain has already called it suicide, and the dead-cart
 * comes at noon.
 *
 * The truth is spread across the cast (actors see the setting and limits, so those stay public),
 * and every conclusion has several carriers (the Three Clue Rule):
 * - Not suicide: the body up close (Kell's eye), a drop that could only have been from a loft door
 *   barred on the inside, the loft itself (through Cob's gap), the scraped heels of Prout's boots
 *   (on Cob's feet), Moll's paid story falling apart, Cob's account of the night.
 * - Why: the page sewn into the boot, the Granary Roll's 'lost to goblins' entries, what Prout asked
 *   Kell three days ago.
 * - Who: the page's countersign, Moll's paymaster, Cob's 'Silvertop', the Roll, Tull's order.
 * Endings: the case made (naming Sallow), murder by persons unknown, a child wrongly taken in (only
 * after Kell has pushed back), filed as a suicide, or walking away. Hooks for later scenes: the
 * wheat-ear stamp on the purveyance silver, and Prout's "Who pays the hedge-folk?".
 */

const NOT_SUICIDE = "Prout didn't hang himself: what has been found shows he was killed and then hoisted up to look like a suicide.";
const PAGE = "Sewn into the lining of Prout's left boot was a page razored from the Royal Granary Roll: a dozen grain wagons for the King's Road this past month marked 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor', with Prout's pencilled note beside each of what the same wagon weighed at the river warehouses two days later, and at the foot: 'Not goblins. Who pays the hedge-folk?'";
const COB_TAKEN = "Cob was taken in for Prout's murder.";
const MOLL_TAKEN = "Moll was taken in for Prout's murder.";

const has = (facts: string[], fact: string) => facts.includes(fact);

const pageItem = {
  id: "prout-ledger-page",
  name: "Page from the Royal Granary Roll",
  content: "A dozen grain wagons for the King's Road this past month, each marked 'lost to goblins' and countersigned 'J. Sallow, for the Royal Purveyor'. Beside each, in Prout's small pencil, what the same wagon weighed at the river warehouses two days later. At the foot, underlined: 'Not goblins. Who pays the hedge-folk?'",
};

export const hangedClerk: Scene = {
  id: "hanged-clerk",
  title: "The Hanged Clerk",
  summary: "A palace clerk hanged behind the granary, two foul-mouthed kids who know more than they say, and a dry watch sergeant with until noon.",
  setting: "Mid-morning on the eve of the Centennial Assembly, in the cobbled yard behind the King's Granary in Caerwyn's granary quarter. Over the wall the city is hanging bunting for tomorrow's procession; in here it smells of wet grain, pigeons and river mud, and the night's drizzle has only just stopped. High on the granary's back wall a hoist beam juts out above the shut loft door, and from its hook, on a noose, hangs Wendell Prout: a small grey-coated clerk with ink-stained fingers and no boots, his darned stockinged feet turning at about head height. The hoist rope runs up over the beam's pulley and in through a slot above the loft door, so it's tied off somewhere inside: getting him down means cutting the rope above his head, well out of reach from the cobbles, or lowering him from the loft. Nothing stands beneath him: no stool, no ladder, no crate; the yard was swept bare yesterday for the Assembly. His satchel lies open and empty by the gate, his spectacles bent in the gutter. The big yard doors into the granary are padlocked. A water butt stands in one corner. The yard wall is shoulder-high on the lane side, and a girl is sitting on top of it.",
  premise: "What really happened to Wendell Prout, and will the player get the truth on the record before the watch carts him off as a suicide at noon?",
  hook: "This morning a palace clerk, Wendell Prout, was found hanged behind the Caerwyn granary, and the Watch Captain has already called it suicide. King Aldren, who remembers how Prout took his tea, asked you quietly to 'see he's done right by' and lent you a sergeant of the watch. She's waiting for you in the granary yard. So, by the sound of it, are some children.",
  opening: "Open on the yard: Prout turning slowly on the sack hoist above the shut loft door, a pigeon on the beam; a scrawny boy in enormous boots lobbing gutter stones at the body with a running commentary; a sharp-faced girl on the wall top swearing at everyone in at least two languages. Sergeant Kell steps away from the gate with her notebook, introduces herself in a line and gives the Captain's view (suicide) without sharing it. Show only what a first glance would, and name nobody the player hasn't been introduced to. End on a stone clanging off the hoist hook.",
  cast: [
    {
      id: "kell",
      name: "Sergeant Agnes Kell",
      statblock: "guard", weapon: "club",
      look: "Forties, a rain cape beaded with drizzle, a battered oilcloth notebook and a pencil stub she sharpens with a clasp knife; a truncheon she has never been seen to draw. Stands very still and watches people's hands.",
      voice: "Dry, calm, precise and sparing: short sentences, the odd 'Noted.' Calls the player 'investigator'. Finds them funny and lets a joke land with a twitch of the mouth, then steers back with a question. Taps her pencil on the notebook when time is being wasted.",
      wants: "To do this properly: find out what really happened to Prout and write it down true, before the dead-cart comes at noon and he goes in the ground as a suicide.",
      fears: "Putting a wrong name in her notebook. The King's investigator turning out to be a bully or a fool. Being the sergeant who let a murder go down as a suicide.",
      knows: [
        "The dead man is Wendell Prout, under-clerk of the Royal Granary Roll: he kept the palace's grain accounts up in the granary's tally loft. Fussy, honest, unmarried; no debts, enemies or drink that anyone knows of. The King, apparently, remembers how he took his tea.",
        "The porters found him at first light. The palace had reported him missing the evening before.",
        "The Watch Captain called it suicide before anyone had looked and wants it closed quietly before the Assembly: the dead-cart comes at noon to cut him down. Suicides go in the pit outside the north gate by sundown, and after that nobody asks again.",
        "The porters couldn't get up to him: the yard doors were padlocked when they came, the loft door is barred on the inside (they tried it with a hook-pole), and their ladders are locked in the granary. The warden keeps the key and is at the palace counting Assembly provisions; her runner came back with 'After the Assembly.'",
        "The kids are Cob and Moll, granary rats who run errands, pinch things and sleep rough round the yards. Cob's father is a porter here with a thirst and heavy hands; Moll looks out for Cob. They won't tell the watch anything: she's tried before.",
        "Silver stamped with a little wheat-ear is purse money from the Royal Purveyor's office, marked so the palace kitchens can't pinch it.",
        "She has cut down hanged men before. Close up (once he's down, or someone gets her up to him), her eye will catch what a hanging doesn't make: a thin, level cord mark low round the neck under the noose's slanting burn, a swelling under the hair at the back of the skull, and palms with no rope burn on them. She'll point and ask the player what they make of it rather than say it for them.",
      ],
      secrets: [
        "Three days ago Prout came to the watch house and asked her how a clerk reports 'false entries in the King's rolls', and whether the watch could arrest 'a gentleman of the Purveyor's office'. She told him to take it to the palace and forgot him until this morning. It's why this one matters to her. She'll admit it if the player asks why she cares, or once the false entries turn up.",
      ],
      attitude: "Reserved and watchful: lent to the player, not given. Warms to anyone who looks properly and treats the kids decently; cools at bullying or wild guesses. She won't arrest anyone on a hunch: told to, she asks 'On what evidence?' first, and only if the player insists after that does she do it, under protest, noting her objection. She won't arrest anyone at all for a death the Captain's book calls suicide, and she steps in, once and firmly, if anyone hurts a child.",
    },
    {
      id: "cob",
      name: "Cob",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A scrawny boy of about eleven in a man's waistcoat and a pair of good black clerk's boots three sizes too big, laced round his ankles with string. Gutter stones in both fists, scabbed knuckles, a yellowing bruise on one cheek.",
      voice: "Loud and cocky, and talks about himself in the third person ('Cob don't talk to bluebottles'). Foul-mouthed in an inventive gutter way (sod off, bleedin', bum-faced palace pigeon) but never truly obscene. Brags, mocks and dares; goes very quiet and very young when he's frightened.",
      wants: "Respect, and to be left alone. To keep the boots: the first good thing he's ever owned. Something to eat. Never to go home to his da.",
      fears: "The men from the loft coming back for him. His father. Being sent to the Mending House. Being called a liar.",
      knows: [
        "The porters found the clerk at first light and ran off yelling for the watch. Cob was here before them, obviously.",
        "He's throwing stones 'because it makes him spin' and 'because he don't mind, he's dead, Cob checked'.",
        "Mister Prout was all right: he gave Cob the crusts off his dinner and once showed him how to write a C. Cob would sooner die than admit he's upset.",
      ],
      secrets: [
        "The boots are Prout's. He and Moll pulled them off the body at first light, before the porters came (he stood on her shoulders). He'll lie about them ('found 'em', 'they're Cob's da's') and fight to keep them, but he might let someone look at them if he gets to keep them, or trade them for something good.",
        "He sleeps in the tally loft: his 'castle', a nest of sacks and candle-ends behind the stacks, reached through a loose board behind the water butt (child-sized; a grown-up could squeeze through with effort). Two nights ago he watched Mister Prout, by candle, cut a page out of the big chained book on the tally desk and sew something into his boot 'like a sailor', and thought him a cheapskate.",
        "He was in the loft last night. That's all he'll own to at first ('Cob sleeps where Cob likes'), and he goes white saying it.",
        "A little after the midnight bells, a lantern and voices woke him: Mister Prout arguing with two men. One was Silvertop, the posh cove with the silver-topped cane who comes with the Purveyor's wagons and opens the big doors with his own key; the other was a big man with a bandaged hand, who said 'Yes, Master'.",
        "Then a thump, a choking noise, and the hoist creaking though there were no sacks on it. He hid in his sacks till dawn and has told no one but Moll. He's terrified they'll find out he was there.",
        "Since then the loft is wrong, and he knows it by heart: a smashed lantern and spilled ink by the tally desk, heel scuffs in the grain dust from the desk to the loft door, the loft door barred, the hoist rope tied off on its cleat with a docker's knot. The big book is still chained to the desk with its page cut out. Cob can't read it, but to anyone who can, the pages either side list grain wagons for the King's Road marked 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor'.",
        "He doesn't know it, but the stiff bit in the lining of the left boot, which crackles when he stamps, is a folded page; and the backs of both heels are scraped raw, as if their owner had been dragged.",
      ],
      attitude: "Hostile, rude and showing off for Moll. Bought attention isn't trust: food or coin gets boasts and bargaining; respect, kindness or a laugh at his jokes gets real talk; only believing the player will keep him safe from the men (or a real fright) gets what he saw. If grabbed, he bolts for his hole.",
    },
    {
      id: "moll",
      name: "Moll",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A sharp-faced girl of thirteen or so perched on top of the yard wall, heels drumming the bricks, shawl knotted at her chest, one fist kept tightly closed.",
      voice: "Fast, vicious and funny. Swears in Common, Saltmere dock cant and the scraps of Kläggenheim dwarvish she picked up from the carters. Answers questions with questions and orders Cob about ('Shut it, Cob').",
      wants: "To keep Cob: he's all she's got. To keep the silver crown in her fist. To get the two of them out of the granary quarter before the gentleman comes back.",
      fears: "Being left on her own. The gentleman who paid her. The watch taking Cob away.",
      knows: [
        "Everyone round the granary knows the clerk stayed late up in the tally loft, scratching in his big book.",
        "Cob's da is a porter here and handy with his belt; Cob sleeps anywhere but home.",
        "The story she was paid to tell, and tells to anyone who asks: she saw the clerk jump from the loft door at midnight, by moonlight, wailing about his debts. It's false: she slept in the cart shed across the lane, and it drizzled all night.",
      ],
      secrets: [
        "At first light a gentleman in a good coat, with a silver-topped cane and a wheat-ear signet ring, stopped at the yard gate, looked up at the body for a long moment, and gave her a silver crown to tell anyone who asked that she'd seen the clerk jump. The big man with him, who had a bandaged hand, called him 'Master Sallow'. The crown, stamped on one face with a little wheat-ear, is in her fist.",
        "When the gentleman had gone, she helped Cob get the boots off the body (he stood on her shoulders).",
        "She knows Cob was in the loft last night and heard it happen, and she's terrified for him. She'll break her story to protect Cob, never to save herself.",
      ],
      attitude: "Hostile and mocking from the wall top. Sticks to her paid story and steers Cob away from questions. She gives way when her lie is caught out, or when someone convincingly offers to keep Cob safe and out of the Mending House; she'd sooner run than be arrested.",
    },
    {
      id: "tull",
      name: "Corporal Abner Tull",
      statblock: "guard", weapon: "club",
      group: "Corporal Tull and two constables with the dead-cart",
      look: "Stout and red-faced in a damp watch cape, with a lunch-shaped bulge in one pocket. Two yawning constables push a handcart behind him with a long ladder lashed on top.",
      voice: "Cheerful, weary and procedural. Calls Kell 'Sarge' and everyone else 'sir' or 'madam', and quotes his orders word for word.",
      wants: "To get the body down, on the cart and filed as the Captain ordered, and to get back to the Assembly route before his dinner goes cold.",
      fears: "Getting it wrong in front of the Captain. Paperwork.",
      knows: [
        "The Captain's written order, which he'll show to anyone who doubts him: 'The death of W. Prout, clerk, to be closed as self-murder, without fuss, at the request of Master J. Sallow of the Royal Purveyor's office.'",
        "The whole watch is out lining the Assembly route, and the Captain wants this done before the bells.",
        "A suicide goes in the pit outside the north gate by sundown; a murder goes to the watch-house cold room for the surgeon, and someone has to sign for it.",
      ],
      secrets: ["He knew Prout to nod to, and thinks it a rum business when the Purveyor's office cares how a clerk gets filed, but he isn't paid to think."],
      attitude: "Friendly and in a hurry. He'll wait if Sergeant Kell gives him a reason he can repeat to the Captain, and he'll take Prout in as a murder if she signs for it.",
      enters: "dead-cart",
    },
  ],
  start: "yard",
  beats: [
    {
      id: "yard",
      title: "Stones at a hanged man",
      direction: "The arrival. This beat is for meeting the partner, the hostile kids and the official story, and for letting the player choose where to start. Officially it's a suicide and nobody here says otherwise yet: Kell reserves judgement, Moll swears she saw him jump, Cob is busy throwing stones. Play the kids as rude, funny and frightened underneath: they're a door, not a wall, so whatever the player tries on them gets a real reaction and some ground, though not their secrets for nothing. Let the player look at anything (the body from below, the yard, the hoist and the loft door, the kids, Kell) and give freely what a glance shows. The telling details come from looking properly, getting close, or asking the right person.",
      cast: {
        kell: "Introduce yourself in a line and answer questions about the public facts. Indulge a joke, then ask what they want to look at first. If asked to handle the kids, try; they won't talk to the watch. You won't arrest anyone for a death the Captain calls suicide.",
        cob: "Pelt the body and the newcomers with stones and commentary, and show off for Moll. Deflect anything about the boots or the night with bravado and lies.",
        moll: "Heckle from the wall top. Tell your 'I saw him jump' story with relish to anyone who asks. Shut Cob up when he says too much.",
      },
      pressure: "A stone from Cob clangs off the hoist hook and Prout turns slowly round to face the player. Kell glances at the sky: noon, and the dead-cart, aren't far off.",
      transitions: [
        {
          id: "not-suicide",
          when: "The player has found, been shown or worked out a specific sign that Prout didn't hang himself: for example the level cord mark or the blow to the head (up close), that he could only have dropped from a loft door that's barred on the inside, the scuffs or the docker's knot in the loft, the scraped heels of his boots, Moll's story falling apart, or Cob's account of the night.",
          to: "doubt", establishes: [NOT_SUICIDE],
        },
        { id: "page-found", when: "The folded page sewn into the lining of Prout's left boot has been found and read, or read out.", to: "motive", establishes: [PAGE] },
        {
          id: "examine-body", on: "attempt",
          when: "The player examines Prout's neck, head or hands up close (he's been got down, or they've climbed or been lifted up to him), where reading what they see takes some skill.",
          check: { reason: "to tell how Prout really died",
            skill: "medicine", dc: 12,
            success: "They see what the noose didn't make: a thin, level cord mark low round the neck beneath the rope's slanting burn, a swelling under the hair at the back of the skull, and clean palms with no rope burn. He was struck and strangled, then hung up.",
            failure: "They see rope burn, bruising and a dead clerk's face, and can't read more. Kell, at their shoulder, says 'Hm.' She has seen something; a second look, or asking her, will find it.",
            onSuccess: "doubt",
          },
        },
        {
          id: "win-cob", on: "attempt",
          when: "The player pushes past Cob's hostility to get him to trust them or tell what he knows, with an appeal, an argument, a bargain or a promise of safety, where it could go either way. (Not just asking him a question; a fair trade or a kindness he can't refuse needs no dice.)",
          check: { reason: "to get Cob to trust you with what he heard",
            skill: "persuasion", dc: 13,
            success: "Cob's swagger cracks. He checks Moll can't hear, then tells it in a frightened rush: he sleeps in the loft, and last night he woke to a lantern and voices, a thump and a choking noise, then the hoist creaking with no sacks on it. He hid till morning.",
            failure: "Cob jeers, calls them a bum-faced palace pigeon and darts behind the water butt and through a gap into the granary. He's hiding, not gone: Moll knows where, and he can still be coaxed out.",
            onSuccess: "doubt",
          },
        },
        {
          id: "catch-moll", on: "attempt",
          when: "The player presses on the holes in Moll's 'I saw him jump' story, or tries to read whether she's lying, where it could go either way. (Not just asking her to tell it.)",
          check: { reason: "to see through Moll's story about the jump",
            skill: "insight", dc: 13,
            success: "Moll's story wobbles and she knows it. Cornered, she admits through her teeth that a gentleman paid her a silver crown at first light to say she'd seen the clerk jump.",
            failure: "Moll tells it again, louder and with new details, and Cob loyally swears to every word. The holes are still there (the barred loft door, the drizzle, debts nobody knows of) for anyone who comes at it another way.",
            onSuccess: "doubt",
          },
        },
        {
          id: "scare-kids", on: "attempt",
          when: "The player tries to frighten the kids into talking: threats, looming, the watch, the Mending House or Cob's father.",
          check: { reason: "to scare the children into talking",
            skill: "intimidation", dc: 12,
            success: "Cob's bravado collapses. White-faced, he blurts that he was in the loft last night and heard men do it, and starts to cry; Moll screams blue murder at the player from the wall. Kell's mouth goes thin.",
            failure: "Cob bolts behind the water butt and through a gap into the granary, and Moll lets fly in three languages. Kell says nothing, loudly. The kids will be harder to reach now, but they haven't gone.",
            onSuccess: "doubt",
          },
        },
        { id: "concede", on: "attempt", when: "The player tells Kell they accept the Captain's verdict of suicide and to let the dead-cart have him (not just wondering aloud whether it was suicide).", to: "closed-suicide" },
        { id: "walk-away", on: "attempt", when: "The player gives up and leaves the granary yard, or heads off elsewhere, before anything has troubled the suicide story, leaving Prout and Kell behind.", to: "walked-away" },
        { id: "cart-comes", on: "cue", when: "The player has been in the yard a long while (at least eight exchanges at this point) without breaking the suicide story, and is going round in circles, idling or waiting for something to happen: noon comes, and so does the dead-cart.", to: "dead-cart" },
      ],
    },
    {
      id: "doubt",
      title: "Not by his own hand",
      direction: "The suicide story is broken and the player knows it: Prout was killed and then hung up for show. This beat is for who and why. Kell is in now: she writes things down, asks who and why out loud, and lets the player lead. The kids feel the change: Moll wants Cob away from here, and Cob, if he hasn't talked, is close to cracking. Every thread is live: what Cob saw last night, who paid Moll and with what, the boots, the loft and the big book in it, and Kell herself (why does this one matter to her?). Follow whatever the player picks up and reward real contact with real answers; secrets still need a reason to come out.",
      cast: {
        kell: "Write it down. Ask who and why out loud. Back the player's reasonable moves, and meet guesses by asking for evidence.",
        cob: "Jumpy. If you've been won over, stick close to the player; if not, edge towards the water butt.",
        moll: "Try to get Cob away. Watch the yard gate. Break your story only to protect Cob.",
      },
      pressure: "Cob stamps his too-big boots against the cold, and the left one crackles like paper. The palace bells ring the half hour before noon.",
      transitions: [
        { id: "page-found", when: "The folded page sewn into the lining of Prout's left boot has been found and read, or read out.", to: "motive", establishes: [PAGE] },
        {
          id: "win-cob", on: "attempt",
          when: "The player pushes Cob to tell who was in the loft last night, or about the boots, with an appeal, an argument, a bargain or a promise of safety, while he's still holding out and it could go either way. (Not just asking; a fair trade or a real promise to keep him safe needs no dice.)",
          check: { reason: "to get Cob to name the men in the loft",
            skill: "persuasion", dc: 12,
            success: "Cob gives up what he's been holding: Silvertop, the posh cove with the silver-topped cane who comes with the Purveyor's wagons and has his own key to the big doors, and a big man with a bandaged hand. If asked, he owns up that the boots came off Mister Prout, and that he saw the clerk sewing something into one two nights ago.",
            failure: "Cob clams up and backs towards the water butt: Cob don't know nothing. He'll talk to someone who gives him a real reason to feel safe.",
            onSuccess: "doubt",
          },
        },
        {
          id: "catch-moll", on: "attempt",
          when: "The player presses on the holes in Moll's story, or tries to read what she's hiding, where it could go either way. (Not just asking her to tell it.)",
          check: { reason: "to learn who paid Moll to lie",
            skill: "insight", dc: 13,
            success: "Moll cracks: a gentleman with a silver-topped cane and a wheat-ear signet ring paid her a silver crown at first light to say she saw the clerk jump, and his big friend with the bandaged hand called him 'Master Sallow'. Pressed, she opens her fist on the coin.",
            failure: "Moll sticks to her story and turns up the abuse, but her eyes keep going to the yard gate, and the holes in her story are still there.",
            onSuccess: "doubt",
          },
        },
        {
          id: "scare-kids", on: "attempt",
          when: "The player tries to frighten the kids into talking: threats, looming, the watch, the Mending House or Cob's father.",
          check: { reason: "to force the children to reveal what they know",
            skill: "intimidation", dc: 12,
            success: "They crack under it. Cob sobs out what he saw (Silvertop and the big man with the bandaged hand); Moll flings down her silver crown and calls the player every name she knows. Kell writes it down without looking at the player.",
            failure: "Cob bolts behind the water butt and into the granary, Moll goes back up the wall out of reach, swearing, and Kell sighs. They'll only come round for someone who stops looming.",
            onSuccess: "doubt",
          },
        },
        { id: "accuse-kid", on: "attempt", when: "The player accuses Cob or Moll of killing Prout (says plainly that they did it, not just asks) or tells Kell to arrest one of them for it.", to: "accused" },
        { id: "wrap-up", on: "attempt", when: "The player is done here without naming anyone for it: wrapping up, leaving the yard, or asking Kell to write Prout up as murdered by persons unknown or to take what they've found to the King as it stands.", to: "open-case" },
        { id: "cart-comes", on: "cue", when: "The scene has been at this point a good while (at least six exchanges) and the player isn't closing in on who or why, or is idling or waiting: noon comes, and so does the dead-cart.", to: "dead-cart" },
      ],
    },
    {
      id: "motive",
      title: "What Prout found",
      direction: "Prout's page is out: grain written off as 'lost to goblins' that turned up at the river warehouses, every wagon countersigned 'J. Sallow, for the Royal Purveyor'. This is why he died, and it names a man. Give the player a moment with it. Kell reads it over their shoulder and goes very still: this is what Prout came to her about, and that can come out now. Let the player put the case together in their own words; Kell tests it with questions and doesn't make it for them. If the kids hear the name, or a silver-topped cane described, they know exactly who it is.",
      cast: {
        kell: "Read the page and go still. Then admit, quietly, that Prout came to you three days ago and you sent him away. Ask what the player wants written down.",
        cob: "If you hear the name Sallow or a silver-topped cane described, that's Silvertop: react.",
        moll: "Go white at the name Sallow, and look at your fist.",
      },
      pressure: "The palace bells ring a quarter to noon. Kell turns the page over, as if there might be more on the back.",
      transitions: [
        { id: "leave-with-page", on: "attempt", when: "The player is done here and leaves the yard (or sends Kell off) with the page in hand, without laying the case out in words: Kell has read it and will write it up herself.", to: "case-made" },
        { id: "cart-comes", on: "cue", when: "The player has had the page a while (at least three exchanges at this point) without making the case to Kell, or is dawdling: noon comes, and so does the dead-cart.", to: "dead-cart" },
      ],
    },
    {
      id: "dead-cart",
      title: "The dead-cart",
      direction: "Noon, and the world has stopped waiting. Corporal Tull has come with two constables, a handcart, a long ladder and the Captain's written order to cut Prout down and file him as a suicide. This is the last chance to make the case. Tull isn't a villain: he's bored, polite and in a hurry, and he'll wait for the sergeant's word if someone gives him a reason he can repeat to the Captain. His order says who asked for it, for anyone who reads it. Prout coming down the ladder is a chance, for anyone quick, to look at him up close.",
      cast: {
        tull: "Wave the order and quote it. Be reasonable, bored and in a hurry. Wait if the sergeant asks; take Prout in however she signs for him.",
        kell: "Hold Tull off with procedure if the player has given you something to hold him with. Without it, you can't.",
        cob: "Go quiet at the sight of more watchmen. Stick close to whoever's been decent to you, or slide towards the water butt.",
        moll: "Get off the wall and as far from the watch as the yard allows.",
      },
      pressure: "One constable sets the ladder against the hoist beam and starts up it with a knife in his teeth. Tull looks at Kell: 'Sarge?'",
      transitions: [
        { id: "held-as-murder", when: "Kell, given real evidence, has agreed to sign Prout in as a murder rather than a suicide, and Tull has accepted it, with nobody named for it.", to: "open-case" },
        {
          id: "persuade-tull", on: "attempt",
          when: "The player tries to talk Tull into waiting, or into taking Prout in as anything but a suicide, before Kell has a case she'll sign for.",
          check: { reason: "to convince Tull to wait before taking Prout away",
            skill: "persuasion", dc: 12,
            success: "Tull sighs, folds the order away and sits on the edge of the cart: he'll wait for the sergeant's word, and take Prout in however she signs for him.",
            failure: "Tull is very sorry, but the Captain was very clear, and he nods his constables up the ladder. One more good reason might still stop him.",
            onSuccess: "dead-cart", onFailure: "closed-suicide",
          },
        },
        { id: "accuse-kid", on: "attempt", when: "The player accuses Cob or Moll of killing Prout (says plainly that they did it, not just asks) or tells Kell or Tull to arrest one of them for it.", to: "accused" },
        { id: "carted-off", on: "cue", when: "Tull's patience has run out, or the player has told him to go ahead: he has waited at least two exchanges since he arrived (or since he last agreed to wait) without being given a reason he can take back to the Captain, and the constables load Prout onto the cart as a suicide.", to: "closed-suicide" },
      ],
    },
    {
      id: "accused",
      title: "On what evidence?",
      direction: "The player has accused a child of the murder. Kell doesn't move: she asks what evidence they have, and waits. The accused child reacts as they would, and the other defends them. This beat is for the player to show what they've got, think again, or insist. Don't decide it for them, and don't hand them the real answer to soften the moment.",
      cast: {
        kell: "Don't arrest anyone yet. Ask what evidence they have and weigh it honestly: boots make Cob a thief, not a murderer. If they insist after that, do it, under protest, and say you'll be writing your objection down.",
        cob: "Outrage first, then fear: back towards the water butt.",
        moll: "Defend Cob ferociously. If it's you they're accusing, threaten to run.",
      },
      pressure: "Cob edges towards the water butt; Moll swings a leg over the far side of the wall.",
      transitions: [
        { id: "insist-cob", on: "attempt", when: "Having heard Kell's objection, the player insists that Cob be taken in for the murder anyway, or seizes him for it themselves.", to: "wrong-man", establishes: [COB_TAKEN] },
        { id: "insist-moll", on: "attempt", when: "Having heard Kell's objection, the player insists that Moll be taken in for the murder anyway, or seizes her for it themselves.", to: "wrong-man", establishes: [MOLL_TAKEN] },
        { id: "drop-it", when: "The player has let the accusation drop for now (taken it back, or turned to the evidence, the body or someone else), and Corporal Tull's dead-cart hasn't come yet.", to: "doubt" },
        { id: "drop-it-cart", when: "The player has let the accusation drop for now, and Corporal Tull and his dead-cart are already in the yard.", to: "dead-cart" },
      ],
    },
  ],
  anytime: [
    {
      id: "make-case",
      when: "The case is on the record: the player has made it to Kell (out loud, or by handing her the page that names him) that Prout was killed and hung up to look like a suicide by or for the man calling himself Master Sallow of the Royal Purveyor's office (the kids' 'Silvertop', or just 'the Purveyor's man'), backed by something actually found here, and Kell has accepted it and is writing it down as murder.",
      to: "case-made",
    },
  ],
  exits: [
    {
      id: "case-made", kind: "progress", title: "The case is made",
      outcome: "Kell writes Prout's death down as murder, made to look like a suicide, with the man calling himself Master Sallow of the Royal Purveyor's office behind it. The player has a case, and whatever proof they found here, to take to the King.",
      closing: "Kell underlines something twice, closes her notebook and says something dry that is very nearly thanks. Prout goes to the watch house as a murder; she wants the player to carry the case to the King, since the Captain takes his orders from the Purveyor's office. Let the kids react to how the player treated them.",
      next: "caerwyn-afternoon",
      script: (world, outcome) => {
        world.quest("hanged-clerk").complete("Proved Wendell Prout was murdered, and named Sallow of the Royal Purveyor's office as behind it.");
        world.quest("purveyors-man").start("The Purveyor's Man", "A man calling himself Master Sallow, of the Royal Purveyor's office, had the palace clerk Wendell Prout killed and hung up as a suicide. The case needs taking to the King, not the Watch Captain.");
        world.character("kell").setAttitude("friendly", "The King's investigator made Prout's case properly.");
        world.character("kell").remember("The King's investigator proved Prout was murdered and named Sallow of the Purveyor's office.");
        if (has(outcome.established, PAGE)) world.player.addItem({ ...world.newReadable(pageItem), asset: "parchment-note" });
        world.setFlag("prout_death", "murder, Sallow named");
        world.journal("Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office.");
      },
    },
    {
      id: "open-case", kind: "progress", title: "Murder by persons unknown",
      outcome: "Kell writes Prout's death down as murder by persons unknown, so he goes to the watch-house cold room and not the suicides' pit. Nobody has been named, but the case stays open.",
      closing: "Kell writes one line and underlines it; Prout will go on the cart under a sheet, as a murder. She tells the player, drily, that an open case beats a wrong one.",
      next: "caerwyn-afternoon",
      script: (world, outcome) => {
        world.quest("hanged-clerk").advance("murder_unnamed", "Prout's death is on the books as murder by persons unknown.");
        world.character("kell").remember("Prout was murdered; nobody has been named for it yet, and the case is open.");
        if (has(outcome.established, PAGE)) world.player.addItem({ ...world.newReadable(pageItem), asset: "parchment-note" });
        world.setFlag("prout_death", "murder, unnamed");
        world.journal("Prout was murdered. The watch has it down as persons unknown.");
      },
    },
    {
      id: "wrong-man", kind: "other", title: "The wrong name in the book",
      outcome: "At the player's insistence, and over Kell's objection, a child has been taken in for Prout's murder. The Captain will gladly file a murder that embarrasses nobody at court, and whoever really killed Prout is in the clear.",
      closing: "Narrate the arrest without relish: the accused child's fury or terror, the other one bolting (over the wall or through the gap behind the water butt), and Kell writing her objection down in full. Prout is still turning on the hoist.",
      next: "caerwyn-afternoon",
      script: (world, outcome) => {
        const accused = has(outcome.established, MOLL_TAKEN) ? "moll" : "cob";
        const other = accused === "cob" ? "moll" : "cob";
        world.character(accused).moveTo("the watch-house cells");
        world.character(accused).setAttitude("hostile", "Taken in for a murder they didn't do, on the player's word.");
        world.character(other).setAttitude("hostile", "The player had their friend taken in for murder.");
        world.character(other).leaveScene("gone to ground somewhere in the granary quarter");
        world.character("kell").setAttitude("unfriendly", "Made to arrest a child for murder on no evidence.");
        world.character("kell").remember("She arrested a child for Prout's murder at the investigator's insistence, and wrote down her objection.");
        world.quest("hanged-clerk").fail("A child was taken in for Prout's murder; whoever really killed him is in the clear.");
        world.setFlag("prout_death", "murder, blamed on a granary child");
        world.journal("We had one of the granary kids taken in for the clerk's murder. The sergeant thinks we're wrong.");
      },
    },
    {
      id: "closed-suicide", kind: "other", title: "Filed as a suicide",
      outcome: "Prout goes into the Captain's book as a suicide and onto the dead-cart for the pit outside the north gate. Nobody will look for whoever killed him.",
      closing: "Kell writes one word in her notebook and shuts it. Prout goes out of the yard on the dead-cart under a sheet, past the Assembly bunting (at noon, if it isn't here yet). Let the kids react.",
      next: "caerwyn-afternoon",
      script: (world) => {
        world.quest("hanged-clerk").fail("Prout was filed as a suicide.");
        world.character("kell").setAttitude("wary", "The King's investigator let Prout go down as a suicide.");
        world.setFlag("prout_death", "suicide");
        world.journal("The clerk behind the granary was filed as a suicide.");
      },
    },
    {
      id: "walked-away", kind: "leave", title: "Walked away",
      outcome: "The player left the granary yard before anything troubled the suicide story. At noon the dead-cart takes Prout away as a suicide.",
      closing: "Kell watches them go without a word, then turns back to the body and opens her notebook on her own.",
      next: "caerwyn-afternoon",
      script: (world) => {
        world.quest("hanged-clerk").fail("Walked away before the case was made; Prout was filed as a suicide.");
        world.character("kell").setAttitude("wary", "The King's investigator walked away from Prout's case.");
        world.character("kell").remember("The King's investigator walked off and left Prout to the dead-cart.");
        world.setFlag("prout_death", "suicide");
      },
    },
  ],
  essentials: [
    { id: "not-suicide", what: "Prout didn't hang himself: he was struck and strangled, then hoisted up for show.", placedWith: ["the body (cord mark, the blow to the head)", "Cob's account of the loft", "the scraped heels of Prout's boots"], carriers: ["cob"], unlocks: "Kell treating it as murder" },
    { id: "page", what: "Prout found grain written off as 'lost to goblins' that turned up at the river warehouses, every wagon countersigned 'J. Sallow, for the Royal Purveyor'.", placedWith: ["the page sewn into Prout's left boot (Cob is wearing the boots)", "the tally book in the loft"], carriers: [], unlocks: "the motive, and the name Sallow" },
    { id: "silvertop", what: "A gentleman with a silver-topped cane and a wheat-ear signet ring (Sallow) was in the loft that night.", placedWith: ["Cob ('Silvertop')", "Moll, if she cracks"], carriers: ["cob", "moll"], unlocks: "naming Sallow as the man behind it" },
  ],
  limits: [
    "Getting someone to talk to the dead (a séance, a priest who can call up Prout's ghost): nobody in reach can do it. The Nine Furrows wizards deal in weather, wards and grain, none of them is here, and the temples don't raise the dead for the watch. Prout can only tell what his body shows. (The player's own spells are theirs, and work as the rules say.)",
    "Fetching more help (other watchmen, the watch surgeon, a coroner, a wizard, a tracking dog, the granary warden): nobody can be had before noon. The whole watch is lining the Assembly route, the surgeon is on duty at the palace, and Kell's runner to the warden came back with 'After the Assembly.' The help here is Kell, the kids and whatever the player brought.",
    "A ladder, the granary key or a grown-up's way into the granary: the porters' ladders are locked inside, the yard doors are padlocked, the warden who keeps the key is at the palace, and the yard was swept bare for the Assembly. There's the water butt, a few loose cobbles, the player's own kit, and whatever the kids know.",
    "A royal warrant, or anything in writing from the King: Aldren asked over tea and signed nothing (he avoids signing anything that might upset anyone). The player has the King's word, which Kell respects and a corporal might not.",
    "Reaching anyone at the palace (the Captain, the warden, the King, any official): they're all at the palace preparing for the Assembly and can't be reached from this yard. Taking the case to them is another scene, and leaving before noon leaves Prout to the dead-cart.",
    "Coming back later (tonight, tomorrow): at noon the dead-cart takes Prout away and the yard is locked up for the Assembly. Whatever there is to find is here, this morning.",
    "Prout's own notes and papers: his satchel was found open and empty, and there's nothing written lying about the yard. Whoever emptied it took everything in it.",
    "Following anyone's trail out of the yard (footprints, a scent, tracks): porters, kids and a night of drizzle have trampled it all. No trail leads anywhere from here.",
    "Answers that would need someone who isn't here (what goes on at court, anyone's business at the palace, anything about the goblin raids on the King's Road): nobody in this yard knows, and nothing here says.",
  ],
  anchors: ["granary-yard", "hoist-beam", "loft-door", "tally-loft", "water-butt", "yard-wall", "yard-gate", "yard-doors"],
  lore: ["Places/Granary Yard.md"],
};

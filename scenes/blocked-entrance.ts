import type { Scene } from "../src/runtime/scene.ts";

/**
 * V1's own cart sequence (lore/Scenarios/Centennial Assembly/Quests/Assembly Programme) rebuilt as
 * a V2 scene. In V1 this is where NPCs fixated on "finding another route" that no exit backed and
 * stonewalled the player. Here the routes out are explicit, including one for remedies invented
 * in play, and the limits say plainly that there is no other way in.
 */
export const blockedEntrance: Scene = {
  id: "blocked-entrance",
  title: "The Blocked Entrance",
  summary: "Holt, Rowan and a wedged magic cart: three people, three agendas, one doorway.",
  setting: "The palace service entrance at Caerwyn, mid-afternoon on the eve of the Centennial Assembly. A broad stone archway, its iron-bound doors thrown open. Wedged across it at an angle is a tall green-lacquered cart of Nine Furrows make, its wheels splayed and dug in like a stubborn mule's, carrying a potted silver-birch sapling hung with tiny brass bells: the Nine Furrows gift tree. The cart hums faintly. Beyond the arch, in the drizzle outside, a queue of delivery wagons stretches back down the lane. Inside, porters stand about holding things they can't put anywhere.",
  premise: "Can the player get the entrance cleared, and whose idea, pride and timetable survive it?",
  hook: "King Aldren has asked you, with enormous seriousness, to find out why the cushions for the Assembly seats haven't arrived. The trail leads to the service entrance, where someone is shouting.",
  opening: "Describe the jammed archway, the humming cart with its belled sapling, the stranded porters, and Marshal Holt in the middle of it all barking orders at people who can't follow them. Rowan is half under the cart. End with Holt rounding on the player: who are they and what do they want?",
  cast: [
    {
      id: "holt",
      name: "Marshal Garran Holt",
      look: "Grey-whiskered, ramrod straight, a pocket watch he consults like scripture, a sheaf of schedules under one arm.",
      voice: "Clipped, military, speaks in times and quantities ('Four minutes. Six porters. One cart.'). Shows care through food and practical help, never through words.",
      wants: "The entrance cleared now. The hall was meant to be finished by 3:47 this afternoon, and every minute is a personal insult.",
      fears: "A diplomatic row with Nine Furrows on the eve of the Assembly. Being blamed for the King's cushions.",
      knows: [
        "Rowan's cart wedged itself across the service entrance this morning and won't budge. The cushions, the wine and half the hall's linen are in the wagon queue behind it.",
        "He has already cleared space twice for Rowan to work, and twice Rowan said he was 'nearly finished'.",
        "He could have the cart smashed apart, but it belongs to Nine Furrows and the tree is their gift to the Assembly. He won't give that order lightly.",
        "The King keeps sending people to ask about cushions instead of coming himself.",
      ],
      secrets: ["He has already written the order to have the cart broken up and has it in his coat. He's been hoping not to need it."],
      attitude: "Furious at the situation, impatient with interruptions, but respects anyone who is useful.",
    },
    {
      id: "rowan",
      name: "Doctor Rowan Ash",
      look: "Lanky, soot-smudged scholar's robes with the sleeves pinned up, spectacles on his forehead, a dozen tiny tools in his breast pocket.",
      voice: "Cheerful, rapid, academic. Calls disasters 'unexpected peer review'. Always 'one more minute' from success.",
      wants: "To save his self-guiding cart and deliver the gift tree with Nine Furrows' dignity intact, ideally by fixing the cart himself.",
      fears: "Backing out in public like a failure. Having to ask Magister Corvin for help.",
      knows: [
        "The cart is a self-guiding Nine Furrows carriage with a protective charm: when it senses danger to its cargo, it braces its wheels. The archway is a hair too narrow for the tree's branches, so the cart has decided the doorway is a threat.",
        "The cart could be backed out the way it came, if he gave up. He'd rather not.",
        "Magister Corvin, the King's legal thaumaturge, owns a book on thaumaturgic carriage maintenance that would explain how to release the charm.",
      ],
      secrets: [
        "He doesn't actually know how to release the bracing charm. He's been guessing all morning.",
        "If the tree were taken off the cart, the charm would have nothing to protect and the wheels would relax. He hasn't thought of this, and wouldn't like it (the tree is heavy and fragile).",
        "He's embarrassed to ask Corvin: Corvin left Nine Furrows after the faculty refused him a chair, and Rowan voted with the faculty.",
      ],
      attitude: "Friendly and chatty, defensive about the cart, happy to accept help that lets him fix it himself.",
    },
    {
      id: "mags",
      name: "Mags Pellow",
      look: "Broad, rain-soaked head porter in an oilskin, standing outside the arch on the far side of the cart, holding a bolster like a weapon.",
      voice: "Loud, dry, unimpressed. Shouts through the gap between the cart and the arch. Calls everyone 'love'.",
      wants: "Her wagons unloaded before the drizzle ruins the King's cushions.",
      fears: "The cushions getting wet. Being blamed for it.",
      knows: [
        "The cushions are in the second wagon in the queue, under a tarpaulin that leaks.",
        "There is no other door big enough for the wagons: the kitchen door is too small and the main gate is closed to deliveries for the Assembly.",
        "She could carry a few small things through the gap under the cart, but not wagonloads.",
      ],
      attitude: "Sympathetic to anyone who might actually get the cart moving.",
    },
  ],
  start: "holt-raging",
  beats: [
    {
      id: "holt-raging",
      title: "Holt in full flow",
      direction: "Holt is furious and busy. A cushion enquiry, of all things, is the last straw. He snaps, but he's not a wall: practical sympathy, a sensible offer, or simply standing their ground and being useful will get him to explain. Make his timetable precision funny.",
      cast: { holt: "Bark orders. Snap at the cushion question. Calm down for someone who is actually useful." },
      pressure: "A porter drops a crate of glasses with a crash; Holt checks his watch, closes his eyes and counts to three.",
      transitions: [
        { id: "holt-explains", when: "Holt has calmed down or been won over enough to explain what's blocking the entrance.", to: "holt-briefs" },
        {
          id: "calm-holt", on: "attempt",
          when: "The player tries to talk Holt down or win his cooperation while he's still raging, in a way that could backfire (arguing, invoking the King's authority, flattering him).",
          check: { reason: "to get Holt to stop raging and hear you out", skill: "persuasion", dc: 12, success: "Holt stops, looks at the player properly, and decides they might be useful.", failure: "Holt snaps 'Not now!' and turns his back for a moment; he's still talkable, but the player has lost a little ground.", onSuccess: "holt-briefs" },
        },
      ],
    },
    {
      id: "holt-briefs",
      title: "The obstruction",
      direction: "Holt explains in clipped detail: Rowan's cart, the gift tree, the wagons queued outside (the cushions among them), his two cleared spaces and Rowan's two 'nearly finished's. He's considering having it smashed but doesn't want a row with Nine Furrows. Rowan pops out from under the cart to defend himself; Mags shouts through the gap from outside. Now there are three people with three agendas.",
      cast: {
        holt: "Lay out the problem with times and numbers. Make it clear you need the entrance cleared, not another promise.",
        rowan: "Emerge from under the cart, cheerful and defensive. 'Nearly there!' Explain the cart's protective charm in excited jargon if asked.",
        mags: "Shout through the gap about the rain and the cushions. Interject with practical facts.",
      },
      pressure: "The cart's hum rises in pitch and its wheels grind another inch into the flagstones. Mags yells that the tarpaulin over the cushions has started to sag.",
      transitions: [
        { id: "at-the-cart", when: "The player is now dealing with Rowan and the cart itself: asking how it works, what's wrong, or what it would take to move it.", to: "the-cart" },
        { id: "holt-blessing-early", when: "Holt has explicitly given the player permission to break up the cart.", to: "blessing" },
      ],
    },
    {
      id: "the-cart",
      title: "The stubborn cart",
      direction: "The heart of the scene. Rowan explains (or the player works out) the bracing charm: the cart thinks the doorway threatens the tree. The routes out are all live: persuade Rowan to back it out; get Corvin's book (which means going to find Corvin); get Holt's blessing to smash it; or something the player invents that actually addresses the charm or the tree. Let the people argue among themselves a little: Holt wants speed, Rowan wants dignity, Mags wants a roof. Reward real ideas with real traction.",
      cast: {
        rowan: "Resist backing out, but listen to a real argument. Get excited by clever ideas, nervous about anything that risks the tree. Mention Corvin's book only reluctantly.",
        holt: "Push for a decision with your watch. Reluctantly entertain smashing it if pressed with a good case.",
        mags: "Offer practical muscle and bluntness. Point out that the tree is the problem if anyone asks what the cart is protecting.",
      },
      pressure: "Holt pulls a folded order from his coat and taps it against his palm: 'Signed. I'd rather not.' The drizzle outside turns to proper rain.",
      transitions: [
        {
          id: "persuade-back-out", on: "attempt",
          when: "The player tries to convince Rowan to give up and back the cart out the way it came.",
          check: { reason: "to convince Rowan to back the cart out", skill: "persuasion", dc: 14, success: "Rowan sighs, pats the cart and agrees to back it out, with slightly wounded dignity.", failure: "Rowan digs in: 'One more minute!' He's still persuadable with a better argument or a face-saving offer.", onSuccess: "backed-out" },
        },
        {
          id: "press-holt", on: "attempt",
          when: "The player presses Holt to authorise smashing the cart.",
          check: { reason: "to get Holt's permission to smash the cart", skill: "persuasion", dc: 13, success: "Holt produces his signed order and hands it over: 'On your head, then.'", failure: "Holt refuses for now: 'Not yet. Nine Furrows will have my hide.'", onSuccess: "blessing" },
        },
        { id: "seek-corvin", on: "attempt", when: "The player sets off to find Magister Corvin or his book.", to: "fetch-book" },
        {
          id: "release-charm", on: "attempt",
          when: "The player tries to calm, dispel or outwit the cart's protective charm directly with magic or know-how.",
          check: { reason: "to settle the cart's protective charm", skill: "arcana", dc: 15, success: "The charm settles; the wheels sigh and relax. The cart can be rolled clear.", failure: "The cart's hum turns shrill and it braces harder; Rowan winces.", onSuccess: "cleared-other" },
        },
        { id: "other-remedy", when: "The cart has actually been freed and cleared from the archway by some other means established in play (for example, lifting the tree off so the charm has nothing to protect, or a trick that convinces the cart the doorway is safe).", to: "cleared-other" },
      ],
    },
    {
      id: "blessing",
      title: "Holt's blessing",
      direction: "Holt has authorised smashing the cart, with the air of a man signing his own reprimand. Rowan is horrified and may make a last-ditch counter-offer. The player still has to do it (or not).",
      cast: { rowan: "Protest. Plead for the tree. Offer to back out after all, if it saves the cart.", holt: "Stand by your permission, gruffly. Check your watch.", mags: "Cheer, and offer a crowbar." },
      transitions: [
        {
          id: "smash-it", on: "attempt",
          when: "The player sets about breaking the cart apart to clear the arch.",
          check: { reason: "to break the cart apart and clear the arch", skill: "athletics", dc: 13, success: "Lacquered panels split, the charm dies with a sad chime, and the wreck can be dragged aside. The tree survives, mostly.", failure: "The cart fights back, bracing harder; the player is jolted but can keep going.", onSuccess: "smashed" },
        },
        { id: "rowan-relents", when: "Rowan has agreed to back the cart out after all, to save it.", to: "backed-out" },
        { id: "other-remedy-late", when: "The cart has actually been freed and cleared from the archway by some other means established in play.", to: "cleared-other" },
      ],
    },
  ],
  anytime: [
    { id: "walk-away", on: "attempt", when: "The player gives up and leaves the service entrance with the cart still stuck.", to: "walked-away" },
  ],
  exits: [
    {
      id: "backed-out", kind: "persuaded", title: "Backed out",
      outcome: "Rowan backs the cart out of the archway. The entrance is clear and the wagons, cushions included, can come in. Rowan is a little sore about it.",
      closing: "Narrate the cart reversing with offended dignity, the wagons rolling in, Holt's watch snapping shut.",
      script: (world) => {
        world.quest("assembly-programme").advance("cart_unblocked", "Rowan backed the cart out at the player's urging.");
        world.character("rowan").setAttitude("wary", "Talked into giving up his repair in public.");
        world.character("holt").setAttitude("friendly", "The player got the entrance cleared without a diplomatic row.");
      },
    },
    {
      id: "smashed", kind: "progress", title: "Smashed",
      outcome: "The cart is broken up and dragged aside; the entrance is clear. Holt authorised it. Nine Furrows will hear about this.",
      closing: "Narrate the wreckage being hauled aside, the wagons rolling in, Rowan cradling a bell from the tree.",
      script: (world) => {
        world.quest("assembly-programme").advance("cart_unblocked", "The cart was smashed with Holt's authorisation.");
        world.place({ asset: world.assets.get("cart-broken"), at: world.anchor("service-yard") });
        world.character("rowan").setAttitude("unfriendly", "His cart was destroyed.");
        world.setFlag("nine_furrows_offended", true);
      },
    },
    {
      id: "cleared-other", kind: "progress", title: "Freed",
      outcome: "The cart has been freed by the player's own remedy and rolled clear; the entrance is open and the cart survives.",
      closing: "Narrate the moment the wheels relax, the cart rolling clear, and the reactions: Rowan delighted, Holt grudgingly impressed, Mags already shouting the wagons in.",
      script: (world) => {
        world.quest("assembly-programme").advance("cart_unblocked", "The player freed the cart with their own remedy.");
        world.character("rowan").setAttitude("friendly", "The player saved his cart.");
        world.character("holt").setAttitude("friendly", "The player cleared the entrance.");
      },
    },
    {
      id: "fetch-book", kind: "progress", title: "To find Corvin",
      outcome: "The player sets off to find Magister Corvin and his book on carriage maintenance. The cart stays stuck for now.",
      closing: "Holt checks his watch and tells them exactly how many minutes they have; Rowan calls after them not to mention his name.",
      script: (world) => {
        world.quest("assembly-programme").advance("seek_corvin", "Gone to find Corvin's carriage maintenance book.");
      },
    },
    {
      id: "walked-away", kind: "leave", title: "Walked away",
      outcome: "The player left the entrance blocked.",
      closing: "Behind them, Holt's voice rises to a new pitch.",
      script: (world) => { world.setFlag("entrance_still_blocked", true); },
    },
  ],
  limits: [
    "Another way in for the wagons: there isn't one. The kitchen door is too small and the main gate is closed to deliveries for the Assembly.",
    "Magister Corvin or his book: neither is here. Getting them means leaving this scene to go and find Corvin.",
    "Fetching extra people to help (the dwarves or any other delegation, the guards, more servants): nobody can be brought in time. The delegations are at the opening reception and protocol forbids pulling them out for porters' work; the guards can't leave the gates. The help here is Holt, Rowan, Mags and the six porters.",
    "The King coming down to sort it out: he won't. He sent the player precisely so he wouldn't have to.",
    "Carrying the wagonloads through by hand: only small things fit through the gap under the cart. The cushions alone are two wagonloads.",
  ],
  anchors: ["service-arch", "service-yard", "wagon-queue", "under-cart"],
};

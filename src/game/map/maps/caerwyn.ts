import { buildMap, T, type MapDef } from "../tiles.ts";

/**
 * Caerwyn on the eve of the Centennial Assembly, 5 ft to a tile, north at the top. The palace on
 * the rise (north-west); the granary quarter (north-east) with the lane, the yard behind the King's
 * Granary and the tally loft inside its back wall; Granary Street down to the market square and the
 * Corn Exchange; Bank Street along the top of the bank, the river stairs down past the Drowned Rat's
 * door to the wharves; the warehouses, and at the downriver (east) end, the Heron, half on piles.
 *
 * The yard lines up with scenes/worlds/hanged-clerk.ts: the world's (0, 0) feet is tile (40, 9), so
 * the lane is row 9, the shoulder-high wall and its gate row 10, the yard rows 11-16, the granary's
 * back wall column 47 (loft door at row 12, yard doors at row 15) and the loft columns 48-50.
 */

const GRID = `
,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,PPPPPPPPPPPPPPPPPPP,,,,,,,,,HHHHHHHHHH,,,,,,,,HHHHHHHHHHH:::::
t,PPPPPPPPPPPPPPPPPPP,,BBBBBB,HHHHHHHHHH,,,,,,,,HHHHHHHHHHH:4:::
,,pPPPPPPPPPPPPPPPPPP,,BBBBBB,HHHHHHHHHH,BBBBBB,HHHHHHHHHHH:t:::
,,PPPPPPPPPPPPPPPPPPPt,bBBBBB,HHHHHHHHHH,BSSSSB,HHHHHHHHHHH::4::
,,PPPPPPPPPPPPPPPPPPP,,BBBBBB,HHhHdHHhHH,BS3SSB,HHhHdHHhHdH:::::
,,pPPPPPPPPPPPPPPPPPP,,BBDBbB,:::::::::::BSSSSB:::::::::::::::::
,,PPPPPPPPPPPPPPPPPPP,..........................................
,,PPPPPPPPPPPPPPPPPPP,..*..*..*..*..*..2........................
,,pPPPPPPPPPPPPPPPPPPt......l.................T.................
,,PPPPPPPPPPPPPPPPPPP,,,,,,,....BBDBBBBBooOooooGGGGGGYGGGGG:::::
,,PPPPPPPPPPPPPPPPPPP,HHhHHH....BBBBBBBB.......GgggGGGGGGGG:::::
,,PPpPPpPPpQPpPPpPPpP,HHHHHH....BBBBBBBB.......LgggGGGGGGGG:::::
.t........8...........HHHHHd....bBBBBBBB.......GgggGGGGGGGG:::::
,,,,,,,,,..*.l,HHHHHHHHHHHHH....BBBBBBBB.......GgggGGGGGGGG:::t:
,HHHHHHHH.....,HHHHHHHHHHHHH....BBBBBBBB.......YgggGGGGGGGG:::::
,HHHHHHHH..*..,HHHHHHHHHHHHh....BBBBBBBB.......GgggGGGGGGGG:::::
,HHHHHHHd.....,HHHHHHHHHHHHH....BBBBBBBB#######GGGGGGGGGGGG:::::
,HHHHHHHH..*..,HHhHdHHHHHHHH....::::::::::::::::::::::::::::::::
,HHHHHHHH............................:::::::::::::::::::::::::::
,HHHHHHHh.....l*.*.*.*.*.*.*.*.*.*.*l.EEEEEEEEEE:,,,,,,,,,,:::::
,HHHHHHHH.............................EEEEEEEEEE:HHHHHHHHHH:::::
,HHHHhHHH............m................eEEEEEEEEE:HHHHHHHHHH:::::
,::::::::........m.............m.....1EEEEEEEEEE:dHHHHHHHHH:::::
,::::::::.............................XEEEEEEEEE:HHHHHHHHHH:t:::
,BBBbBBBB................s............EEEEEEEEEE:HHHHHHHHHH:::::
,BBBBBBBB........m....................EEEEEEEEEE:HHHHHHHHHH:::::
,BBBBBBBD......................m......eEEEEEEEEE:hHHHHHHHHH:::::
,BBBBBBBB.............................EEEEEEEEEE:HHHHHHHHHH:::::
,BBBBBBBb............m.....m..........EEEeEEeEEE:HHHHHHHHHH:::::
tBBBBBBBB.......................................................
,BBBBBBBB.....l*.*.*.*.*.*.*.*.*.*.*l...........................
......................l.................l.......................
KKKKKKKKKKKKKKKKKKKKKKKvvvKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK~~~
KKKKKKKKKKKKKKKKKKKKKKKvvvKKKKWWWWWWWWWWKWWWWWWWWWKKKKKKKKKKK~~~
KKKKKKKKKKKKKKKKKKKKKKKvvvRKKKWWWWWWWWWWKWWWWWWWWWKKNNNNNNNNN~~~
KKKKKKKKKKKKKKKKKKKKKKKvvvKKKKWWWxWWxWWWKWWWxWWxWWKKNNNNNNNNN~~~
____________j_____________________________________j_NNNNNNNNN~~~
______k_n_________r___________j___________k_j_______nNNNNNNNN~~~
________________k___________k_______________________NNNNNNNNN~~~
___c__________c_____c____________c______c______c____NNNNNNNNN~~~
~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~==NNNNNNNNNwww
wwwwwwwww==wwwwwwwwwwwwwwwwwwwwwwwwww==wwwwwwwwwww==NNNNNNNNNwww
wwwwwwwww==wwwwwwwwwwwwwwwwwwwwwwwwww==wwwwwwwwwww==NNNNNNNNNwww
wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
`;

const LOCKED = { blocks: true };
const lamp = (ground: "cobbles" | "boards") => T(ground, {}, { name: "a lamp post", glyph: "¤", color: "#e8c070", blocks: true, states: ["lamp"], text: "A lamp post, freshly painted for the Assembly and already leant on." });

export const caerwyn: MapDef = buildMap({
  id: "caerwyn",
  name: "Caerwyn",
  grid: GRID,
  legend: {
    ",": T("grass"), ".": T("cobbles"), ":": T("dirt"), _: T("boards"), "~": T("water"), w: T("deep-water"), v: T("stairs"), "=": T("bridge"),
    t: T("tree"), T: T("tree", {}, { id: "caerwyn:elm", name: "the old elm", glyph: "♣", color: "#4f8a3a", states: ["scenery"], text: "Old, dry and leaning over the yard wall. The pigeons in it have opinions about everybody." }),
    // The palace on the rise: pale stone, slate roofs, a great deal of new bunting.
    P: T("wall", { style: "palace", height: 5 }), p: T("window", { style: "palace", height: 5 }), Q: T("door", { style: "palace", height: 5 }),
    // Houses, brick and plaster; their doors are locked (everyone's out hanging bunting).
    H: T("wall", { style: "plaster", height: 3 }), h: T("window", { style: "plaster", height: 3 }), d: T("door", { style: "plaster", height: 3, ...LOCKED }),
    B: T("wall", { style: "brick", height: 3 }), b: T("window", { style: "brick", height: 3 }), D: T("door", { style: "brick", height: 3, ...LOCKED }),
    E: T("wall", { style: "civic", height: 4 }), e: T("window", { style: "civic", height: 4 }), X: T("door", { style: "civic", height: 4, ...LOCKED }),
    // The King's Granary: the tally loft is a floor under its roof, seen when the roof is lifted.
    G: T("wall", { style: "granary", height: 4 }), g: T("boards", { roof: "granary", roofHeight: 4 }),
    L: T("door", { style: "granary", height: 4, ...LOCKED }), Y: T("door", { style: "granary", height: 4, ...LOCKED }),
    o: T("wall", { style: "stone", height: 1 }), O: T("door", { style: "stone", height: 1 }), "#": T("wall", { style: "stone", height: 2 }),
    // The bank down to the wharves, with the Drowned Rat's door on the stairs' landing.
    K: T("wall", { style: "bank", height: 2 }), R: T("door", { style: "bank", height: 2 }),
    W: T("wall", { style: "timber", height: 4 }), x: T("door", { style: "timber", height: 4, ...LOCKED }),
    N: T("wall", { style: "tar", height: 4 }), n: T("door", { style: "tar", height: 4, ...LOCKED }),
    S: T("dirt", { roof: "timber", roofHeight: 2 }),
    // Decor.
    "*": T("cobbles", {}, { name: "bunting", glyph: "▾", states: ["overhead"] }),
    l: lamp("cobbles"), j: lamp("boards"),
    m: T("cobbles", {}, { name: "a market stall", glyph: "Π", color: "#d9a066", blocks: true, text: "A stall selling Assembly souvenirs: commemorative mugs with the King's face on, the face slightly wrong." }),
    s: T("cobbles", {}, { id: "caerwyn:statue", name: "the statue of Good King Bertram", glyph: "Å", color: "#b8c4c8", blocks: true, text: "Good King Bertram the Moderately Wise, in bronze, with a pigeon on his head. The pigeon looks more regal." }),
    "1": T("cobbles", {}, { id: "caerwyn:price-board", name: "the Corn Exchange price board", glyph: "▤", color: "#e0c890", blocks: true, text: "BREAD: DEAR. FLOUR: DEARER. GRAIN: ASK. QUESTIONS: NOT TAKEN." }),
    "2": T("cobbles", {}, { id: "caerwyn:no-bunting", name: "a sign", glyph: "▤", color: "#e0c890", blocks: true, text: "NO BUNTING BEYOND THIS POINT. BY ORDER OF THE ASSEMBLY COMMITTEE (DECORATIONS SUB-COMMITTEE)." }),
    "3": T("dirt", { roof: "timber", roofHeight: 2 }, { id: "caerwyn:cart", name: "a grain cart", glyph: "▬", color: "#a07a4a", blocks: true, text: "A granary cart with one wheel off, which is how it gets out of processions." }),
    "4": T("dirt", {}, { name: "a washing line", glyph: "▿", color: "#f0f0e8", states: ["overhead"] }),
    "8": T("cobbles", {}, { id: "caerwyn:palace-notice", name: "a notice by the palace gate", glyph: "▤", color: "#e0c890", blocks: true, text: "THE CENTENNIAL ASSEMBLY. DELEGATIONS BY THE FRONT. TRADES BY THE BACK. PIGS NOT AT ALL." }),
    k: T("boards", {}, { name: "crates", glyph: "▣", color: "#a07a4a", blocks: true, text: "Crates marked FRAGILE, which the porters take as a challenge." }),
    c: T("boards", {}, { name: "a bollard", glyph: "▪", color: "#7a7a7a" }),
    r: T("boards", {}, { id: "caerwyn:crane", name: "the wharf crane", glyph: "╤", color: "#8a6a48", blocks: true, text: "A treadwheel crane. A sign on the wheel says NO HAMSTERS." }),
  },
  regions: [
    { id: "granary-yard", name: "the yard behind the King's Granary", rect: { x: 40, y: 11, w: 7, h: 6 }, sceneId: "hanged-clerk", worldOrigin: { x: 40, y: 9 }, trigger: "enter", label: "Step into the granary yard",
      description: "A cobbled yard swept bare for the Assembly, smelling of wet grain, pigeons and river mud." },
    { id: "tally-loft", name: "the tally loft", rect: { x: 48, y: 11, w: 3, h: 6 }, sceneId: "hanged-clerk", worldOrigin: { x: 40, y: 9 },
      description: "Up under the granary roof: the tally desk, the grain stacks, and the Royal Granary Roll on its chain." },
    { id: "heron-wharf", name: "the downriver end of the wharves", rect: { x: 45, y: 37, w: 7, h: 4 }, sceneId: "heron-warehouse", trigger: "enter", label: "Go along to the Heron",
      description: "Where the wharf lamps give out, and the Heron's hoist creaks over the water." },
    { id: "palace", name: "the palace", rect: { x: 2, y: 1, w: 19, h: 12 }, exteriorOf: "kings-morning", opensFor: "kings-morning",
      shut: "The guards at the gate cross their halberds with the air of men who have been waiting all week to do it. The palace is shut to anyone without business.",
      description: "King Aldren's palace on the rise: gilt, tapestries and a great deal of new bunting, in a winter when bread is dear." },
    { id: "palace-street", name: "Palace Street", rect: { x: 9, y: 13, w: 5, h: 7 }, description: "The procession route from the palace gate down to the square, bunting on every rope that will hold it." },
    { id: "granary-lane", name: "the granary lane", rect: { x: 22, y: 7, w: 42, h: 3 }, description: "The lane behind the King's Granary: porters, pigeons and, as far as the sign, bunting." },
    { id: "watch-house", name: "the watch house", rect: { x: 23, y: 2, w: 6, h: 5 }, description: "The watch house. Everyone is out lining the procession route; a note on the door says so." },
    { id: "cart-shed", name: "the cart shed", rect: { x: 41, y: 3, w: 6, h: 4 }, description: "An open-fronted shed with a cart in it that has seen better wheels." },
    { id: "porters-lodgings", name: "the porters' lodgings", rect: { x: 48, y: 1, w: 11, h: 5 }, description: "Where the granary porters sleep, in shifts, in the same beds." },
    { id: "the-granary", name: "the King's Granary", rect: { x: 47, y: 10, w: 12, h: 8 }, description: "The King's Granary: brick, timber and padlocks, and the palace's grain inside, what there is of it." },
    { id: "granary-street", name: "Granary Street", rect: { x: 28, y: 10, w: 4, h: 10 }, description: "The street down from the granary quarter to the market square." },
    { id: "pudding-lane", name: "Pudding Lane", rect: { x: 32, y: 18, w: 28, h: 2 }, description: "An alley behind the granary that smells of neither pudding nor anything you'd want in one." },
    { id: "market-square", name: "the market square", rect: { x: 14, y: 19, w: 23, h: 13 }, description: "Stalls, bunting, sweepers, delegations' servants everywhere, and bread dearer than last week." },
    { id: "corn-exchange", name: "the Corn Exchange", rect: { x: 38, y: 20, w: 10, h: 10 }, description: "Where the grain factors trade, post prices and keep the wagon lists. Shut for the Assembly." },
    { id: "cheap-alley", name: "Cheap Alley", rect: { x: 1, y: 23, w: 13, h: 2 }, description: "A side alley where everything is cheap except the advice." },
    { id: "bank-street", name: "Bank Street", rect: { x: 0, y: 32, w: 64, h: 1 }, description: "The street along the top of the bank, with the river below and the smell of it everywhere." },
    { id: "rat-door", name: "the Drowned Rat's door", rect: { x: 26, y: 35, w: 1, h: 1 }, opensFor: "drowned-rat", exteriorOf: "drowned-rat",
      shut: "The Drowned Rat's door is shut. A board nailed to it says: OPENS AT DUSK. NO CREDIT. NO WATCH. N. QUILL.",
      description: "A low, heavy door in the bank, three steps down from the landing, with the din of the Rat behind it." },
    { id: "river-stairs", name: "the river stairs", rect: { x: 23, y: 33, w: 4, h: 4 }, description: "Worn, wet steps down the bank to the wharves. Nobody has ever counted the same number twice. Halfway down, the Drowned Rat's door." },
    { id: "wharves", name: "the wharves", rect: { x: 0, y: 37, w: 52, h: 4 }, description: "Boards, bollards, crates and the river slapping underneath. Porters wait for work with their hooks." },
    { id: "heron-exterior", name: "the Heron warehouse", rect: { x: 52, y: 35, w: 9, h: 9 }, exteriorOf: "heron-warehouse", description: "A tall, tarred warehouse half on the wharf and half on piles, under a painted heron." },
    { id: "river", name: "the river", rect: { x: 0, y: 41, w: 64, h: 5 }, description: "Brown, fast and freezing. What goes in comes out at the sea, or doesn't." },
  ],
  exits: [
    { at: { x: 11, y: 12 }, to: { map: "palace", at: { x: 2, y: 10 } }, label: "Through the palace gate" },
    { at: { x: 26, y: 35 }, to: { map: "drowned-rat", at: { x: 3, y: 3 } }, label: "The Drowned Rat's door" },
    ...[37, 38, 39, 40].map(y => ({ at: { x: 51, y }, to: { map: "heron", at: { x: 1, y: Math.min(8, y - 33) } }, label: "Along the wharf to the Heron" })),
  ],
});

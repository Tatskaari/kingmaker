import { buildMap, T, type MapDef } from "../tiles.ts";

/**
 * The Heron warehouse at the downriver end of the wharves, 5 ft to a tile. It lines up with
 * src/game/map/worlds/heron.ts: the world's (0, 0) feet is tile (2, 1). The wharf and Saul's land
 * door on the west; the long re-sacking floor inside (half over the river on piles), the
 * glass-sided counting-box up a short stair in the north-east corner; the plank walk on the piles
 * round to the low river door on the south side; and the barge Patience alongside.
 */

const GRID = `
KKKKKKKKKKKKKKKKKKKKKKK
_______________________
________NNNNNNNNNNNNwww
________NFFFFFFgcccNwww
________NFFFFFFgcccNwww
________DFFFFFFgcccNwww
________DFFFFFFgsggNwww
________NFFFFFFFFFFNwww
________NFFFFFFFFFFNwww
________NFFFFFFFFFFNwww
~~~~~~~=NFFFFFFFFFFN~~~
~wwwwww=NFFFFFFFFFFNwww
~wwwwww=NFFFFFFFFFFNwww
~wwwwww=NNNNNrNNNNNNwww
~wwwwww========wwwwwwww
~wwwwwwwwuu=uuuuuuuwwww
~wwwwwwwwubbobbobbuwwww
~wwwwwwwwuuuuuuuuuuwwww
~wwwwwwwwwwwwwwwwwwwwww
`;

export const heron: MapDef = buildMap({
  id: "heron",
  name: "The Heron Warehouse",
  grid: GRID,
  legend: {
    _: T("boards"), "~": T("water"), w: T("deep-water"), "=": T("bridge"),
    K: T("wall", { style: "bank", height: 2 }),
    N: T("wall", { style: "tar", height: 4 }),
    // The land door is barred on loading nights; the river door is bolted, and opened to a token.
    D: T("door", { style: "tar", height: 4, blocks: true }),
    r: T("door", { style: "tar", height: 4, blocks: true }),
    F: T("boards", { roof: "tar", roofHeight: 4 }),
    // The counting-box: glass on two sides, up a short stair, under a lower roof of its own.
    g: T("window", { style: "panel", height: 2 }),
    s: T("door", { style: "panel", height: 2 }),
    c: T("floor", { roof: "panel", roofHeight: 2 }),
    u: T("fence", { style: "hull", height: 1 }),
    b: T("boards"),
    o: T("boards", {}, { name: "an open hatch", glyph: "▦", color: "#3a2a1a", text: "An open hatch into the barge's hold, half full of sacks with herons on." }),
  },
  regions: [
    { id: "heron", name: "the Heron", rect: { x: 0, y: 0, w: 23, h: 19 }, sceneId: "heron-warehouse", worldOrigin: { x: 2, y: 1 }, trigger: "enter", label: "Creep along the wharf to the Heron",
      description: "A tall, tarred timber warehouse standing half on the wharf and half on piles over the river, with a painted heron on its signboard." },
    { id: "heron-wharf-end", name: "the wharf outside the Heron", rect: { x: 0, y: 1, w: 8, h: 9 }, description: "The end of the wharf, where the lamps give out: the watchman's sentry box and brazier by the land door, and the dark." },
    { id: "heron-floor", name: "the re-sacking floor", rect: { x: 9, y: 3, w: 10, h: 10 }, description: "One long floor lit by lanterns and thick with grain dust, which hangs in the light like fog." },
    { id: "counting-box", name: "the counting-box", rect: { x: 16, y: 3, w: 3, h: 3 }, description: "A glass-sided box up a short stair, over the floor: a desk, a lamp, and the true book under a clerk's hand." },
    { id: "plank-walk", name: "the plank walk", rect: { x: 7, y: 10, w: 8, h: 5 }, description: "A slippery plank walk on the piles, round to the river door. The river runs fast and black underneath." },
    { id: "patience", name: "the barge Patience", rect: { x: 9, y: 15, w: 10, h: 3 }, description: "The Saltmere barge Patience, broad and low, hatches open, waiting for the ebb. She waits for no one." },
  ],
  exits: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(y => ({ at: { x: 0, y }, to: { map: "caerwyn", at: { x: 50, y: 38 } }, label: "Back along the wharves" })),
});

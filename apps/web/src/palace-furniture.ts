import type { Scenario } from "../../../packages/contracts/src/index.js";
import { FurnitureBuilder } from "./furniture-builder.js";
import { palaceLayout } from "./palace-layout.js";
import { palaceNodes } from "./palace-navigation.js";

/** Canonical additions; the original 26 fixtures and their evidence stay intact. */
export function palaceFurniture(scenario: Scenario) {
  const builder = new FurnitureBuilder(palaceLayout, scenario, palaceNodes);
  const item = (id: string, name: string, details: string) => ({ id: `furn_${id}`, name, details });
  const put = (room: string, x: number, y: number, id: string, name: string, sprite: number,
    items: ReturnType<typeof item>[] = [], owner?: string, approach?: { x: number; y: number }) =>
    builder.add(room, x, y, { id: `furn_${id}`, name, sprite, items, ...(owner ? { owner } : {}), ...(approach ? { approach } : {}) });
  const bed = (room: string, x: number, y: number, id: string, name: string) => {
    put(room, x, y, `${id}_bed_head`, `${name}'s bed — pillow`, 79);
    put(room, x + 1, y, `${id}_bed_foot`, `${name}'s bed — blanket`, 80);
  };
  const guests = [
    ["mara", "Mara", "Ironmark dress uniform", "A carefully folded formal uniform for the centennial assembly.", "Draft assembly address", "Mara's notes argue for lawful succession and disciplined conduct."],
    ["hadrik", "Hadrik", "Campaign cloak", "A wool cloak patched after many wet nights on campaign.", "Campaign chess pieces", "A travel set with more replacement pawns than originals."],
    ["tessa", "Tessa", "Riding gloves", "Practical gloves worn smooth at the reins.", "Route sketchbook", "Personal sketches of milestones and stopping places, with no confidential patrol figures."],
    ["elinor", "Elinor", "Embroidered shawl", "A Greenweald shawl patterned with oak leaves.", "Assembly seating notes", "Draft notes balance rank, courtesy and rival delegations."],
    ["oswin", "Oswin", "Prayer beads", "Wooden beads polished by years of daily use.", "Book of stewardship", "Homilies about the duties rulers owe to those who cannot repay them."],
    ["rowan", "Rowan", "Trail cloak", "A travel cloak with burrs still caught along its hem.", "Pressed-leaf journal", "Leaves and brief recollections from the journey to Caerwyn."],
    ["lucan", "Lucan", "Pearl cufflinks", "A matched pair chosen to impress at the assembly.", "Trade proposal drafts", "Negotiating positions for future tolls; these are proposals, not signed concessions."],
    ["sabine", "Sabine", "Merchant's travel coat", "A hard-wearing coat with neatly repaired pockets.", "Abacus", "A small counting frame used to check ordinary household expenses."],
    ["rook", "Rook", "Weathered satchel", "An empty courier's satchel, cleaned for the palace visit.", "Dice cup", "A leather cup and ordinary bone dice; none appears weighted."],
  ] as const;
  for (const [id, name, clothing, clothingDetails, personal, personalDetails] of guests) {
    const room = `${id}_chamber`;
    bed(room, 0, 0, id, name);
    put(room, 6, 0, `${id}_wardrobe`, `${name}'s travel wardrobe`, 75, [item(`${id}_clothing`, clothing, clothingDetails)]);
    const deskItems = [item(`${id}_personal`, personal, personalDetails)];
    if (id === "sabine") deskItems.push(item("sabine_dispatch_ledger", "Saltmere dispatch ledger",
      "Sabine's private register lists Saltmere caravan bookings, gates and escort arrangements. Tomorrow's west-gate departures contain no Grey Gull booking, escorted or otherwise. This register cannot establish whether an unregistered caravan exists. Marginal notes cross-reference rising losses with fewer royal patrol sightings; they do not give official patrol headcounts."));
    put(room, 0, 3, `${id}_desk`, `${name}'s writing table`, 72, deskItems);
    put(room, 1, 3, `${id}_stool`, `${name}'s desk stool`, 73);
  }
  bed("corvin_chamber", 3, 3, "corvin", "Corvin");
  bed("garran_chamber", 3, 0, "garran", "Garran");
  bed("royal_bedchamber", 4, 3, "king", "Aldren");

  const salons = [
    ["ironmark_salon", "ironmark", "Campaign table", "mara", "Campaign map", "An old training map with wooden markers, not a record of current royal patrols."],
    ["greenweald_solar", "greenweald", "Tea table", "elinor", "Herbal tea tin", "Dried mint and meadow flowers from Greenweald."],
    ["saltmere_drawing_room", "saltmere", "Chart table", "lucan", "Coastal chart", "A merchant's chart of familiar Saltmere harbours and safe anchorages."],
  ] as const;
  for (const [room, id, table, owner, object, details] of salons) {
    put(room, 3, 3, `${id}_table`, table, 72, [item(`${id}_table_item`, object, details)], owner);
    put(room, 2, 3, `${id}_seat`, "Guest stool", 73);
    put(room, 7, 0, `${id}_sideboard`, "Hospitality sideboard", 75, [
      item(`${id}_cups`, "Guest cups", "Clean cups set aside for visitors to this delegation."),
      item(`${id}_biscuits`, "Oat biscuits", "A small tin of biscuits for receiving guests."),
    ]);
    put(room, 0, 0, `${id}_books`, "Delegation bookcase", 63, [item(`${id}_protocol`, "Assembly protocol", "The public order of ceremonies and rules for formal petitions.")], owner);
  }
  put("royal_council_chamber", 1, 1, "council_table", "Council writing table", 72,
    [item("council_agenda", "Council agenda", "Petitions, palace supplies and preparations for the centennial assembly.")], "king");
  put("royal_council_chamber", 4, 0, "council_archive", "Petition cabinet", 75,
    [item("blank_petition", "Blank petition forms", "Unused forms for bringing a matter before the council.")], "corvin");

  // Two long banquet tables, with a clear central aisle and access along both sides.
  for (const row of [2, 6]) for (let x = 8; x <= 30; x++) {
    put("dining_hall", x, row, `banquet_${row}_${x}`, "Banquet table", 72, [], undefined, { x, y: row === 2 ? 3 : 5 });
  }
  for (let x = 8; x <= 30; x += 4) {
    put("dining_hall", x, 1, `banquet_north_seat_${x}`, "Dining stool", 73, [], undefined, { x, y: 0 });
    put("dining_hall", x, 7, `banquet_south_seat_${x}`, "Dining stool", 73);
  }
  put("dining_hall", 1, 0, "dining_sideboard", "Dining silver sideboard", 75, [
    item("dining_goblets", "Pewter goblets", "Sturdy goblets engraved with the Caerwyn crest."),
    item("dining_linen", "Clean table linen", "Fresh linen folded ready for the evening banquet."),
  ]);
  put("dining_hall", 36, 0, "dining_bread", "Bread and cheese serving table", 72, [
    item("bread", "Round loaf", "A fresh loaf from the palace kitchen."),
    item("cheese", "Farmhouse cheese", "A wrapped wedge of mild cheese supplied for the guests."),
  ]);
  put("dining_hall", 38, 0, "dining_water", "Drinking-water barrel", 82,
    [item("water_pitcher", "Filled water pitcher", "Clean drinking water for the dining tables.")]);
  return builder.fixtures;
}

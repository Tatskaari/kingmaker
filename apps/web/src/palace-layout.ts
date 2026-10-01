import { RoomBuilder } from "./room-builder.js";

const definitions = [
  { id: "corvin_chamber", name: "Corvin's Chamber", regions: [{ x: 3, y: 3, width: 5, height: 5 }] },
  { id: "royal_bedchamber", name: "Royal Bedchamber", regions: [
    { x: 13, y: 3, width: 6, height: 5 },
    { x: 15, y: 8, width: 2, height: 1 },
  ] },
  { id: "garran_chamber", name: "Garran's Chamber", regions: [{ x: 24, y: 3, width: 5, height: 5 }] },
  { id: "north_corridor", name: "Royal Back Hall", regions: [
    { x: 3, y: 11, width: 26, height: 3 },
    { x: 5, y: 8, width: 2, height: 3 },
    { x: 15, y: 9, width: 2, height: 2 },
    { x: 25, y: 8, width: 2, height: 3 },
    { x: 5, y: 14, width: 2, height: 3 },
  ] },
  { id: "royal_council_chamber", name: "Royal Council Chamber", regions: [
    { x: 2, y: 17, width: 6, height: 4 },
    { x: 8, y: 18, width: 2, height: 2 },
  ] },
  { id: "great_hall", name: "Great Hall", regions: [
    { x: 10, y: 17, width: 12, height: 13 },
    { x: 8, y: 25, width: 2, height: 2 },
    { x: 22, y: 22, width: 2, height: 2 },
    { x: 15, y: 30, width: 2, height: 3 },
  ] },
  { id: "guest_chamber", name: "Nobles' Parlour", regions: [{ x: 2, y: 24, width: 6, height: 9 }] },
  { id: "entrance_hall", name: "Entrance Hall", regions: [
    { x: 12, y: 33, width: 8, height: 4 },
    { x: 15, y: 37, width: 2, height: 12 },
  ] },
  { id: "treasury", name: "Treasury", regions: [{ x: 24, y: 21, width: 6, height: 9 }] },
  { id: "palace_back_hall", name: "Palace Back Hall", regions: [
    { x: 22, y: 17, width: 13, height: 1 },
    { x: 32, y: 12, width: 3, height: 33 },
    { x: 35, y: 13, width: 2, height: 2 },
    { x: 35, y: 28, width: 2, height: 2 },
    { x: 35, y: 43, width: 2, height: 2 },
  ] },
  { id: "ironmark_salon", name: "Ironmark Salon", regions: [{ x: 37, y: 7, width: 9, height: 9 }] },
  { id: "ironmark_back_hall", name: "Ironmark Back Hall", regions: [
    { x: 48, y: 13, width: 27, height: 2 },
    { x: 46, y: 13, width: 2, height: 2 },
    { x: 52, y: 10, width: 2, height: 3 },
    { x: 62, y: 10, width: 2, height: 3 },
    { x: 72, y: 10, width: 2, height: 3 },
  ] },
  { id: "mara_chamber", name: "Mara's Chamber", regions: [{ x: 50, y: 5, width: 7, height: 5 }] },
  { id: "hadrik_chamber", name: "Hadrik's Chamber", regions: [{ x: 60, y: 5, width: 7, height: 5 }] },
  { id: "tessa_chamber", name: "Tessa's Chamber", regions: [{ x: 70, y: 5, width: 7, height: 5 }] },
  { id: "greenweald_solar", name: "Greenweald Solar", regions: [{ x: 37, y: 22, width: 9, height: 9 }] },
  { id: "greenweald_back_hall", name: "Greenweald Back Hall", regions: [
    { x: 48, y: 28, width: 27, height: 2 },
    { x: 46, y: 28, width: 2, height: 2 },
    { x: 52, y: 25, width: 2, height: 3 },
    { x: 62, y: 25, width: 2, height: 3 },
    { x: 72, y: 25, width: 2, height: 3 },
  ] },
  { id: "elinor_chamber", name: "Elinor's Chamber", regions: [{ x: 50, y: 20, width: 7, height: 5 }] },
  { id: "oswin_chamber", name: "Oswin's Chamber", regions: [{ x: 60, y: 20, width: 7, height: 5 }] },
  { id: "rowan_chamber", name: "Rowan's Chamber", regions: [{ x: 70, y: 20, width: 7, height: 5 }] },
  { id: "saltmere_drawing_room", name: "Saltmere Drawing Room", regions: [{ x: 37, y: 37, width: 9, height: 9 }] },
  { id: "saltmere_back_hall", name: "Saltmere Back Hall", regions: [
    { x: 48, y: 43, width: 27, height: 2 },
    { x: 46, y: 43, width: 2, height: 2 },
    { x: 52, y: 40, width: 2, height: 3 },
    { x: 62, y: 40, width: 2, height: 3 },
    { x: 72, y: 40, width: 2, height: 3 },
  ] },
  { id: "lucan_chamber", name: "Lucan's Chamber", regions: [{ x: 50, y: 35, width: 7, height: 5 }] },
  { id: "sabine_chamber", name: "Sabine's Chamber", regions: [{ x: 60, y: 35, width: 7, height: 5 }] },
  { id: "rook_chamber", name: "Rook's Chamber", regions: [{ x: 70, y: 35, width: 7, height: 5 }] },
];

export const palaceLayout = new RoomBuilder(78, 49);
const delegations = {
  ironmark_back_hall: ["mara", "hadrik", "tessa"],
  greenweald_back_hall: ["elinor", "oswin", "rowan"],
  saltmere_back_hall: ["lucan", "sabine", "rook"],
};
const residents: Record<string, string[]> = {
  ...delegations,
  north_corridor: ["corvin", "king", "garran"],
  royal_bedchamber: ["king"],
  guest_chamber: ["player", "corvin", "garran", "king", ...Object.values(delegations).flat()],
};
for (const member of ["corvin", "garran", ...Object.values(delegations).flat()]) residents[`${member}_chamber`] = [member];
for (const room of definitions) palaceLayout.room({ ...room, residents: residents[room.id] ?? [] });

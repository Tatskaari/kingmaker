import type { NavEdge, NavNode } from "./navigation.js";

export const palaceNodes: NavNode[] = [
  { id: "great_hall", name: "Great Hall", x: 15, y: 21 },
  { id: "entrance", name: "Entrance Hall", x: 15, y: 29 },
  { id: "west_junction", name: "West Corridor", x: 5, y: 12 },
  { id: "north_junction", name: "North Junction", x: 15, y: 12 },
  { id: "east_junction", name: "East Corridor", x: 25, y: 12 },
  { id: "merlin", name: "Merlin's Chamber", x: 5, y: 5 },
  { id: "royal", name: "Royal Bedchamber", x: 15, y: 5 },
  { id: "lancelot", name: "Lancelot's Chamber", x: 26, y: 5 },
  { id: "guest", name: "Guest Chamber", x: 5, y: 25 },
  { id: "treasury", name: "Treasury", x: 26, y: 25 },
];
export const palaceEdges: NavEdge[] = [
  ["great_hall", "entrance"], ["great_hall", "north_junction"],
  ["great_hall", "guest"], ["great_hall", "treasury"],
  ["north_junction", "west_junction"], ["north_junction", "east_junction"],
  ["west_junction", "merlin"], ["east_junction", "lancelot"], ["north_junction", "royal"],
].map(([from, to]) => ({ from: from!, to: to! }));

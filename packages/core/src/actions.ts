/** A concrete command returned to the game; selecting one does not execute it. */
export interface GameAction {
  id: string; type: "move" | "door" | "fixture" | "talk"; target: string;
  description: string;
  /** Manhattan distance to the nearest interaction candidate; ignores obstacles. */
  estimatedSteps?: number;
  /** Empty during discovery; populated only when planning a selected action. */
  path: { x: number; y: number }[];
  interactionRoomId?: string; open?: boolean; legality?: "normal" | "illegal";
}

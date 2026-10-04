import { create, type JsonValue } from "@bufbuild/protobuf";
import { EventSchema, type WorldState } from "../../../packages/contracts/src/index.js";
import { gameLogger } from "../../../packages/observability/src/logging.js";

const eventLog = gameLogger("events");
/** The caller selects actor ordering; events capture the first participant's physical body. */
export function createPhysicalEvent(map: Pick<WorldState, "actors" | "day"> | undefined,
  kind: string, summary: string, participantIds: string[], details: Record<string, JsonValue> = {}) {
  const actor = map?.actors.find(candidate => candidate.characterId === participantIds[0]);
  const event = create(EventSchema, { id: `event-${crypto.randomUUID()}`, day: map?.day ?? 0,
    kind, summary, participantIds, position: actor?.position, details });
  eventLog.info("World event created", { eventId: event.id, day: event.day, kind, summary, participantIds, position: event.position, details });
  return event;
}

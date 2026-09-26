import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromBinary, fromJsonString, toBinary, toJsonString } from "@bufbuild/protobuf";
import {
  AvailableActionSchema,
  DecisionRequestSchema,
  DialogueRequestSchema,
  EventVisibility,
  GameMasterRequestSchema,
  GamePhase,
  PlayerSetupSchema,
  RelationshipSchema,
  RelationshipUpdateSchema,
  CharacterSchema,
  ScenarioSchema,
  TranscriptRole,
  type Scenario,
} from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../packages/core/src/context.js";
import { MemoryGame } from "../packages/core/src/game.js";

const fixturePath = new URL("../content/scenarios/last-night.json", import.meta.url);
const load = (): Scenario => fromJsonString(ScenarioSchema, readFileSync(fixturePath, "utf8"));

test("the small authored scenario strictly parses and survives protobuf", () => {
  const scenario = load();
  const decoded = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.equal(toJsonString(ScenarioSchema, decoded), toJsonString(ScenarioSchema, scenario));
  assert.deepEqual(scenario.characters.map(character => character.id), ["merlin", "lancelot", "king"]);
  assert.equal(scenario.events.length, 3);
  assert.match(scenario.premise, /emissary from a vassal state of Caerwyn/);
  assert.equal(scenario.world?.phase, GamePhase.PLAYER_CREATION);
  assert.ok(scenario.world?.actors.every(actor => !actor.awake && actor.roomId === actor.homeRoomId));
  assert.equal(scenario.world?.rooms.length, 8);
  assert.ok(scenario.world?.rooms.every(room => room.searchSpots.length === 0 || room.searchSpots.length >= 3));
});

test("game master context frames an emissary interview without defining the player", () => {
  const scenario = load();
  const request = create(GameMasterRequestSchema, { scenario });
  const messages = new FullGameMasterContextBuilder().build(request);
  const prompt = messages.map(message => message.content).join("\n");
  assert.equal(messages.length, 5);
  assert.match(prompt, /player define or invent their homeland/i);
  assert.match(prompt, /emissary from a vassal state of Caerwyn/i);
  assert.match(prompt, /Interview the player/);
  assert.doesNotMatch(prompt, /playerCharacterId/);
});

test("dialogue context includes premise before character context and conversation", () => {
  const scenario = load();
  const request = create(DialogueRequestSchema, {
    characterId: "merlin",
    scenario,
    transcript: [
      { role: TranscriptRole.PLAYER, speakerId: "player", text: "Would you trust Lancelot with the key?" },
      { role: TranscriptRole.CHARACTER, speakerId: "merlin", text: "Trust is too generous a word." },
    ],
  });
  const messages = new FullContextBuilder().build(request);
  assert.equal(messages.length, 8);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /^# Scenario premise[\s\S]*ancient law/);
  assert.match(messages[2]?.content ?? "", /# Character[\s\S]*# Current goal/);
  assert.match(messages[3]?.content ?? "", /^# Relationships/);
  assert.match(messages[4]?.content ?? "", /^# Events/);
  assert.match(messages[5]?.content ?? "", /^# Known world state/);
  assert.equal(messages[6]?.content, "Would you trust Lancelot with the key?");
  assert.equal(messages[7]?.role, "assistant");
});

test("Merlin sees his known key location but not Lancelot's hidden lockbox", () => {
  const scenario = load();
  assert.ok(scenario.world);
  const request = create(DialogueRequestSchema, { characterId: "merlin", scenario });
  const prompt = new FullContextBuilder().build(request).map(message => message.content).join("\n");
  const world = worldForCharacter(scenario.world, "merlin");
  assert.match(prompt, /brass_key/);
  assert.match(prompt, /merlin_desk/);
  assert.match(prompt, /left humiliated/);
  assert.ok(!world.objects.some(object => object.id === "crown_box"));
  assert.ok(!world.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "chapel_altar"));
  assert.doesNotMatch(prompt, /ordinary banter|unexpectedly took offence/);
});

test("Lancelot sees the crown box while an uninformed king sees neither hiding place", () => {
  const scenario = load();
  assert.ok(scenario.world);
  const lancelot = worldForCharacter(scenario.world, "lancelot");
  const king = worldForCharacter(scenario.world, "king");
  assert.ok(lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "chapel_altar"));
  assert.ok(lancelot.objects.some(object => object.id === "crown_box"));
  assert.ok(!lancelot.objects.some(object => object.id === "brass_key"));
  assert.ok(!lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "merlin_desk"));
  assert.ok(!king.objects.some(object => object.id === "brass_key" || object.id === "crown_box"));
  assert.ok(!king.rooms.flatMap(room => room.searchSpots).some(spot =>
    spot.id === "merlin_desk" || spot.id === "chapel_altar",
  ));
});

test("Jev request carries free goal, events, world and grounded actions", () => {
  const scenario = load();
  const merlin = scenario.characters.find(character => character.id === "merlin");
  assert.ok(merlin && scenario.world);
  const actions = [
    create(AvailableActionSchema, {
      id: "wake:merlin",
      type: "wake",
      description: "Wake up in Merlin's chamber.",
      parameters: {},
    }),
  ];
  const request = create(DecisionRequestSchema, {
    character: merlin,
    world: worldForCharacter(scenario.world, "merlin"),
    recentEvents: scenario.events.filter(event =>
      event.characterIds.includes("merlin") || event.visibility === EventVisibility.PUBLIC,
    ),
    availableActions: actions,
  });
  assert.match(request.character?.currentGoal ?? "", /Prevent the king/);
  assert.deepEqual(request.availableActions.map(action => action.id), ["wake:merlin"]);
  assert.equal(request.world?.revision, 0);
  assert.equal(request.world?.day, 0);
  assert.equal(request.world?.solsticeDay, 2);
});

test("unknown fixture fields remain schema errors", () => {
  assert.throws(() => fromJsonString(ScenarioSchema, '{"id":"x","quests":[]}'));
});

test("creating the emissary begins day one with the whole cast in the Great Hall", () => {
  const game = new MemoryGame(load());
  const npcIds = ["merlin", "lancelot", "king"];
  const setup = create(PlayerSetupSchema, {
    homeland: "Valedorn",
    embassyRole: "special envoy",
    player: create(CharacterSchema, {
      id: "ignored",
      name: "Ilyra Venn",
      lore: "A Valedorn envoy carrying a trade mandate and a private interest in a peaceful succession.",
      currentGoal: "Learn what each claimant intends before choosing whom to support.",
      relationships: npcIds.map(characterId => create(RelationshipSchema, {
        characterId,
        description: `Ilyra has heard conflicting reports about ${characterId}.`,
      })),
    }),
    npcRelationships: npcIds.map(ownerCharacterId => create(RelationshipUpdateSchema, {
      ownerCharacterId,
      relationship: create(RelationshipSchema, {
        characterId: "player",
        description: "A newly arrived foreign envoy whose real loyalties are unknown.",
      }),
    })),
  });

  const created = game.createPlayer(setup);
  assert.equal(created.ok, true);
  const scenario = game.scenario();
  assert.equal(scenario.playerCharacterId, "player");
  assert.equal(scenario.world?.day, 1);
  assert.equal(scenario.world?.phase, GamePhase.CONVERSATIONS);
  assert.deepEqual(scenario.world?.actors.map(actor => actor.characterId).sort(), ["king", "lancelot", "merlin", "player"]);
  assert.ok(scenario.world?.actors.every(actor => actor.roomId === "great_hall" && actor.awake));
  assert.ok(npcIds.every(id => scenario.characters.find(character => character.id === id)?.relationships.some(relationship => relationship.characterId === "player")));
  const arrivals = scenario.events.filter(event => event.type === "arrival");
  assert.equal(arrivals.length, 3);
  assert.ok(arrivals.every(event => event.summary.includes("Ilyra Venn") && event.summary.includes("Valedorn")));
  assert.deepEqual(arrivals.map(event => event.characterIds[0]).sort(), [...npcIds].sort());
});

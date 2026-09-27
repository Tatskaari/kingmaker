import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { create, fromJsonString } from "@bufbuild/protobuf";
import {
  DialogueRequestSchema,
  GameMasterRequestSchema,
  ScenarioSchema,
} from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder } from "../packages/core/src/context.js";

const outputDirectory = resolve(process.argv[2] ?? "/tmp/kingmaker-openrouter-contexts");
const scenarioPath = new URL("../content/scenarios/last-night.json", import.meta.url);
const scenario = fromJsonString(ScenarioSchema, readFileSync(scenarioPath, "utf8"));
const builder = new FullContextBuilder();
const gameMasterBuilder = new FullGameMasterContextBuilder();

mkdirSync(outputDirectory, { recursive: true });

for (const character of scenario.characters) {
  const request = create(DialogueRequestSchema, {
    characterId: character.id,
    scenario,
    transcript: [],
  });
  const payload = {
    model: process.env.DIALOGUE_MODEL || "<DIALOGUE_MODEL>",
    messages: builder.build(request),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "kingmaker_dialogue_turn",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["utterance", "newEvents", "goalUpdate"],
          properties: {
            utterance: { type: "string" },
            newEvents: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["type", "summary", "characterIds", "visibility", "details"],
                properties: {
                  type: { type: "string" },
                  summary: { type: "string" },
                  characterIds: { type: "array", items: { type: "string" } },
                  visibility: {
                    type: "string",
                    enum: ["EVENT_VISIBILITY_PUBLIC", "EVENT_VISIBILITY_PRIVATE"],
                  },
                  details: { type: "object", additionalProperties: false, properties: {} },
                },
              },
            },
            goalUpdate: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["goal", "reason"],
                  properties: {
                    goal: { type: "string" },
                    reason: { type: "string" },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
  writeFileSync(
    resolve(outputDirectory, `${character.id}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

const gameMasterRequest = create(GameMasterRequestSchema, { scenario, transcript: [] });
const gameMasterPayload = {
  model: process.env.DIALOGUE_MODEL || "<DIALOGUE_MODEL>",
  messages: gameMasterBuilder.build(gameMasterRequest),
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "kingmaker_game_master_turn",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["utterance", "playerSetup", "newEvents"],
        properties: {
          utterance: { type: "string" },
          playerSetup: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["player", "npcRelationships"],
                properties: {
                  player: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name", "lore", "relationships", "currentGoal"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      lore: { type: "string" },
                      relationships: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["characterId", "description"],
                          properties: {
                            characterId: { type: "string", enum: scenario.characters.map(character => character.id) },
                            description: { type: "string" },
                          },
                        },
                      },
                      currentGoal: { type: "string" },
                    },
                  },
                  npcRelationships: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["ownerCharacterId", "relationship"],
                      properties: {
                        ownerCharacterId: { type: "string", enum: scenario.characters.map(character => character.id) },
                        relationship: {
                          type: "object",
                          additionalProperties: false,
                          required: ["characterId", "description"],
                          properties: {
                            characterId: { type: "string" },
                            description: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
          newEvents: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "summary", "characterIds", "visibility", "details"],
              properties: {
                type: { type: "string" },
                summary: { type: "string" },
                characterIds: { type: "array", items: { type: "string" } },
                visibility: {
                  type: "string",
                  enum: ["EVENT_VISIBILITY_PUBLIC", "EVENT_VISIBILITY_PRIVATE"],
                },
                details: { type: "object", additionalProperties: false, properties: {} },
              },
            },
          },
        },
      },
    },
  },
};
writeFileSync(
  resolve(outputDirectory, "game-master.json"),
  `${JSON.stringify(gameMasterPayload, null, 2)}\n`,
);

writeFileSync(
  resolve(outputDirectory, "README.txt"),
  [
    "Generated from content/scenarios/last-night.json by the context builders.",
    "The NPC and game-master payloads are shown before the player's first message.",
    "No API key was loaded and no OpenRouter request was made.",
    "",
  ].join("\n"),
);

console.log(outputDirectory);

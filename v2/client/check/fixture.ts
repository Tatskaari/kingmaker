// Data dumped once from the prototype's src/app/smoke/marks-demo.tsx:27-53 (markedYard) at 44c6d4a, with the people by the names the player knows, and each linked mark's card from src/runtime/knowledge.ts:303-333 (knowledgeCard) as of its note; yardRows is new.
import type { SceneRows } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";

/**
 * The granary yard a few turns in, as the rows would give it: the replies with their markup (who
 * says each line, and the notes on their phrases, each linked one with its card), the people on
 * stage by the names the player knows, in their looks' colours. No lines are suggested. Data copied
 * from the prototype's marks demo (src/app/smoke/marks-demo.tsx); the cards are the prototype's
 * knowledgeCard on its session with the transcript as it stood when each note was written, as the
 * AI service writes them (kingmaker-scratch/v2/v5/tools/d-cards.mts dumped them).
 */
export const YARD: SceneView = {
  "sceneId": "7",
  "title": "The Hanged Clerk",
  "time": "Morning",
  "game": "1",
  "hook": "This morning a palace clerk, Wendell Prout, was found hanged behind the Caerwyn granary, and the Watch Captain has already called it suicide. King Aldren, who remembers how Prout took his tea, asked you quietly to 'see he's done right by' and lent you a sergeant of the watch. She's waiting for you in the granary yard. So, by the sound of it, are some children.",
  "player": {
    "name": "Pell Marrow",
    "status": "HP 20/20, spell slots 1st 4/4, 2nd 2/2"
  },
  "present": [
    {
      "key": "kell",
      "name": "Sergeant Agnes Kell",
      "color": "#6d9eeb"
    },
    {
      "key": "cob",
      "name": "the boy in the too-big boots",
      "color": "#e8b15a"
    },
    {
      "key": "moll",
      "name": "the girl in the shawl",
      "color": "#e07ab0"
    }
  ],
  "entries": [
    {
      "turn": 0,
      "speaker": "gm",
      "kind": "narration",
      "text": "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him.\n\n“Sergeant Kell, of the watch. The Captain says suicide.” She doesn't say what she says. “Investigator.”",
      "markup": {
        "speech": [
          {
            "start": 204,
            "end": 260,
            "tag": "Kell",
            "speaker": "kell"
          },
          {
            "start": 292,
            "end": 307,
            "tag": "Kell",
            "speaker": "kell"
          }
        ],
        "marks": [
          {
            "start": 16,
            "end": 34,
            "kind": "know",
            "note": "The King's Granary feeds the palace; its yard backs onto the granary lane, and the watch keeps a house on the corner."
          }
        ]
      }
    },
    {
      "turn": 1,
      "speaker": "player:1",
      "kind": "player",
      "name": "Pell Marrow",
      "text": "Boy! Stop that. Show some respect for the dead."
    },
    {
      "turn": 1,
      "speaker": "gm",
      "kind": "narration",
      "text": "The boy freezes mid-throw. Then, very deliberately, he lobs one more.\n\n“He's not bothered.” He wipes his nose on his sleeve. “And you're not my da.”\n\nFrom somewhere along the lane, a voice: “Leave the lad alone!”\n\nOn the wall, the girl in the shawl snorts. “Leave him be. He don't talk to the watch's friends.”",
      "markup": {
        "speech": [
          {
            "start": 71,
            "end": 91,
            "tag": "the boy in the too-big boots",
            "speaker": "cob"
          },
          {
            "start": 125,
            "end": 148,
            "tag": "the boy in the too-big boots",
            "speaker": "cob"
          },
          {
            "start": 190,
            "end": 212
          },
          {
            "start": 257,
            "end": 310,
            "tag": "the girl in the shawl",
            "speaker": "moll"
          }
        ],
        "marks": [
          {
            "start": 272,
            "end": 308,
            "kind": "why",
            "note": "You came in with Sergeant Kell, and on the granary lane the watch takes a good coat's word over a granary kid's every time.",
            "link": {
              "kind": "person",
              "id": "kell"
            },
            "card": {
              "title": "Sergeant Agnes Kell",
              "lines": [
                "A sergeant of the Caerwyn city watch, out of the watch house by the granary quarter.",
                "You met them in this scene.",
                "Last said to you (turn 0): “Investigator.”"
              ]
            }
          }
        ]
      }
    },
    {
      "turn": 2,
      "speaker": "player:1",
      "kind": "player",
      "name": "Pell Marrow",
      "text": "*I put my hands up* I'm not the watch. I just want to know who found him."
    },
    {
      "turn": 2,
      "speaker": "gm",
      "kind": "narration",
      "text": "Kell's pencil stops. “You told the boy to show respect, and now you're asking him for help. He'll have noticed.”\n\nThe boy looks at your hands, then at hers, and says nothing at all.",
      "markup": {
        "speech": [
          {
            "start": 21,
            "end": 112,
            "tag": "Kell",
            "speaker": "kell"
          }
        ],
        "marks": [
          {
            "start": 64,
            "end": 90,
            "kind": "you",
            "note": "You barked at him to stop throwing stones a minute ago.",
            "link": {
              "kind": "deed",
              "scene": "hanged-clerk",
              "turn": 1
            },
            "card": {
              "title": "What you did",
              "lines": [
                "In this scene, turn 1:",
                "“Boy! Stop that. Show some respect for the dead.”"
              ]
            }
          }
        ]
      }
    }
  ],
  "phase": "done",
  "turn": 2,
  "mayType": true,
  "over": false,
  "suggestions": [],
  "suggestionsComing": false,
  "suggestionsOn": true,
  "notesComing": false
};

/**
 * The yard as the rows the client would hold for it, Pell Marrow's (player 1, who has the lead),
 * with Tamsin Vell (player 2) watching: rows.ts makes YARD of them. Fresh each call, to change.
 */
export function yardRows(): SceneRows {
  const cast = YARD.present.map((p, i) => ({ ...p, entityId: BigInt(20 + i) }));
  const turns = [...new Set(YARD.entries.map(e => e.turn))];
  return {
    me: 1n,
    game: { id: BigInt(YARD.game), time: YARD.time!.toLowerCase() },
    scene: { id: 7n, title: YARD.title, hook: YARD.hook!, status: "live", controllerId: 1n, turnId: undefined, turns: turns.length - 1 },
    players: [{ id: 1n, name: YARD.player.name, suggestions: true }, { id: 2n, name: "Tamsin Vell", suggestions: true }],
    sheets: [{ playerId: 1n, statusLine: YARD.player.status! }],
    transcript: YARD.entries.map((e, i) => ({ seq: i + 1, turn: e.turn, speaker: e.speaker, kind: e.kind, text: e.text, markup: e.markup ? JSON.stringify(e.markup) : undefined })),
    drafts: [],
    turns: turns.map(n => ({ id: BigInt(100 + n), n, phase: "done", note: undefined, error: undefined, notes: "written", suggest: "landed" })),
    onStage: [{ entityId: 10n, role: "controller" }, ...cast.map(c => ({ entityId: c.entityId, role: "cast" }))],
    names: cast.map(c => ({ entityId: c.entityId, key: c.key, name: c.name })),
    looks: cast.flatMap(c => (c.color ? [{ entityId: c.entityId, fg: c.color }] : [])),
    suggestions: [],
  };
}

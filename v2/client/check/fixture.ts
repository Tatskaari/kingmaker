// Data dumped once from the prototype's src/app/smoke/marks-demo.tsx:27-53 (markedYard) at 44c6d4a, with the people by the names the player knows.
import type { SceneView } from "../scene/view.ts";

/**
 * The granary yard a few turns in, as the rows would give it: the replies with their markup (who
 * says each line, and the notes on their phrases), the people on stage by the names the player
 * knows, in their looks' colours. Data copied from the prototype's marks demo (src/app/smoke/marks-demo.tsx).
 */
export const YARD: SceneView = {
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
            }
          }
        ]
      }
    }
  ],
  "phase": "done",
  "mayType": true,
  "over": false
};

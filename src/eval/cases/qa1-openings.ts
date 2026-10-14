import type { OpeningCase } from "../types.ts";

export const openingCases: OpeningCase[] = [
  {
    kind: "opening", id: "qa1-open-after-peaceful-bargain",
    about: "After a peaceful handover with Tam at Pell's elbow, scene 2 opened on fight debris and Tam emerging from hiding.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: no arrow was loosed and nobody fought. Tam stood beside Pell the whole time, handed over Grandmother Bone through Pell, and was last seen asking whether Pell can really build him the promised clockwork ox. Skrag left with the idol, saying the goblins' cookfire is at the burnt mill north of here and inviting Pell to trade there once the ox is made. Pell travels alone. A good opening picks up from exactly that moment: no fight debris, injuries or hiding place, Tam addressing one person, and his mood fitting a man who just gave up the idol he meant to sell for an ox. It ends on something the player can respond to.",
    approaches: ["gm", "actors"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "opening", id: "qa1-open-after-bargain-tam-gone",
    about: "After Maren handed the idol to Skrag (Tam already gone home), scene 2 put the idol back in the barley ring and Tam in the ditch.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: Maren placed Grandmother Bone in Skrag's hands, the goblins left with it and no one fought (one warning arrow struck the milestone early on). Tam had already set off home down the drovers' track two exchanges earlier. Maren travels alone. A good opening starts from that state: the idol is gone with Skrag, and Tam is either absent or back for a reason the opening shows. No fight aftermath, no 'are you all hurt'. It ends on something the player can respond to.",
    approaches: ["gm", "gm-repair"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "opening", id: "qa1-open-after-fight-solo",
    about: "After the fight, scene 2 addressed a lone half-orc as a group and said Tam's hand held nothing, though he still had the idol.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: Brakka's peace poem failed and the goblins attacked; the fight was played out on the map and Brakka won. Brakka travels alone. Tam hid behind the milestone and still has Grandmother Bone in his smock (the goblins never got it); Brakka's cheese is still on the gibbet and his axe was left in the mud when he sat up to recite. A good opening picks up after the fight, addresses Brakka alone, keeps the idol with Tam, and ends on something the player can respond to.",
    approaches: ["actors", "gm"],
    tags: ["handoff", "consistency"],
  },
];

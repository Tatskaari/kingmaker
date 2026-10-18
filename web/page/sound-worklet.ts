// New: the sound engine on the browser's audio thread (docs/sound-design.md): an AudioWorklet processor that hands each of the page's messages to the engine (client/sound/engine.ts) and fills each block the browser asks for with its samples. The build bundles this as sound-worklet.js, which sound.ts loads once the player has pressed a key or clicked.
import { Engine, type SoundMessage } from "../../client/sound/engine.ts";

// The AudioWorklet's own scope (no TypeScript library has it): its rate, its processors, and a processor's port.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new (options?: { processorOptions?: Start }) => object): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** What the page starts it with: the volumes and the mood so far (they're there from its first block), and a seed (a test's). */
interface Start { messages?: SoundMessage[]; seed?: number }

class KingmakerSound extends AudioWorkletProcessor {
  private readonly engine: Engine;

  constructor(options?: { processorOptions?: Start }) {
    super();
    const start = options?.processorOptions ?? {};
    this.engine = new Engine(sampleRate, start.seed ?? Math.floor(Math.random() * 2 ** 31));
    for (const message of start.messages ?? []) this.engine.receive(message);
    this.port.onmessage = (event: MessageEvent) => {
      for (const message of event.data as SoundMessage[]) this.engine.receive(message);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    if (left) this.engine.render(left, out[1] ?? left);
    return true;
  }
}

registerProcessor("kingmaker-sound", KingmakerSound);

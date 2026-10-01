import { configureSync, getLogger, type LogLevel, type Sink } from "@logtape/logtape";

export function gameLogger(component: string) {
  return getLogger(["kingmaker", component]);
}

/** Entry points own destinations; shared game code only acquires loggers. */
export function configureGameLogging(sink: Sink, lowestLevel: LogLevel | "disabled" = "debug"): void {
  configureSync({
    sinks: { output: sink },
    loggers: [
      { category: ["kingmaker"], lowestLevel: lowestLevel === "disabled" ? null : lowestLevel, sinks: ["output"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["output"] },
    ],
  });
}

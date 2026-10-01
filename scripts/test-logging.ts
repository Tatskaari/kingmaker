import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getFileSink } from "@logtape/file";
import { getJsonLinesFormatter } from "@logtape/logtape";
import { configureGameLogging, gameLogger } from "../packages/observability/src/logging.js";

// Each test process owns a file: parallel test workers never share a buffer or fd.
const directory = resolve(process.env.KINGMAKER_LOG_DIR || "test-output/logs");
mkdirSync(directory, { recursive: true });
export const logPath = resolve(directory, `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.jsonl`);
configureGameLogging(getFileSink(logPath, { formatter: getJsonLinesFormatter(), bufferSize: 0 }));
gameLogger("tests").info("Test process started", { pid: process.pid, argv: process.argv });

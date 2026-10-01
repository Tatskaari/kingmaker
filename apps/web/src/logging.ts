import { getConfig, getConsoleSink } from "@logtape/logtape";
import { configureGameLogging } from "../../../packages/observability/src/logging.js";

// Preserve a test preload (or a previous hot-reload configuration).
if (!getConfig()) configureGameLogging(getConsoleSink({
  formatter: record => [
    `[${new Date(record.timestamp).toISOString()}] ${record.category.join(".")} ${record.level}:`,
    ...record.message,
    record.properties,
  ],
}));

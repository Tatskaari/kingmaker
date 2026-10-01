import { getConsoleSink } from "@logtape/logtape";
import { configureGameLogging } from "../../../packages/observability/src/logging.js";

configureGameLogging(getConsoleSink({
  formatter: record => [
    `[${new Date(record.timestamp).toISOString()}] ${record.category.join(".")} ${record.level}:`,
    ...record.message,
    record.properties,
  ],
}));

import { pino, type Logger } from "pino";
import type { Config } from "./config.ts";

export type { Logger };

/** Structured JSON logs. Anything that could carry a credential is redacted. */
export function createLogger(config: Pick<Config, "logLevel">): Logger {
  return pino({
    level: config.logLevel,
    base: { service: "resurface-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "*.token",
        "*.secret",
        "*.password",
        "*.apiKey",
      ],
      censor: "[redacted]",
    },
  });
}

/** A logger that discards everything (tests). */
export const silentLogger: Logger = pino({ level: "silent" });

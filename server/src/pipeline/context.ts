import type { AdapterRegistry } from "../adapters/registry.ts";
import type { Resolver } from "../adapters/ssrf.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Logger } from "../logger.ts";
import type { LlmClient } from "../providers/anthropic.ts";
import type { HikerClient } from "../providers/hikerapi.ts";
import type { YoutubeApiClient } from "../providers/youtubeApi.ts";
import type { PushSender } from "../push/expo.ts";
import type { ObjectStore } from "../storage/objectStore.ts";
import type { Classifier } from "./classify.ts";
import type { Health } from "./health.ts";
import type { Places } from "./places.ts";

/** Infrastructure every pipeline module depends on, injected rather than imported. */
export interface BaseDeps {
  db: Db;
  config: Config;
  log: Logger;
  fetch: typeof fetch;
  now: () => Date;
  storage: ObjectStore | null;
  resolveDns: Resolver;
}

/** BaseDeps plus the provider clients and adapter registry built on top of them. */
export interface PipelineContext extends BaseDeps {
  health: Health;
  hiker: HikerClient;
  youtube: YoutubeApiClient;
  llm: LlmClient;
  classifier: Classifier;
  places: Places;
  push: PushSender;
  registry: AdapterRegistry;
}

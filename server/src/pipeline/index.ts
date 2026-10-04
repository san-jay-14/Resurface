import { createRegistry } from "../adapters/registry.ts";
import { createHikerClient } from "../providers/hikerapi.ts";
import { createLlmClient } from "../providers/anthropic.ts";
import { createYoutubeApiClient } from "../providers/youtubeApi.ts";
import { createPushSender } from "../push/expo.ts";
import { createClassifier } from "./classify.ts";
import type { BaseDeps, PipelineContext } from "./context.ts";
import { createHealth } from "./health.ts";
import { createPlaces } from "./places.ts";

/** Composition root for everything the pipeline needs, built once from the base dependencies. */
export function createPipelineContext(base: BaseDeps): PipelineContext {
  const health = createHealth(base);
  const hiker = createHikerClient({ config: base.config, fetch: base.fetch, health });
  const youtube = createYoutubeApiClient({ config: base.config, fetch: base.fetch, health });
  const llm = createLlmClient({ config: base.config, fetch: base.fetch, health });
  const classifier = createClassifier({ llm, model: () => base.config.pipeline.classifierModel });
  const registry = createRegistry({
    fetch: base.fetch,
    resolveDns: base.resolveDns,
    hiker,
    igProviderOrder: base.config.providers.igProviderOrder,
    youtube,
  });
  const places = createPlaces({ config: base.config, fetch: base.fetch, health, now: base.now });
  const push = createPushSender({
    fetch: base.fetch,
    db: base.db,
    log: base.log,
    accessToken: base.config.providers.expoAccessToken,
  });
  return { ...base, health, hiker, youtube, llm, classifier, places, push, registry };
}

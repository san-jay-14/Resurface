import type { HikerClient } from "../providers/hikerapi.ts";
import type { YoutubeApiClient } from "../providers/youtubeApi.ts";
import { createInstagramAdapter } from "./instagram.ts";
import type { Resolver } from "./ssrf.ts";
import type { Platform, PlatformAdapter } from "./types.ts";
import { createWebAdapter } from "./web.ts";
import { createYoutubeAdapter } from "./youtube.ts";

/**
 * Ordered adapter list. pick(url) returns the first adapter whose match() is true. The web adapter
 * matches any http(s) URL and MUST stay last. Adding a platform = one adapter file + one line here.
 *
 * Rule: no `if (platform === ...)` outside adapters/. If the pipeline needs a platform difference,
 * add a field to `policy` or a method to the PlatformAdapter interface.
 */
export interface AdapterRegistry {
  readonly adapters: readonly PlatformAdapter[];
  pick(u: URL): PlatformAdapter | null;
  byId(id: string): PlatformAdapter;
}

export function createRegistry(deps: {
  fetch: typeof fetch;
  resolveDns: Resolver;
  hiker: HikerClient;
  youtube: YoutubeApiClient;
}): AdapterRegistry {
  const adapters: PlatformAdapter[] = [
    createInstagramAdapter({ fetch: deps.fetch, hiker: deps.hiker }),
    createYoutubeAdapter({ youtube: deps.youtube }),
    createWebAdapter({ fetch: deps.fetch, resolveDns: deps.resolveDns }), // keep last
  ];
  return {
    adapters,
    pick: (u) => adapters.find((a) => a.match(u)) ?? null,
    byId(id) {
      const a = adapters.find((x) => x.id === (id as Platform));
      if (!a) throw new Error(`no adapter for platform "${id}"`);
      return a;
    },
  };
}

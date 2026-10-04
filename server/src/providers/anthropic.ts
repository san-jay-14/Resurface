import { ProviderError } from "../adapters/types.ts";
import type { Config } from "../config.ts";
import type { Health } from "../pipeline/health.ts";

/**
 * The single place that talks to the Anthropic Messages API. Every caller (classifier, rule parser,
 * Wrapped, push copy) shares one provider budget, circuit breaker and telemetry via callProvider.
 */
export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/webp";
        data: string;
      };
    };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** For telemetry only. */
  platform?: string;
  contentId?: string;
}

export interface LlmClient {
  /** Returns the concatenated text of the model's reply. Throws ProviderError on failure. */
  complete(req: LlmRequest): Promise<string>;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createLlmClient(deps: {
  config: Config;
  fetch: typeof fetch;
  health: Health;
}): LlmClient {
  const { config, health } = deps;
  return {
    async complete(req) {
      const key = config.providers.anthropicKey;
      if (!key) throw new ProviderError("auth", undefined, 401, "ANTHROPIC_API_KEY not configured");
      return health.callProvider<string>(
        {
          provider: "anthropic",
          endpoint: "messages",
          ...(req.platform ? { platform: req.platform } : {}),
          ...(req.contentId ? { contentId: req.contentId } : {}),
        },
        async () => {
          const resp = await deps.fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: req.model,
              max_tokens: req.maxTokens,
              ...(req.system ? { system: req.system } : {}),
              messages: req.messages,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (resp.status === 401 || resp.status === 403)
            throw new ProviderError("auth", undefined, resp.status);
          if (resp.status === 402) throw new ProviderError("budget", undefined, resp.status);
          if (resp.status === 429 || resp.status === 529) {
            const ra = Number(resp.headers.get("retry-after"));
            throw new ProviderError(
              "rate_limited",
              Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
              resp.status,
            );
          }
          if (!resp.ok) throw new ProviderError("upstream", undefined, resp.status);
          const body = (await resp.json()) as AnthropicResponse;
          const text =
            body.content
              ?.filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("") ?? "";
          const cost =
            ((body.usage?.input_tokens ?? 0) * config.pipeline.anthropicInPerMTok +
              (body.usage?.output_tokens ?? 0) * config.pipeline.anthropicOutPerMTok) /
            1e6;
          return { status: resp.status, value: text, cost };
        },
      );
    },
  };
}

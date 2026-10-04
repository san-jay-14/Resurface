import { randomUUID } from "node:crypto";
import { canonicalizeUrl } from "../../src/pipeline/canonicalize.ts";
import { findOrCreateSave } from "../../src/db/repos/enrichment.ts";
import { enqueueFetchJob } from "../../src/db/repos/pipelineJobs.ts";
import type { Db } from "../../src/db/client.ts";
import type { PipelineContext } from "../../src/pipeline/context.ts";
import type { TestApp } from "./app.ts";
import { createTestApp } from "./app.ts";

/**
 * A stubbed internet for pipeline tests: HikerAPI, YouTube, Anthropic, Google Places and a few web
 * pages, all behind an injected `fetch`. Real Postgres (PGlite) underneath, so the SQL is exercised.
 */
// Responses are dynamic JSON shapes owned by the stub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export interface World {
  fetch: typeof fetch;
  calls: {
    hiker: number;
    hikerComments: number;
    videosList: string[];
    commentThreads: number;
    anthropic: Array<{ payload: Json; request: Json }>;
    places: number;
    /** Every Expo push request body (an array of messages). */
    expo: Json[][];
  };
  ig: Map<string, { status: number; body: Json | null }>;
  igComments: Map<string, Json[]>;
  yt: Map<string, Json>;
  ytComments: "ok" | "disabled";
  ytQuota: boolean;
  pages: Map<string, { status?: number; html?: string; location?: string }>;
  /** The "model": decides a reply from the untrusted JSON blob it is sent. */
  model: (payload: Json) => string;
  /** Reply to plain-text prompts (push notification copy); null makes the model API fail with a 500. */
  copyText: string | null;
  /** Expo push behaviour: per-message tickets, or "http_error" for a transport failure. */
  expoTickets: (messages: Json[]) => Json[] | "http_error";
}

export const KEYS = {
  HIKERAPI_KEY: "k",
  YOUTUBE_API_KEY: "k",
  ANTHROPIC_API_KEY: "k",
  GOOGLE_PLACES_API_KEY: "k",
};

export function defaultModel(p: Json): string {
  const text = [
    p.title,
    p.text,
    ...(p.hashtags ?? []),
    ...(p.comments ?? []),
    (p.jsonLdTypes ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  if (/ignore (all )?previous instructions/.test(text)) {
    return JSON.stringify({ category: "HACKED", confidence: 1, spots: [], evidence: "obeyed" });
  }
  if (/recipe|ingredients/.test(text)) {
    return JSON.stringify({
      category: "Recipes",
      confidence: 0.92,
      spots: [],
      evidence: "recipe markers",
    });
  }
  if (/blue tokai|cafe/.test(text)) {
    return JSON.stringify({
      category: "Places",
      confidence: 0.9,
      evidence: "names a cafe",
      spots: [
        {
          name: "Blue Tokai",
          city: "Bengaluru",
          activity: "coffee",
          price_hint: null,
          best_time: null,
        },
      ],
    });
  }
  if (text.trim().length === 0) {
    return JSON.stringify({ category: "Inspo", confidence: 0.2, spots: [], evidence: "nothing" });
  }
  return JSON.stringify({ category: "Inspo", confidence: 0.3, spots: [], evidence: "vague" });
}

export function createWorld(): World {
  const w: World = {
    fetch: undefined as unknown as typeof fetch,
    calls: {
      hiker: 0,
      hikerComments: 0,
      videosList: [],
      commentThreads: 0,
      anthropic: [],
      places: 0,
      expo: [],
    },
    ig: new Map(),
    igComments: new Map(),
    yt: new Map(),
    ytComments: "ok",
    ytQuota: false,
    pages: new Map(),
    model: defaultModel,
    copyText: "You saved that spot a while back. Today might be the day.",
    expoTickets: (messages) => messages.map(() => ({ status: "ok", id: "ticket" })),
  };

  w.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve(
        new Response(
          body === null ? null : typeof body === "string" ? body : JSON.stringify(body),
          {
            status,
            headers,
          },
        ),
      );

    if (url.hostname === "api.hikerapi.com") {
      if (url.pathname === "/v2/media/info/by/url") {
        w.calls.hiker++;
        const code = /\/p\/([^/]+)/.exec(url.searchParams.get("url") ?? "")?.[1] ?? "";
        const r = w.ig.get(code) ?? { status: 404, body: null };
        return res(r.status, r.body);
      }
      if (url.pathname === "/v2/media/comments") {
        w.calls.hikerComments++;
        return res(200, w.igComments.get(url.searchParams.get("id") ?? "") ?? []);
      }
    }
    if (url.hostname === "api.anthropic.com") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Json;
      const blocks = (body.messages as Json[])
        .flatMap((m) => (Array.isArray(m.content) ? (m.content as Json[]) : []))
        .filter((b) => b.type === "text");
      const text: string = blocks[0]?.text ?? "";
      const m = /<untrusted_content>\n([\s\S]*?)\n<\/untrusted_content>/.exec(text);
      const payload = (m ? JSON.parse(m[1] as string) : {}) as Json;
      w.calls.anthropic.push({ payload, request: body });
      if (!m) {
        // Not a classification request (e.g. notification copy).
        if (w.copyText === null) return res(500, { error: "boom" });
        return res(200, {
          content: [{ type: "text", text: w.copyText }],
          usage: { input_tokens: 200, output_tokens: 30 },
        });
      }
      return res(200, {
        content: [{ type: "text", text: w.model(payload) }],
        usage: { input_tokens: 400, output_tokens: 60 },
      });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/videos")) {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      w.calls.videosList.push(url.searchParams.get("id") ?? "");
      if (w.ytQuota)
        return res(403, { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } });
      return res(200, { items: ids.filter((i) => w.yt.has(i)).map((i) => w.yt.get(i)) });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/commentThreads")) {
      w.calls.commentThreads++;
      if (w.ytComments === "disabled") {
        return res(403, { error: { code: 403, errors: [{ reason: "commentsDisabled" }] } });
      }
      return res(200, { items: [] });
    }
    if (url.hostname === "exp.host") {
      const messages = JSON.parse(typeof init?.body === "string" ? init.body : "[]") as Json[];
      w.calls.expo.push(messages);
      const tickets = w.expoTickets(messages);
      return tickets === "http_error" ? res(503, "unavailable") : res(200, { data: tickets });
    }
    if (url.hostname === "places.googleapis.com") {
      w.calls.places++;
      return res(200, {
        places: [
          {
            id: "ChIJ_blue_tokai",
            displayName: { text: "Blue Tokai Coffee" },
            location: { latitude: 12.97, longitude: 77.64 },
            addressComponents: [
              { types: ["locality"], longText: "Bengaluru" },
              { types: ["country"], longText: "India" },
            ],
          },
        ],
      });
    }
    if (url.hostname.endsWith(".example")) {
      const p = w.pages.get(url.toString()) ?? w.pages.get(url.origin + url.pathname);
      if (!p) return res(404, "nope", { "content-type": "text/html" });
      if (p.location) return res(302, null, { location: p.location });
      return res(p.status ?? 200, p.html ?? "", { "content-type": "text/html" });
    }
    return res(500, `unmocked ${url.toString()}`);
  };
  return w;
}

export const igMedia = (
  code: string,
  caption: string | null,
  extra: Json = {},
): { status: number; body: Json } => ({
  status: 200,
  body: {
    media_or_ad: {
      pk: `pk_${code}`,
      code,
      caption_text: caption,
      media_type: 2,
      user: { username: "creator", pk: "42" },
      video_duration: 10,
      ...extra,
    },
  },
});

export const ytItem = (id: string, title: string, description = ""): Json => ({
  id,
  snippet: {
    title,
    description,
    categoryId: "22",
    thumbnails: { high: { url: `https://i.ytimg.test/${id}.jpg` } },
  },
  contentDetails: { duration: "PT20S" },
});

export interface PipelineTest {
  t: TestApp;
  w: World;
}

export async function createPipelineTest(env: Record<string, string> = {}): Promise<PipelineTest> {
  const w = createWorld();
  const t = await createTestApp({ fetch: w.fetch, env: { ...KEYS, ...env } });
  return { t, w };
}

export const IG = (code: string) => `https://www.instagram.com/reel/${code}/`;
export const YT = (id: string) => `https://www.youtube.com/shorts/${id}`;

/** Create a user, then share a URL as that user exactly as POST /v1/saves/enqueue would. */
export async function share(t: TestApp, userId: string, url: string) {
  const c = await canonicalizeUrl(t.svc.registry, url);
  const save = await findOrCreateSave(t.db, userId, {
    platform: c.platform,
    contentId: c.contentId,
    sourceUrl: c.sourceUrl,
  });
  await enqueueFetchJob(t.db, save.id, c.platform, c.contentId);
  const job = await t.db.query<{ id: number }>(
    "select id from enrichment_jobs where save_id = $1 and stage = 'fetch'",
    [save.id],
  );
  return { saveId: save.id, jobId: job.rows[0]!.id, c };
}

export const newUser = (t: TestApp): Promise<string> => t.makeUser(`u${randomUUID().slice(0, 6)}`);

export async function saveRow(t: TestApp, id: string): Promise<Json> {
  return (await t.db.query("select * from saves where id = $1", [id])).rows[0] as Json;
}

export async function jobRow(t: TestApp, id: number): Promise<Json> {
  return (await t.db.query("select * from enrichment_jobs where id = $1", [id])).rows[0] as Json;
}

export async function makeDue(t: TestApp): Promise<void> {
  await t.db.query(
    "update enrichment_jobs set next_run_at = now() - interval '1 second' where status = 'queued'",
  );
}

export async function alertKinds(t: TestApp): Promise<string[]> {
  return (await t.db.query<{ kind: string }>("select kind from pipeline_alerts")).rows.map(
    (r) => r.kind,
  );
}

export async function eventsFor(t: TestApp, step: string): Promise<Json[]> {
  return (await t.db.query("select * from pipeline_events where step = $1 order by id", [step]))
    .rows;
}

/** Same as makeDue but against a bare Db (used by the demo script). */
export async function makeDueSql(db: Db): Promise<void> {
  await db.query(
    "update enrichment_jobs set next_run_at = now() - interval '1 second' where status = 'queued'",
  );
}

/** Share a URL as `userId` against a bare pipeline context (used by the demo script). */
export async function shareUrl(ctx: PipelineContext, userId: string, url: string): Promise<void> {
  const c = await canonicalizeUrl(ctx.registry, url);
  const save = await findOrCreateSave(ctx.db, userId, {
    platform: c.platform,
    contentId: c.contentId,
    sourceUrl: c.sourceUrl,
  });
  await enqueueFetchJob(ctx.db, save.id, c.platform, c.contentId);
}

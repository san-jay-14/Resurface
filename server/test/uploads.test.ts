import { afterEach, describe, expect, it } from "vitest";
import { detectImage } from "../src/storage/images.ts";
import { createR2Store } from "../src/storage/objectStore.ts";
import { type Json, type TestApp, createTestApp } from "./helpers/app.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const file = (bytes: Uint8Array, name = "x.jpg", type = "image/jpeg") =>
  new File([Buffer.from(bytes)], name, { type });

describe("image sniffing", () => {
  it("decides the type from magic bytes, never from the declared name or MIME", () => {
    expect(detectImage(JPEG)).toEqual({ contentType: "image/jpeg", ext: "jpg" });
    expect(detectImage(PNG)).toEqual({ contentType: "image/png", ext: "png" });
    expect(detectImage(WEBP)).toEqual({ contentType: "image/webp", ext: "webp" });
    expect(detectImage(HTML)).toBeNull();
    expect(detectImage(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImage(new Uint8Array([0xff, 0xd8]))).toBeNull(); // truncated
    expect(detectImage(new Uint8Array())).toBeNull();
  });
});

describe("uploads", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.db.close();
  });

  const post = (userId: string | null, path: string, body: FormData) =>
    t.app.request(path, {
      method: "POST",
      headers: userId ? { "x-test-user": userId } : {},
      body,
    });
  const json = async (res: Response) => ({
    status: res.status,
    json: (await res.json().catch(() => null)) as Json,
  });

  describe("avatar", () => {
    it("stores a validated image under the user's prefix and points the profile at it", async () => {
      t = await createTestApp();
      const u = await t.makeUser("av");
      const fd = new FormData();
      fd.set("file", file(JPEG));
      const r = await json(await post(u, "/v1/me/avatar", fd));
      expect(r.status).toBe(200);
      expect(r.json.avatar_url).toMatch(
        new RegExp(`^https://cdn.test/avatars/${u}/[0-9a-f-]{36}\\.jpg$`),
      );
      const profile = await t.call(u, "GET", "/v1/me");
      expect(profile.json.profile.avatar_url).toBe(r.json.avatar_url);
      const stored = [...t.store.objects.entries()].filter(([k]) => k.startsWith(`avatars/${u}/`));
      expect(stored).toHaveLength(1);
      expect(stored[0]![1].contentType).toBe("image/jpeg");
    });

    it("replaces the previous avatar and removes the old object", async () => {
      t = await createTestApp();
      const u = await t.makeUser("av2");
      const send = async (bytes: Uint8Array) => {
        const fd = new FormData();
        fd.set("file", file(bytes));
        return json(await post(u, "/v1/me/avatar", fd));
      };
      const first = await send(JPEG);
      const second = await send(PNG);
      expect(second.json.avatar_url).not.toBe(first.json.avatar_url);
      const keys = [...t.store.objects.keys()].filter((k) => k.startsWith(`avatars/${u}/`));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/\.png$/);
    });

    it("rejects non-images (even when named .jpg), oversized files, and missing files", async () => {
      t = await createTestApp();
      const u = await t.makeUser("av3");
      const disguised = new FormData();
      disguised.set("file", file(HTML, "evil.jpg", "image/jpeg"));
      expect((await post(u, "/v1/me/avatar", disguised)).status).toBe(415);

      const big = new FormData();
      big.set(
        "file",
        file(
          new Uint8Array(5 * 1024 * 1024 + 1)
            .fill(0xff)
            .map((v, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : v)),
        ),
      );
      expect((await post(u, "/v1/me/avatar", big)).status).toBe(413);

      expect((await post(u, "/v1/me/avatar", new FormData())).status).toBe(400);
      const notMultipart = await t.app.request("/v1/me/avatar", {
        method: "POST",
        headers: { "x-test-user": u, "content-type": "application/json" },
        body: "{}",
      });
      expect(notMultipart.status).toBe(400);
      expect(t.store.objects.size).toBe(0);
    });

    it("requires authentication, reports 503 without storage, and can be removed", async () => {
      t = await createTestApp();
      const fd = new FormData();
      fd.set("file", file(JPEG));
      expect((await post(null, "/v1/me/avatar", fd)).status).toBe(401);
      const u = await t.makeUser("av4");
      await post(u, "/v1/me/avatar", fd);
      expect((await t.call(u, "DELETE", "/v1/me/avatar")).status).toBe(204);
      expect((await t.call(u, "GET", "/v1/me")).json.profile.avatar_url).toBeNull();
      expect(t.store.objects.size).toBe(0);
      await t.db.close();

      t = await createTestApp({ storage: null });
      const v = await t.makeUser("av5");
      const again = new FormData();
      again.set("file", file(JPEG));
      expect((await post(v, "/v1/me/avatar", again)).status).toBe(503);
    });
  });

  describe("bug reports", () => {
    it("stores a message with up to 4 validated attachments under a private per-user prefix", async () => {
      t = await createTestApp();
      const u = await t.makeUser("bg");
      const fd = new FormData();
      fd.set("message", "The map crashes when I rotate");
      fd.append("attachments", file(JPEG));
      fd.append("attachments", file(PNG, "s.png", "image/png"));
      const r = await json(await post(u, "/v1/bug-reports", fd));
      expect(r.status).toBe(201);
      const row = (
        await t.db.query<{ message: string; attachments: string[]; user_id: string }>(
          "select message, attachments, user_id from bug_reports where id = $1",
          [r.json.id],
        )
      ).rows[0]!;
      expect(row.user_id).toBe(u);
      expect(row.attachments).toHaveLength(2);
      for (const k of row.attachments) {
        expect(k).toMatch(new RegExp(`^bug-reports/${u}/[0-9a-f-]{36}\\.(jpg|png)$`));
        expect(t.store.objects.has(k)).toBe(true);
      }
    });

    it("works without attachments, even with no object storage configured", async () => {
      t = await createTestApp({ storage: null });
      const u = await t.makeUser("bg2");
      const fd = new FormData();
      fd.set("message", "Typo on the settings screen");
      expect((await post(u, "/v1/bug-reports", fd)).status).toBe(201);
      const withFile = new FormData();
      withFile.set("message", "see screenshot");
      withFile.append("attachments", file(JPEG));
      expect((await post(u, "/v1/bug-reports", withFile)).status).toBe(503);
    });

    it("validates the message, the attachment count and each attachment", async () => {
      t = await createTestApp();
      const u = await t.makeUser("bg3");
      const empty = new FormData();
      expect((await post(u, "/v1/bug-reports", empty)).status).toBe(400);
      const blank = new FormData();
      blank.set("message", "   ");
      expect((await post(u, "/v1/bug-reports", blank)).status).toBe(400);
      const long = new FormData();
      long.set("message", "x".repeat(4001));
      expect((await post(u, "/v1/bug-reports", long)).status).toBe(400);

      const five = new FormData();
      five.set("message", "too many");
      for (let i = 0; i < 5; i++) five.append("attachments", file(JPEG));
      expect((await post(u, "/v1/bug-reports", five)).status).toBe(400);

      const bad = new FormData();
      bad.set("message", "has a script");
      bad.append("attachments", file(HTML, "a.png", "image/png"));
      expect((await post(u, "/v1/bug-reports", bad)).status).toBe(415);
      expect((await t.db.query("select 1 from bug_reports")).rowCount).toBe(0);
      expect(t.store.objects.size).toBe(0); // a rejected report leaves nothing behind
    });

    it("is rate limited per user", async () => {
      t = await createTestApp();
      const u = await t.makeUser("bg4");
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const fd = new FormData();
        fd.set("message", `report ${i}`);
        statuses.push((await post(u, "/v1/bug-reports", fd)).status);
      }
      expect(statuses.filter((s) => s === 429).length).toBe(2);
    });
  });
});

describe("R2 object store client", () => {
  const cfg = {
    accountId: "acct",
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    bucket: "bkt",
    publicBaseUrl: "https://cdn.example.com",
  };
  const recorder = (respond: (req: Request) => Response | Promise<Response>) => {
    const seen: Request[] = [];
    const fetcher = ((input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      seen.push(req);
      return Promise.resolve(respond(req));
    }) as typeof fetch;
    return { seen, store: createR2Store(cfg, fetcher) };
  };

  it("PUTs signed requests to the account endpoint with content headers", async () => {
    const { seen, store } = recorder(() => new Response(null, { status: 200 }));
    await store.put("avatars/u1/a b.png", new Uint8Array([1, 2, 3]), "image/png", {
      cacheControl: "public, max-age=1",
    });
    const req = seen[0]!;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://acct.r2.cloudflarestorage.com/bkt/avatars/u1/a%20b.png");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(req.headers.get("cache-control")).toBe("public, max-age=1");
    expect(store.publicUrl("avatars/u1/a b.png")).toBe(
      "https://cdn.example.com/avatars/u1/a%20b.png",
    );
  });

  it("surfaces upstream failures and treats a missing object as already deleted", async () => {
    const failing = recorder(() => new Response("nope", { status: 500 }));
    await expect(failing.store.put("k", new Uint8Array([1]), "image/png")).rejects.toThrow(
      /R2 put failed: 500/,
    );
    const missing = recorder(() => new Response(null, { status: 404 }));
    await expect(missing.store.delete("k")).resolves.toBeUndefined();
    const broken = recorder(() => new Response(null, { status: 403 }));
    await expect(broken.store.delete("k")).rejects.toThrow(/R2 delete failed: 403/);
  });

  it("lists with pagination and deletes a prefix, sparing the excepted key", async () => {
    const deleted: string[] = [];
    const { store } = recorder((req) => {
      const url = new URL(req.url);
      if (req.method === "GET") {
        return new Response(
          url.searchParams.get("continuation-token")
            ? "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>p/c.png</Key></Contents></ListBucketResult>"
            : "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken><Contents><Key>p/a.png</Key></Contents><Contents><Key>p/b&amp;b.png</Key></Contents></ListBucketResult>",
          { status: 200 },
        );
      }
      deleted.push(decodeURIComponent(url.pathname.replace("/bkt/", "")));
      return new Response(null, { status: 204 });
    });
    expect(await store.deletePrefix("p/", { except: "p/b&b.png" })).toBe(2);
    expect(deleted).toEqual(["p/a.png", "p/c.png"]);
  });
});

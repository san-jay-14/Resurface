import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, verifyShareToken } from "../src/db/repos/shareTokens.ts";
import { createTestApp, type TestApp } from "./helpers/app.ts";

describe("/v1/me", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  it("seeds the profile avatar from the identity provider's image", async () => {
    const id = await t.makeUser("img");
    await t.db.query(`update "user" set image = 'https://img.test/a.png' where id = $1`, [id]);
    await t.db.query("delete from users where id = $1", [id]);
    const r = await t.call(id, "GET", "/v1/me");
    expect(r.json.profile.avatar_url).toBe("https://img.test/a.png");
  });

  it("returns the caller's profile and self-heals a missing one", async () => {
    const id = await t.makeUser("heal");
    await t.db.query("delete from users where id = $1", [id]);
    const r = await t.call(id, "GET", "/v1/me");
    expect(r.status).toBe(200);
    expect(r.json.profile.id).toBe(id);
    expect(r.json.profile.notification_prefs.frequency).toBe("normal");
  });

  it("updates whitelisted fields and stamps current_city_updated_at", async () => {
    const id = await t.makeUser("patch");
    const r = await t.call(id, "PATCH", "/v1/me", {
      name: "Asha",
      birthday: "1994-05-17",
      home_city: "Bengaluru",
      home_city_lat: 12.97,
      home_city_lng: 77.59,
      current_city: "Goa",
      onboarding_completed: true,
    });
    expect(r.status).toBe(200);
    expect(r.json.profile).toMatchObject({
      name: "Asha",
      birthday: "1994-05-17",
      home_city: "Bengaluru",
      onboarding_completed: true,
    });
    expect(r.json.profile.current_city_updated_at).toBeTruthy();
  });

  it.each([
    ["server-owned avatar_url", { avatar_url: "https://evil.test/x.png" }],
    ["unknown field", { is_admin: true }],
    ["bad date", { birthday: "17/05/1994" }],
    ["latitude out of range", { home_city_lat: 120 }],
    ["bad prefs", { notification_prefs: { new_city: true } }],
  ])("rejects %s", async (_label, body) => {
    const id = await t.makeUser("bad");
    const r = await t.call(id, "PATCH", "/v1/me", body);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("validation_failed");
  });

  it("cannot touch another user's profile: PATCH only ever affects the caller", async () => {
    const a = await t.makeUser("a");
    const b = await t.makeUser("b");
    await t.call(a, "PATCH", "/v1/me", { name: "Alice" });
    const other = await t.call(b, "GET", "/v1/me");
    expect(other.json.profile.name).not.toBe("Alice");
  });

  it("deletes the account, its data and stored objects, leaving others intact", async () => {
    const a = await t.makeUser("del-a");
    const b = await t.makeUser("del-b");
    await t.db.query("insert into saves (user_id, source_platform) values ($1,'web'), ($2,'web')", [
      a,
      b,
    ]);
    await t.store.put(`avatars/${a}/avatar.png`, new Uint8Array([1]), "image/png");
    await t.store.put(`avatars/${b}/avatar.png`, new Uint8Array([1]), "image/png");

    expect((await t.call(a, "DELETE", "/v1/me")).status).toBe(204);

    const left = await t.db.query<{ user_id: string }>(
      "select user_id from saves where user_id in ($1,$2)",
      [a, b],
    );
    expect(left.rows.map((r) => r.user_id)).toEqual([b]);
    expect(t.store.objects.has(`avatars/${a}/avatar.png`)).toBe(false);
    expect(t.store.objects.has(`avatars/${b}/avatar.png`)).toBe(true);
    expect((await t.call(a, "GET", "/v1/me")).status).toBe(401);
  });
});

describe("device tokens and notifications", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  it("registers, moves and removes an Expo push token", async () => {
    const a = await t.makeUser("pa");
    const b = await t.makeUser("pb");
    const token = "ExponentPushToken[abc123]";
    expect(
      (await t.call(a, "PUT", "/v1/device-tokens", { token, platform: "android" })).status,
    ).toBe(204);
    expect(
      (await t.call(b, "PUT", "/v1/device-tokens", { token, platform: "android" })).status,
    ).toBe(204);
    const owner = await t.db.query<{ user_id: string }>(
      "select user_id from device_tokens where expo_push_token = $1",
      [token],
    );
    expect(owner.rows).toEqual([{ user_id: b }]);
    // a cannot delete b's registration
    await t.call(a, "DELETE", "/v1/device-tokens", { token });
    expect(
      (await t.db.query("select 1 from device_tokens where expo_push_token = $1", [token]))
        .rowCount,
    ).toBe(1);
    await t.call(b, "DELETE", "/v1/device-tokens", { token });
    expect(
      (await t.db.query("select 1 from device_tokens where expo_push_token = $1", [token]))
        .rowCount,
    ).toBe(0);
  });

  it("rejects malformed push tokens", async () => {
    const a = await t.makeUser("pt");
    expect((await t.call(a, "PUT", "/v1/device-tokens", { token: "not-a-token" })).status).toBe(
      400,
    );
  });

  it("marks only the caller's own notification as tapped", async () => {
    const a = await t.makeUser("na");
    const b = await t.makeUser("nb");
    const log = await t.db.query<{ id: string }>(
      "insert into notification_log (user_id, trigger_type) values ($1, 'birthday') returning id",
      [a],
    );
    const id = log.rows[0]!.id;
    expect((await t.call(b, "POST", `/v1/notifications/${id}/tapped`)).status).toBe(404);
    expect((await t.call(a, "POST", `/v1/notifications/${id}/tapped`)).status).toBe(204);
    const row = await t.db.query<{ tapped: boolean }>(
      "select tapped from notification_log where id = $1",
      [id],
    );
    expect(row.rows[0]?.tapped).toBe(true);
  });
});

describe("share tokens", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.db.close();
  });

  it("mints a token once, stores only its hash, verifies and revokes it", async () => {
    const a = await t.makeUser("st");
    const r = await t.call(a, "POST", "/v1/share-token", { label: "pixel" });
    expect(r.status).toBe(201);
    const token = r.json.token as string;
    expect(token).toMatch(/^dst_/);

    const stored = await t.db.query<{ token_hash: string }>(
      "select token_hash from share_tokens where user_id = $1",
      [a],
    );
    expect(stored.rows[0]?.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    expect(await verifyShareToken(t.db, token)).toBe(a);
    expect(await verifyShareToken(t.db, "dst_wrong")).toBeNull();

    expect((await t.call(a, "DELETE", "/v1/share-token")).status).toBe(204);
    expect(await verifyShareToken(t.db, token)).toBeNull();
  });

  it("caps active tokens per user at 10 (oldest revoked)", async () => {
    const a = await t.makeUser("cap");
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++)
      tokens.push((await t.call(a, "POST", "/v1/share-token", {})).json.token as string);
    const active = await t.db.query(
      "select 1 from share_tokens where user_id = $1 and revoked_at is null",
      [a],
    );
    expect(active.rowCount).toBe(10);
    expect(await verifyShareToken(t.db, tokens[0]!)).toBeNull();
    expect(await verifyShareToken(t.db, tokens[11]!)).toBe(a);
  });

  it("a share token is NOT accepted as a general credential", async () => {
    const a = await t.makeUser("scope");
    const token = (await t.call(a, "POST", "/v1/share-token", {})).json.token as string;
    const r = await t.call(null, "GET", "/v1/me", undefined, {
      authorization: `ShareToken ${token}`,
    });
    expect(r.status).toBe(401);
  });
});

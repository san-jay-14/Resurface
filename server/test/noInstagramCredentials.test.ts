import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Principle 1 of the Instagram resolver: logged-out only. No code path may read, store or send
 * Instagram cookies or credentials, on the server or on the device. This is the CI grep check.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = [
  "server/src",
  "server/scripts",
  "plugins",
  "tasks",
  "lib",
  "app",
  "providers",
  "hooks",
];
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|kt|java|gradle)$/;

// Instagram session/credential identifiers and the login API. A bare "/accounts/login" is allowed:
// the device fetcher uses it to DETECT a login wall and give up.
const FORBIDDEN = [
  /sessionid/i,
  /ds_user_id/i,
  /csrftoken/i,
  /\big_did\b/i,
  /x-ig-app-id/i,
  /accounts\/login\/ajax/i,
  /instagram[^\n]{0,60}(password|cookie|session_?id)/i,
  /(IG|INSTAGRAM)_(PASSWORD|USERNAME|COOKIE|SESSION)/i,
  /CookieJar|CookieManager|CookieHandler/,
];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (n === "node_modules" || n === "build" || n === "dist") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(n)) out.push(p);
  }
  return out;
}

describe("no Instagram credentials anywhere", () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds no cookie, session or login-API identifiers", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) {
        const m = re.exec(text);
        if (m) hits.push(`${relative(ROOT, f)}: ${re} matched "${m[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the device fetcher sends no cookies or auth headers and spoofs nothing", () => {
    const f = files.find((p) => p.endsWith("DeviceMetaFetcher.kt"));
    expect(f, "DeviceMetaFetcher.kt should exist under plugins/").toBeTruthy();
    const text = readFileSync(f as string, "utf8");
    expect(text).not.toMatch(/cookie|authorization|bearer|user-agent|x-forwarded/i);
    expect(text).toMatch(/Accept-Language/);
  });
});

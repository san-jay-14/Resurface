#!/usr/bin/env node
// Phase 0 measurement spike: what does a LOGGED-OUT public Instagram post page expose today?
//
//   node scripts/ig-device-spike.mjs urls.txt [--out docs/ig-device-fetch-spike.md]
//
// urls.txt: ~30 real public Reel/Post URLs, one per line (# comments ok).
// Run it from a laptop tethered to a phone on MOBILE DATA, not from office wifi or a datacenter:
// the answer depends on the network. It makes exactly one plain GET per URL, sequentially, with the
// same identity as the Android fetcher (OkHttp's default User-Agent + Accept-Language). No cookies,
// no login, no evasion. Nothing here is used by the app: it only produces the report that decides
// whether the device-side fetch (plugins/kotlin/DeviceMetaFetcher.kt) is worth enabling.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : "docs/ig-device-fetch-spike.md";
if (!file) {
  console.error("usage: node scripts/ig-device-spike.mjs urls.txt [--out report.md]");
  process.exit(2);
}

const urls = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const META = /<meta\s[^>]*>/gi;
const ATTR = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const DESC =
  /^(?:[\d.,]+[KkMm]? likes?,\s*)?(?:[\d.,]+[KkMm]? comments?\s*)?-?\s*([A-Za-z0-9._]{1,30}) on [^:"]{3,40}:\s*"([\s\S]*?)"\.?\s*$/;

function decode(v) {
  return v
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function ogTags(html) {
  const og = {};
  for (const tag of html.matchAll(META)) {
    const attrs = {};
    for (const m of tag[0].matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2] || m[3] || "";
    const key = attrs.property ?? attrs.name;
    if (key?.startsWith("og:") && attrs.content !== undefined && !(key in og)) og[key] = decode(attrs.content);
  }
  return og;
}

async function probe(url) {
  const row = { url, status: null, loginWall: false, ogDescription: false, ogImage: false,
    ogTitle: false, location: false, caption: "none", error: "" };
  let target = url;
  try {
    for (let hop = 0; hop <= 2; hop++) {
      const res = await fetch(target, {
        redirect: "manual",
        headers: { "user-agent": "okhttp/4.12.0", "accept-language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(6000),
      });
      row.status = res.status;
      if (res.status === 429) { row.loginWall = true; row.error = "429"; await res.body?.cancel(); return row; }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        const next = new URL(loc, target);
        if (next.pathname.includes("/accounts/login")) { row.loginWall = true; return row; }
        target = next.toString();
        continue;
      }
      if (res.status !== 200) { await res.body?.cancel(); return row; }
      if (new URL(target).pathname.includes("/accounts/login")) { row.loginWall = true; return row; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2_000_000) { row.error = "body > 2MB"; return row; }
      const html = buf.toString("utf8");
      const og = ogTags(html);
      row.ogDescription = !!og["og:description"];
      row.ogImage = !!og["og:image"];
      row.ogTitle = !!og["og:title"];
      row.location = /\/explore\/locations\/|"location"\s*:\s*\{/.test(html);
      const m = DESC.exec((og["og:description"] ?? "").trim());
      if (m?.[2]) row.caption = /(…|\.\.\.)$/.test(m[2]) ? "truncated" : "full";
      return row;
    }
    row.error = "too many redirects";
  } catch (e) {
    row.error = e instanceof Error ? e.name : "error";
  }
  return row;
}

const rows = [];
for (const u of urls) {
  const r = await probe(u);
  rows.push(r);
  console.log(`${r.status ?? "---"} ${r.loginWall ? "WALL" : "    "} caption=${r.caption.padEnd(9)} ${u}`);
  await new Promise((r2) => setTimeout(r2, 1500)); // one request at a time, no hammering
}

const n = rows.length;
const pct = (k) => (n ? Math.round((100 * k) / n) : 0);
const usable = rows.filter((r) => r.caption !== "none").length;
const walls = rows.filter((r) => r.loginWall).length;
const verdict = n >= 30 && pct(usable) >= 40 ? "GO" : n < 30 ? "INCOMPLETE (need >= 30 URLs)" : "NO-GO";

const report = `# Instagram device-fetch spike (Phase 0)

- Date: ${new Date().toISOString().slice(0, 10)}
- Network: <!-- fill in: phone on mobile data via hotspot? carrier / country -->
- Client identity: OkHttp default User-Agent, Accept-Language only, no cookies (same as the Android fetcher)
- URLs probed: ${n}

## Results

| Metric | Count | % |
|---|---|---|
| HTTP 200 | ${rows.filter((r) => r.status === 200).length} | ${pct(rows.filter((r) => r.status === 200).length)}% |
| Login wall / 429 | ${walls} | ${pct(walls)}% |
| og:description present | ${rows.filter((r) => r.ogDescription).length} | ${pct(rows.filter((r) => r.ogDescription).length)}% |
| og:image present | ${rows.filter((r) => r.ogImage).length} | ${pct(rows.filter((r) => r.ogImage).length)}% |
| og:title present | ${rows.filter((r) => r.ogTitle).length} | ${pct(rows.filter((r) => r.ogTitle).length)}% |
| Location data visible | ${rows.filter((r) => r.location).length} | ${pct(rows.filter((r) => r.location).length)}% |
| Usable caption (full or truncated) | ${usable} | ${pct(usable)}% |
| of which full | ${rows.filter((r) => r.caption === "full").length} | ${pct(rows.filter((r) => r.caption === "full").length)}% |
| of which truncated | ${rows.filter((r) => r.caption === "truncated").length} | ${pct(rows.filter((r) => r.caption === "truncated").length)}% |

## Decision

**${verdict}**: rule is usable caption on >= 40% of >= 30 URLs.

- GO: build the Android app with \`IG_DEVICE_FETCH=true\` and watch the weekly metrics (spec section 7):
  keep it only if it removes >= 30% of provider calls.
- NO-GO: leave \`IG_DEVICE_FETCH\` unset (the default). Cache, provider chain and canary stand on their own.

## Per-URL

| URL | HTTP | Wall | Caption | og:image | Location | Note |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.url} | ${r.status ?? "-"} | ${r.loginWall ? "yes" : "no"} | ${r.caption} | ${r.ogImage ? "y" : "n"} | ${r.location ? "y" : "n"} | ${r.error} |`).join("\n")}
`;
writeFileSync(out, report);
console.log(`\nwrote ${out}: ${verdict} (${usable}/${n} usable captions, ${walls} walls)`);

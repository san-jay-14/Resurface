// Platform-blind comment filtering shared by every adapter that has comments.
// Keeps: creator replies, pinned comments, comments that read as answers to
// "where is this" / "name", and the top 10 by likes. Each trimmed to 200 chars.
// Drops: commenter handles (data minimisation), links and spam.

export interface RawComment {
  text: string;
  likes?: number;
  byCreator?: boolean;
  pinned?: boolean;
}

const SPAM =
  /(https?:\/\/|www\.|follow (me|back)|check (my )?(bio|profile)|dm (me|for)|promo|giveaway|crypto|earn \$|whatsapp|telegram|onlyfans)/i;
const ANSWERISH =
  /(📍|it'?s called|its called|called\b|located|address|price|menu|reservation|booking|\bat [A-Z][\w'&-]+|\bin [A-Z][\w'&-]+|where|name\??|which|link\??|location)/i;

export function stripHandles(s: string): string {
  return s
    .replace(/@[A-Za-z0-9._]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function filterComments(raw: RawComment[], max = 10, maxLen = 200): string[] {
  const cleaned = raw
    .map((c) => ({ ...c, text: stripHandles((c.text ?? "").replace(/\s+/g, " ")) }))
    .filter((c) => c.text.length >= 3 && !SPAM.test(c.text));

  const picked: typeof cleaned = [];
  const seen = new Set<string>();
  const add = (c: (typeof cleaned)[number]) => {
    const k = c.text.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      picked.push(c);
    }
  };

  cleaned.filter((c) => c.byCreator || c.pinned).forEach(add);
  cleaned.filter((c) => ANSWERISH.test(c.text)).forEach(add);
  [...cleaned]
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 10)
    .forEach(add);

  // Creator/pinned first, then by likes, capped.
  picked.sort((a, b) => {
    const pa = a.byCreator || a.pinned ? 1 : 0;
    const pb = b.byCreator || b.pinned ? 1 : 0;
    return pb - pa || (b.likes ?? 0) - (a.likes ?? 0);
  });
  return picked.slice(0, Math.max(max, 1) + 5).map((c) => c.text.slice(0, maxLen));
}

export function parseHashtags(...sources: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    for (const m of (s ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu)) out.add((m[1] ?? "").toLowerCase());
  }
  return [...out];
}

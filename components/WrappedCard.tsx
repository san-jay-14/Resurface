import { Dimensions, Text, View } from "react-native";

import type { SaveCategory, WrappedCopy, WrappedStats } from "@/lib/database.types";

const CARD_W = Math.min(Dimensions.get("window").width - 32, 358);
const CARD_H = Math.round(CARD_W * (16 / 9));

const CATEGORY_LABEL: Record<SaveCategory, string> = {
  places: "Places", recipes: "Recipes", fashion: "Fashion",
  shopping: "Shopping", watch_learn: "Watch", inspo: "Inspo", unsorted: "Unsorted",
};

const GRADIENT_PAIRS: [string, string][] = [
  ["#0F0F0F", "#1A0A2E"],
  ["#0A0F0A", "#0A2E1A"],
  ["#0F0A0A", "#2E0A1A"],
  ["#0A0A0F", "#0A1A2E"],
];

function pickGradient(seed: string): [string, string] {
  const idx = seed.charCodeAt(0) % GRADIENT_PAIRS.length;
  return GRADIENT_PAIRS[idx];
}

interface WrappedCardProps {
  copy: WrappedCopy;
  stats: WrappedStats;
  userId?: string;
}

export function WrappedCard({ copy, stats, userId = "" }: WrappedCardProps) {
  const [bg] = pickGradient(userId);

  const maxCat = Math.max(...stats.platforms.map((p) => p.count), stats.top_category_count, 1);
  const topCategories = Object.entries(
    stats.platforms.reduce<Record<string, number>>((acc, p) => {
      acc[p.platform] = p.count;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <View
      style={{
        width: CARD_W, height: CARD_H,
        backgroundColor: bg,
        borderRadius: 24, overflow: "hidden",
        padding: 28,
        justifyContent: "space-between",
      }}
    >
      {/* Wordmark */}
      <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: "700", letterSpacing: 2 }}>
        dibs.
      </Text>

      {/* Main copy */}
      <View style={{ gap: 24 }}>
        {/* Headline */}
        <View>
          <Text
            style={{
              color: "#fff", fontSize: 36, fontWeight: "800",
              lineHeight: 42, letterSpacing: -1,
            }}
          >
            {copy.headline}
          </Text>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

        {/* Label */}
        <Text
          style={{
            color: "#FF6B4A", fontSize: 20, fontWeight: "700",
            letterSpacing: -0.3,
          }}
        >
          {copy.label}
        </Text>

        {/* Roast */}
        <Text
          style={{
            color: "rgba(255,255,255,0.7)", fontSize: 15,
            lineHeight: 22,
          }}
        >
          {copy.roast}
        </Text>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

        {/* Closing */}
        <Text
          style={{
            color: "rgba(255,255,255,0.5)", fontSize: 14,
            fontStyle: "italic",
          }}
        >
          {copy.closing}
        </Text>
      </View>

      {/* Category bar chart */}
      <View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 40, marginBottom: 8 }}>
          {[
            { label: CATEGORY_LABEL[stats.top_category], count: stats.top_category_count },
            ...topCategories.map(([p, c]) => ({ label: p, count: c })),
          ].slice(0, 5).map((item, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              <View
                style={{
                  width: "100%",
                  height: Math.max(4, (item.count / maxCat) * 36),
                  backgroundColor: i === 0 ? "#FF6B4A" : "rgba(255,255,255,0.15)",
                  borderRadius: 4,
                }}
              />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[
            { label: CATEGORY_LABEL[stats.top_category] },
            ...topCategories.map(([p]) => ({ label: p })),
          ].slice(0, 5).map((item, i) => (
            <Text key={i} style={{ flex: 1, color: "rgba(255,255,255,0.3)", fontSize: 8, textAlign: "center" }} numberOfLines={1}>
              {item.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export { CARD_W, CARD_H };

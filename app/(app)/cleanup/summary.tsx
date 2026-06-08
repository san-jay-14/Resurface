import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function CleanupSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { archived, kept, done } = useLocalSearchParams<{
    archived: string;
    kept: string;
    done: string;
  }>();

  const a = parseInt(archived ?? "0");
  const k = parseInt(kept ?? "0");
  const d = parseInt(done ?? "0");
  const total = a + k + d;

  const pct = total > 0 ? Math.round((a / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      <View
        style={{
          flex: 1, alignItems: "center", justifyContent: "center",
          paddingHorizontal: 32,
          paddingTop: insets.top,
        }}
      >
        <Text style={{ fontSize: 52, marginBottom: 24 }}>✨</Text>

        <Text
          style={{
            color: "#fff", fontSize: 26, fontWeight: "800",
            textAlign: "center", letterSpacing: -0.5, marginBottom: 10,
          }}
        >
          Clean sweep!
        </Text>

        <Text style={{ color: "#666", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 36 }}>
          You reviewed {total} {total === 1 ? "save" : "saves"}.
        </Text>

        {/* Stats */}
        <View
          style={{
            backgroundColor: "#111", borderRadius: 20, padding: 24,
            width: "100%", gap: 14, marginBottom: 36,
          }}
        >
          <StatRow emoji="🗑" label="Archived" value={a} color="#EF4444" />
          <StatRow emoji="💚" label="Kept" value={k} color="#22C55E" />
          <StatRow emoji="✅" label="Marked done" value={d} color="#A855F7" />
        </View>

        {pct > 0 && (
          <Text style={{ color: "#555", fontSize: 14, textAlign: "center", marginBottom: 36 }}>
            Your library is {pct}% cleaner.
          </Text>
        )}

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
          {a > 0 && (
            <Pressable
              onPress={() => router.push("/(app)/settings/archived" as never)}
              style={{
                flex: 1, borderWidth: 1, borderColor: "#2A2A2A",
                borderRadius: 32, paddingVertical: 14, alignItems: "center",
              }}
            >
              <Text style={{ color: "#888", fontSize: 14 }}>See Archived</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => router.replace("/(app)/" as never)}
            style={{
              flex: 1, backgroundColor: "#FF6B4A",
              borderRadius: 32, paddingVertical: 14, alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Back to Library</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function StatRow({ emoji, label, value, color }: { emoji: string; label: string; value: number; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ fontSize: 18, width: 28 }}>{emoji}</Text>
      <Text style={{ color: "#888", fontSize: 14, flex: 1 }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

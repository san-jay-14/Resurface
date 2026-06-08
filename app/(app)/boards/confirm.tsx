import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function BoardConfirmScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { boardId, boardName, saveCount } = useLocalSearchParams<{
    boardId: string;
    boardName: string;
    saveCount: string;
  }>();

  const count = parseInt(saveCount ?? "0");

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
        <Text style={{ fontSize: 48, marginBottom: 24 }}>🎉</Text>

        <Text style={{ color: "#888", fontSize: 13, marginBottom: 8 }}>You've been invited to</Text>

        <Text
          style={{
            color: "#fff", fontSize: 28, fontWeight: "800",
            textAlign: "center", letterSpacing: -0.5, marginBottom: 8,
          }}
        >
          "{boardName}"
        </Text>

        {count > 0 && (
          <Text style={{ color: "#555", fontSize: 13, marginBottom: 40 }}>
            {count} {count === 1 ? "save" : "saves"} so far
          </Text>
        )}

        <Text style={{ color: "#555", fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 40 }}>
          You've joined! This board is now in your Boards tab.
        </Text>

        <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
          <Pressable
            onPress={() => router.replace("/(app)/profile" as never)}
            style={{
              flex: 1, borderWidth: 1, borderColor: "#2A2A2A",
              borderRadius: 32, paddingVertical: 15, alignItems: "center",
            }}
          >
            <Text style={{ color: "#888", fontSize: 14 }}>Not now</Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.replace({
                pathname: "/(app)/board/[id]",
                params: { id: boardId, name: boardName },
              } as never)
            }
            style={{
              flex: 1, backgroundColor: "#FF6B4A",
              borderRadius: 32, paddingVertical: 15, alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Open Board</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

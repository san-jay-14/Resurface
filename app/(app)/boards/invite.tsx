import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { joinBoard } from "@/lib/boards";
import { appAlert } from "@/providers/AlertProvider";
import { isApiError, useAuth } from "@/providers/AuthProvider";

export default function JoinBoardScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState("");

  // Invite deep links (dibs://board/join?code=…) arrive with the code pre-filled.
  useEffect(() => {
    if (params.code) setCode(String(params.code).toUpperCase());
  }, [params.code]);
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 6 || !session) return;
    setLoading(true);

    try {
      const { board } = await joinBoard(trimmed);
      router.replace({
        pathname: "/(app)/boards/confirm",
        params: {
          boardId: board.id,
          boardName: board.name,
          saveCount: String(board.save_count),
        },
      } as never);
    } catch (err) {
      if (isApiError(err) && err.status !== 0) {
        appAlert("Couldn't join", err.message);
      } else {
        appAlert("Couldn't connect", "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: "#FFFFFF" }}
    >
      <StatusBar style="dark" />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ color: "#1A1A1A", fontSize: 18, fontWeight: "700", flex: 1, marginLeft: 12 }}>
          Join a Board
        </Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 40 }}>
        <Text style={{ color: "#1A1A1A", fontSize: 22, fontWeight: "800", marginBottom: 8 }}>
          Enter invite code
        </Text>
        <Text style={{ color: "#888", fontSize: 14, lineHeight: 20, marginBottom: 32 }}>
          Ask whoever shared the board for their 8-character code.
        </Text>

        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="XKTZ8W4P"
          placeholderTextColor="#888"
          maxLength={8}
          autoCapitalize="characters"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={handleJoin}
          style={{
            backgroundColor: "#F5F5F5",
            borderRadius: 16,
            paddingHorizontal: 20, paddingVertical: 18,
            color: "#1A1A1A",
            fontSize: 24, fontWeight: "700",
            letterSpacing: 4,
            textAlign: "center",
            marginBottom: 20,
          }}
        />

        <Pressable
          onPress={handleJoin}
          disabled={loading || code.trim().length < 6}
          style={{
            backgroundColor: code.trim().length >= 6 ? "#9013BB" : "#F0F0F0",
            borderRadius: 32, paddingVertical: 16, alignItems: "center",
          }}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: code.trim().length >= 6 ? "#fff" : "#888", fontSize: 16, fontWeight: "700" }}>
                Join Board →
              </Text>
          }
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

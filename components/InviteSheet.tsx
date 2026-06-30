import { Modal, Pressable, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Collection } from "@/lib/database.types";

/** Bottom sheet showing a board's invite code + share actions. Reused by
 *  custom boards and category boards (which share via a shadow collection). */
export function InviteSheet({
  visible,
  board,
  onClose,
}: {
  visible: boolean;
  board: Collection;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const code = board.invite_code ?? "";
  const link = `https://getdibs.app/join/${code}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 24, paddingTop: 24,
          paddingBottom: Math.max(insets.bottom, 20) + 12,
          alignItems: "center",
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", marginBottom: 24 }} />
        <Text style={{ color: "#1A1A1A", fontSize: 17, fontWeight: "700", marginBottom: 6 }}>
          Share this board
        </Text>
        <Text style={{ color: "#888", fontSize: 13, marginBottom: 28 }}>
          Anyone with this code can join your board.
        </Text>

        {/* Code display */}
        <View
          style={{
            backgroundColor: "#F5F5F5", borderRadius: 16,
            paddingHorizontal: 32, paddingVertical: 20,
            marginBottom: 24, alignItems: "center",
          }}
        >
          <Text style={{ color: "#9013BB", fontSize: 30, fontWeight: "800", letterSpacing: 6 }}>
            {code}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
          <Pressable
            onPress={() => Share.share({ message: link })}
            style={{
              flex: 1, backgroundColor: "#F5F5F5",
              borderRadius: 32, paddingVertical: 15, alignItems: "center",
            }}
          >
            <Text style={{ color: "#1A1A1A", fontSize: 14, fontWeight: "600" }}>Copy Link</Text>
          </Pressable>
          <Pressable
            onPress={() => Share.share({ message: `Join my board "${board.name}" on Dibs! Code: ${code}` })}
            style={{
              flex: 1, backgroundColor: "#9013BB",
              borderRadius: 32, paddingVertical: 15, alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Share Code</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

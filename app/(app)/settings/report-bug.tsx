import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { appAlert } from "@/providers/AlertProvider";
import { submitBugReport } from "@/lib/bugReports";

interface Attachment {
  uri: string;
  mimeType: string;
}

const MAX_ATTACHMENTS = 4;

export default function ReportBugScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = message.trim().length > 0 && !submitting;

  // Attachments are sent together with the report; the server validates type and size.
  const addAsset = (uri: string, mimeType: string | undefined) => {
    setAttachments((prev) =>
      prev.some((a) => a.uri === uri) ? prev : [...prev, { uri, mimeType: mimeType ?? "image/jpeg" }],
    );
  };

  const pickAttachments = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      appAlert("Limit reached", `You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      appAlert("Permission needed", "Allow photo access to attach a screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS - attachments.length,
      quality: 0.6,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      addAsset(asset.uri, asset.mimeType);
    }
  };

  const removeAttachment = (uri: string) => {
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitBugReport(
        message.trim(),
        attachments.map((a, i) => ({
          uri: a.uri,
          name: `attachment-${i}.${a.mimeType.split("/")[1] ?? "jpg"}`,
          type: a.mimeType,
        })),
      );
      appAlert("Thanks!", "We've logged your report and will take a look.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      appAlert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", gap: 12,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#1A1A1A", flex: 1 }}>
          Report a bug
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={{ fontSize: 13, color: "#888", marginBottom: 14, lineHeight: 18 }}>
          Tell us what went wrong. The more detail, the faster we can fix it.
        </Text>

        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="What happened? What did you expect instead?"
          placeholderTextColor="#AAA"
          multiline
          maxLength={1000}
          style={{
            minHeight: 140, backgroundColor: "#F5F5F5", borderRadius: 16,
            padding: 14, color: "#1A1A1A", fontSize: 14, lineHeight: 20,
            textAlignVertical: "top",
          }}
        />
        <Text style={{ color: "#AAA", fontSize: 11, marginTop: 6, textAlign: "right" }}>
          {message.length}/1000
        </Text>

        <Text style={{ fontSize: 12, fontWeight: "700", color: "#999", letterSpacing: 0.6, marginTop: 20, marginBottom: 10 }}>
          ATTACHMENTS
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {attachments.map((a) => (
            <View key={a.uri} style={{ width: 84, height: 84, borderRadius: 14, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
              <Image source={{ uri: a.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              <Pressable
                onPress={() => removeAttachment(a.uri)}
                style={{
                  position: "absolute", top: 4, right: 4,
                  width: 20, height: 20, borderRadius: 10,
                  backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {attachments.length < MAX_ATTACHMENTS && (
            <Pressable
              onPress={pickAttachments}
              style={{
                width: 84, height: 84, borderRadius: 14,
                borderWidth: 1.5, borderColor: "#E5E5E5", borderStyle: "dashed",
                alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              <Ionicons name="image-outline" size={20} color="#9013BB" />
              <Text style={{ color: "#9013BB", fontSize: 10, fontWeight: "600" }}>Attach</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={{
            marginTop: 28, backgroundColor: canSubmit ? "#9013BB" : "#F0F0F0",
            borderRadius: 32, paddingVertical: 16, alignItems: "center",
          }}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: canSubmit ? "#fff" : "#AAA", fontSize: 15, fontWeight: "700" }}>
                Submit report
              </Text>
          }
        </Pressable>
      </ScrollView>
    </View>
  );
}

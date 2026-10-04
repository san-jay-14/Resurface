import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { UserRule } from "@/lib/database.types";
import { appAlert } from "@/providers/AlertProvider";
import { applyRule, createRule, deleteRule as deleteRuleApi, listRules, setRuleActive } from "@/lib/rules";
import { getCategoryCounts } from "@/lib/saves";
import { isApiError, useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// Add Rule bottom sheet
// ---------------------------------------------------------------------------
function AddRuleSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [savedRuleId, setSavedRuleId] = useState<string | null>(null);
  const [totalSaves, setTotalSaves] = useState(0);
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const handleSubmit = async () => {
    if (!text.trim() || !session) return;
    setLoading(true);
    setConfirmation(null);

    try {
      const rule = await createRule(text.trim());
      setConfirmation(
        `Got it — this rule will sort matching saves into ${rule.parsed_logic.action.set_category ?? "the right category"}.`,
      );
      setSavedRuleId(rule.id);

      const counts = await getCategoryCounts().catch(() => ({}));
      setTotalSaves(Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0));

      onAdded();
    } catch (err) {
      if (isApiError(err, "rule_not_understood")) {
        appAlert(
          "Couldn't parse that",
          "Dibs couldn't understand that rule. Try rephrasing it — e.g. 'Put anything from @username into Fashion'",
        );
      } else if (isApiError(err) && err.status !== 0) {
        appAlert("Couldn't add the rule", err.message);
      } else {
        appAlert("Couldn't connect", "Your rule wasn't saved — try again?");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetroactive = async () => {
    if (!savedRuleId) return;
    onClose();
    setText("");
    setConfirmation(null);

    try {
      const { updated } = await applyRule(savedRuleId);
      appAlert("Done", updated === 1 ? "Moved 1 save." : `Moved ${updated} saves.`);
    } catch {
      appAlert("Couldn't apply", "The rule is saved; you can apply it again from the list.");
    }
  };

  const handleClose = () => {
    setText("");
    setConfirmation(null);
    setSavedRuleId(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
        onPress={handleClose}
      />
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 20, paddingTop: 20,
          paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: 20 }} />

        {confirmation ? (
          <View>
            <Text style={{ color: "#1A1A1A", fontSize: 15, lineHeight: 22, marginBottom: 20 }}>
              {confirmation}
            </Text>
            <Text style={{ color: "#888", fontSize: 13, marginBottom: 24 }}>
              Apply this to your existing {totalSaves} saves?
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={handleRetroactive}
                style={{ flex: 1, backgroundColor: "#9013BB", borderRadius: 32, paddingVertical: 15, alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Apply</Text>
              </Pressable>
              <Pressable
                onPress={handleClose}
                style={{ flex: 1, backgroundColor: "#F5F5F5", borderRadius: 32, paddingVertical: 15, alignItems: "center" }}
              >
                <Text style={{ color: "#888", fontSize: 15 }}>Skip</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "700", marginBottom: 6 }}>
              Tell Dibs how to sort your saves
            </Text>
            <Text style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              e.g. "Put anything from @zara into Shopping"
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type your rule in plain English..."
              placeholderTextColor="#888"
              multiline
              maxLength={300}
              autoFocus
              style={{
                backgroundColor: "#F5F5F5", borderRadius: 14,
                paddingHorizontal: 16, paddingVertical: 14,
                color: "#1A1A1A", fontSize: 14, lineHeight: 20,
                minHeight: 90, marginBottom: 16, textAlignVertical: "top",
              }}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={loading || !text.trim()}
              style={{
                backgroundColor: text.trim() ? "#9013BB" : "#F0F0F0",
                borderRadius: 32, paddingVertical: 15, alignItems: "center",
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: text.trim() ? "#fff" : "#888", fontSize: 15, fontWeight: "700" }}>
                    Add Rule →
                  </Text>
              }
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rules list screen
// ---------------------------------------------------------------------------
export default function RulesScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rules, setRules] = useState<UserRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);

  const fetchRules = async () => {
    if (!session) return;
    try {
      setRules(await listRules());
    } catch (err) {
      console.warn("Failed to load rules:", err);
    }
    setLoading(false);
  };

  useEffect(() => { void fetchRules(); }, [session]);

  const toggleRule = async (rule: UserRule) => {
    const next = !rule.is_active;
    setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: next } : r));
    try {
      await setRuleActive(rule.id, next);
    } catch {
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: !next } : r));
      appAlert("Couldn't update", "Check your connection and try again.");
    }
  };

  const deleteRule = (rule: UserRule) => {
    appAlert("Delete rule", `Delete "${rule.raw_text}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          setRules((prev) => prev.filter((r) => r.id !== rule.id));
          await deleteRuleApi(rule.id).catch(() => undefined);
        },
      },
    ]);
  };

  const applyToExisting = async (rule: UserRule) => {
    if (!session) return;
    appAlert(
      "Apply to existing saves?",
      "This will run the rule on all your existing saves.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: async () => {
            try {
              const { updated } = await applyRule(rule.id);
              appAlert("Done", updated === 1 ? "Moved 1 save." : `Moved ${updated} saves.`);
            } catch (err) {
              appAlert("Couldn't apply", isApiError(err) && err.status !== 0 ? err.message : "Try again.");
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
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
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ color: "#1A1A1A", fontSize: 18, fontWeight: "700", flex: 1 }}>My Rules</Text>
        <Pressable
          onPress={() => setAddVisible(true)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            backgroundColor: "#9013BB", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
          }}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Add Rule</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#9013BB" size="large" />
        </View>
      ) : rules.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 36 }}>⚡</Text>
          <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 16 }}>
            No rules yet
          </Text>
          <Text style={{ color: "#888", fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 8 }}>
            Rules let Dibs categorise your saves automatically. Tap "Add Rule" to get started.
          </Text>
          <Pressable
            onPress={() => setAddVisible(true)}
            style={{ marginTop: 20, backgroundColor: "#9013BB", borderRadius: 24, paddingHorizontal: 24, paddingVertical: 11 }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Add your first rule</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {rules.map((rule, i) => (
            <View key={rule.id}>
              <View
                style={{
                  paddingHorizontal: 16, paddingVertical: 14,
                  flexDirection: "row", alignItems: "center", gap: 12,
                }}
              >
                <Switch
                  value={rule.is_active}
                  onValueChange={() => void toggleRule(rule)}
                  trackColor={{ false: "#E5E5E5", true: "#9013BB" }}
                  thumbColor="#fff"
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#1A1A1A", fontSize: 14, lineHeight: 19 }} numberOfLines={2}>
                    {rule.raw_text}
                  </Text>
                  <Text style={{ color: "#888", fontSize: 11, marginTop: 3 }}>
                    {rule.hit_count > 0
                      ? `Matched ${rule.hit_count} ${rule.hit_count === 1 ? "save" : "saves"}`
                      : "Never triggered yet"
                    }
                    {!rule.is_active ? " · OFF" : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    appAlert(rule.raw_text, undefined, [
                      { text: "Apply to existing saves", onPress: () => void applyToExisting(rule) },
                      { text: "Delete", style: "destructive", onPress: () => deleteRule(rule) },
                      { text: "Cancel", style: "cancel" },
                    ])
                  }
                  hitSlop={8}
                >
                  <Ionicons name="ellipsis-vertical" size={18} color="#555" />
                </Pressable>
              </View>
              {i < rules.length - 1 && <View style={{ height: 1, backgroundColor: "#E5E5E5", marginLeft: 80 }} />}
            </View>
          ))}
        </ScrollView>
      )}

      <AddRuleSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onAdded={fetchRules}
      />
    </View>
  );
}

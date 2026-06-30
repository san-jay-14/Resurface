import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

function FieldLabel({ title, help }: { title: string; help: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: "#1A1A1A" }}>{title}</Text>
      <Text style={{ fontSize: 12, color: "#888", marginTop: 2, lineHeight: 17 }}>{help}</Text>
    </View>
  );
}

export default function CreateBoardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [requiresLocation, setRequiresLocation] = useState(false);
  const [creating, setCreating] = useState(false);

  const canCreate = name.trim().length > 0;

  const create = async () => {
    if (!session || !canCreate) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: session.user.id,
        name: name.trim(),
        description: description.trim() || null,
        requires_location: requiresLocation,
      })
      .select()
      .single();
    setCreating(false);

    if (error) {
      appAlert("Error", error.message.includes("unique")
        ? `A board called "${name.trim()}" already exists.`
        : error.message);
      return;
    }

    router.replace({
      pathname: "/(app)/board/[id]",
      params: { id: data.id, name: data.name },
    } as never);
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
          New board
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 13, color: "#888", marginBottom: 22, lineHeight: 19 }}>
          Boards are how Dibs organizes your saves beyond the automatic categories.
          The more you tell us here, the smarter Dibs gets at sorting new saves
          into it and reminding you about them at the right time.
        </Text>

        {/* Name */}
        <FieldLabel
          title="BOARD NAME"
          help="A short, clear name — Dibs shows this everywhere, including to anyone you invite."
        />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Goa trip, Diwali shopping, Winter outfits…"
          placeholderTextColor="#AAA"
          maxLength={50}
          autoFocus
          style={{
            backgroundColor: "#F5F5F5", borderRadius: 14,
            paddingHorizontal: 16, paddingVertical: 13,
            color: "#1A1A1A", fontSize: 15, marginBottom: 24,
          }}
        />

        {/* Description */}
        <FieldLabel
          title="WHAT GOES HERE?"
          help="Describe what kind of saves belong on this board — Dibs reads this to auto-sort matching saves into it and to write better reminders about them."
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. restaurants and activities for our Goa trip in December"
          placeholderTextColor="#AAA"
          multiline
          maxLength={300}
          style={{
            minHeight: 90, backgroundColor: "#F5F5F5", borderRadius: 14,
            paddingHorizontal: 16, paddingVertical: 13,
            color: "#1A1A1A", fontSize: 15, marginBottom: 24,
            textAlignVertical: "top",
          }}
        />

        {/* Location toggle */}
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 14,
          backgroundColor: "#F5F5F5", borderRadius: 16, padding: 14,
        }}>
          <View style={{
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="location-outline" size={18} color="#9013BB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A" }}>
              Saves here need a map
            </Text>
            <Text style={{ fontSize: 12, color: "#888", marginTop: 2, lineHeight: 16 }}>
              Turn this on for boards about specific places — restaurants, trips,
              stores. You'll get a map view and "near you" alerts, just like Places.
            </Text>
          </View>
          <Switch
            value={requiresLocation}
            onValueChange={setRequiresLocation}
            trackColor={{ false: "#E5E5E5", true: "#D9B3EE" }}
            thumbColor={requiresLocation ? "#9013BB" : "#FFFFFF"}
          />
        </View>

        <Pressable
          onPress={create}
          disabled={!canCreate || creating}
          style={{
            marginTop: 32, backgroundColor: canCreate ? "#9013BB" : "#F0F0F0",
            borderRadius: 32, paddingVertical: 16, alignItems: "center",
          }}
        >
          {creating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: canCreate ? "#fff" : "#AAA", fontSize: 15, fontWeight: "700" }}>
                Create board
              </Text>
          }
        </Pressable>
      </ScrollView>
    </View>
  );
}

import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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

import { AppDatePicker } from "@/components/AppDatePicker";
import { updateProfile } from "@/lib/profile";
import { appAlert } from "@/providers/AlertProvider";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHuman(iso: string | null): string {
  if (!iso) return "Add your birthday";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric",
  });
}

function FieldRow({
  icon, label, value, onPress, placeholder,
}: { icon: string; label: string; value: string | null; onPress: () => void; placeholder: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingHorizontal: 16, paddingVertical: 16,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name={icon as never} size={17} color="#9013BB" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>{label}</Text>
        <Text style={{ fontSize: 15, color: value ? "#1A1A1A" : "#AAA", fontWeight: "500" }}>
          {value ?? placeholder}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#CCCCCC" />
    </Pressable>
  );
}

export default function EditProfileScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(profile?.name ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  // Picks up home_city changes made on the location-picker screen on return.
  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

  const meta = session?.user?.user_metadata ?? {};
  const avatarUrl: string | null =
    profile?.avatar_url ??
    (meta.avatar_url as string | undefined) ??
    (meta.picture as string | undefined) ??
    null;
  const initials = (profile?.name ?? "You")
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      appAlert("Permission needed", "Allow photo access to set a profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0] || !session) return;

    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${session.user.id}/avatar.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: asset.mimeType ?? "image/jpeg" });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-bust so the new image shows immediately (same path, new content).
      await updateProfile(session.user.id, { avatar_url: `${data.publicUrl}?t=${Date.now()}` });
      await refreshProfile();
    } catch (err) {
      appAlert("Couldn't update photo", err instanceof Error ? err.message : "Try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onBirthdayChange = (selected: Date) => {
    setShowPicker(false);
    if (!session) return;
    const iso = toISODate(selected);
    void updateProfile(session.user.id, { birthday: iso }).then(() => refreshProfile());
  };

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    try {
      await updateProfile(session.user.id, { name: name.trim() || null });
      await refreshProfile();
      router.back();
    } catch (err) {
      appAlert("Couldn't save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#1A1A1A" }}>Edit profile</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
          {saving
            ? <ActivityIndicator color="#9013BB" size="small" />
            : <Text style={{ fontSize: 15, color: "#9013BB", fontWeight: "700" }}>Save</Text>
          }
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* Avatar */}
        <View style={{ alignItems: "center", paddingVertical: 28 }}>
          <Pressable onPress={pickAvatar} disabled={uploadingAvatar}>
            <View style={{
              width: 92, height: 92, borderRadius: 46,
              backgroundColor: "#F0E8F7", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {uploadingAvatar ? (
                <ActivityIndicator color="#9013BB" />
              ) : avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              ) : (
                <Text style={{ color: "#9013BB", fontSize: 30, fontWeight: "700" }}>{initials}</Text>
              )}
            </View>
            <View style={{
              position: "absolute", bottom: 0, right: 0,
              width: 30, height: 30, borderRadius: 15,
              backgroundColor: "#9013BB", alignItems: "center", justifyContent: "center",
              borderWidth: 2, borderColor: "#FFFFFF",
            }}>
              <Ionicons name="camera" size={14} color="#fff" />
            </View>
          </Pressable>
          <Text style={{ color: "#9013BB", fontSize: 13, fontWeight: "600", marginTop: 10 }}>
            Change photo
          </Text>
        </View>

        {/* Name */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#AAA"
            maxLength={60}
            style={{
              backgroundColor: "#F5F5F5", borderRadius: 14,
              paddingHorizontal: 16, paddingVertical: 13,
              color: "#1A1A1A", fontSize: 15,
            }}
          />
        </View>

        <View style={{ height: 12 }} />

        <FieldRow
          icon="gift-outline"
          label="BIRTHDAY"
          value={profile?.birthday ? formatHuman(profile.birthday) : null}
          placeholder="Add your birthday"
          onPress={() => setShowPicker(true)}
        />
        <FieldRow
          icon="location-outline"
          label="HOME CITY"
          value={profile?.home_city ?? null}
          placeholder="Set your home city"
          onPress={() => router.push("/(app)/location-picker?mode=home" as never)}
        />
      </ScrollView>

      <AppDatePicker
        visible={showPicker}
        value={profile?.birthday ? new Date(`${profile.birthday}T00:00:00`) : new Date(2000, 0, 1)}
        maximumDate={new Date()}
        onClose={() => setShowPicker(false)}
        onChange={onBirthdayChange}
      />
    </View>
  );
}

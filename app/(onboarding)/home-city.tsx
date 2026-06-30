import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, TextInput } from "react-native";

import { DarkOnboardingScaffold } from "@/components/DarkOnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

export default function HomeCityStep() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);

  const trimmed = city.trim();

  async function onContinue() {
    if (!session || trimmed.length === 0) return;
    try {
      setSaving(true);
      await updateProfile(session.user.id, { home_city: trimmed });
      await refreshProfile();
      router.push("/(onboarding)/notifications");
    } catch (err) {
      appAlert("Hmm", err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DarkOnboardingScaffold
      step={2}
      totalSteps={4}
      title="where do you call home?"
      titleAccent="home"
      subtitle="When you travel somewhere new, your saved spots there come alive. We need a baseline to notice the difference."
      primaryLabel="That's home →"
      primaryLoading={saving}
      primaryDisabled={trimmed.length === 0}
      onPrimary={onContinue}
      buttonsInline
    >
      <TextInput
        value={city}
        onChangeText={setCity}
        placeholder="Mumbai, Bengaluru, New York…"
        placeholderTextColor="#888"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={onContinue}
        style={{
          height: 54, borderRadius: 16,
          borderWidth: 1, borderColor: city.length > 0 ? "#9013BB" : "#E5E5E5",
          backgroundColor: "#F5F5F5", paddingHorizontal: 18,
          color: "#1A1A1A", fontSize: 16,
        }}
      />
      <Text style={{ color: "#888", fontSize: 13, marginTop: 10 }}>
        just the city name is enough.
      </Text>
    </DarkOnboardingScaffold>
  );
}

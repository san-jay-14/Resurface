import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, TextInput } from "react-native";

import { OnboardingScaffold } from "@/components/OnboardingScaffold";
import { updateProfile } from "@/lib/profile";
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
      // NOTE: lat/lng left null in V1 — geocoded later once Google Places
      // billing is provisioned (spec §6.3, §7). The new-city trigger compares
      // on city name until then.
      await updateProfile(session.user.id, { home_city: trimmed });
      await refreshProfile();
      router.push("/(onboarding)/notifications");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't save that.";
      Alert.alert("Hmm", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingScaffold
      step={2}
      totalSteps={4}
      title="Where's home?"
      subtitle="I'll use this to notice when you're travelling somewhere new — that's when your saved places matter most."
      primaryLabel="Continue"
      primaryLoading={saving}
      primaryDisabled={trimmed.length === 0}
      onPrimary={onContinue}
    >
      <TextInput
        value={city}
        onChangeText={setCity}
        placeholder="e.g. Bengaluru"
        placeholderTextColor="#8A7E74"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={onContinue}
        className="h-14 rounded-2xl border border-line bg-white px-4 text-base text-ink"
      />
      <Text className="mt-3 text-sm text-muted">
        Just your city is enough.
      </Text>
    </OnboardingScaffold>
  );
}

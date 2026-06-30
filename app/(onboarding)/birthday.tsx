import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { AppDatePicker } from "@/components/AppDatePicker";
import { DarkOnboardingScaffold } from "@/components/DarkOnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHuman(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default function BirthdayStep() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [date, setDate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  async function persistAndContinue(birthday: string | null) {
    if (!session) return;
    try {
      setSaving(true);
      await updateProfile(session.user.id, { birthday });
      await refreshProfile();
      router.push("/(onboarding)/home-city");
    } catch (err) {
      appAlert("Hmm", err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DarkOnboardingScaffold
      step={1}
      totalSteps={4}
      title="when's the big day?"
      titleAccent="big day"
      subtitle="We'll surface your saved gifts, outfits, and restaurants right before it. Not the day after — that'd be useless."
      primaryLabel="That's the one →"
      primaryLoading={saving}
      primaryDisabled={!date}
      onPrimary={() => persistAndContinue(date ? toISODate(date) : null)}
      skipLabel="keep it mysterious"
      onSkip={() => persistAndContinue(null)}
      buttonsInline
    >
      <Pressable
        onPress={() => setShowPicker(true)}
        style={{
          height: 54, justifyContent: "center",
          borderRadius: 16, borderWidth: 1,
          borderColor: date ? "#9013BB" : "#E5E5E5",
          backgroundColor: "#F5F5F5", paddingHorizontal: 18,
        }}
      >
        <Text style={{ color: date ? "#1A1A1A" : "#888", fontSize: 16 }}>
          {date ? formatHuman(date) : "tap to pick a date"}
        </Text>
      </Pressable>

      <AppDatePicker
        visible={showPicker}
        value={date ?? new Date(2000, 0, 1)}
        maximumDate={new Date()}
        onClose={() => setShowPicker(false)}
        onChange={(selected) => setDate(selected)}
      />
    </DarkOnboardingScaffold>
  );
}

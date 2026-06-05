import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, Text } from "react-native";

import { OnboardingScaffold } from "@/components/OnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { useAuth } from "@/providers/AuthProvider";

/** Format a Date as YYYY-MM-DD in local time (no timezone shift). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHuman(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function BirthdayStep() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [date, setDate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  function onChange(event: DateTimePickerEvent, selected?: Date) {
    // On Android the dialog manages its own dismissal; hide on any result.
    setShowPicker(Platform.OS === "ios");
    if (event.type === "set" && selected) setDate(selected);
  }

  async function persistAndContinue(birthday: string | null) {
    if (!session) return;
    try {
      setSaving(true);
      await updateProfile(session.user.id, { birthday });
      await refreshProfile();
      router.push("/(onboarding)/home-city");
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
      step={1}
      totalSteps={4}
      title="When's your birthday?"
      subtitle="So I can resurface saved outfits and gift ideas in the week before it — never the day after."
      primaryLabel="Continue"
      primaryLoading={saving}
      primaryDisabled={!date}
      onPrimary={() => persistAndContinue(date ? toISODate(date) : null)}
      skipLabel="Ask me later"
      onSkip={() => persistAndContinue(null)}
    >
      <Pressable
        onPress={() => setShowPicker(true)}
        className="h-14 justify-center rounded-2xl border border-line bg-white px-4"
      >
        <Text className={`text-base ${date ? "text-ink" : "text-muted"}`}>
          {date ? formatHuman(date) : "Pick your birthday"}
        </Text>
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={date ?? new Date(2000, 0, 1)}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          onChange={onChange}
        />
      )}
    </OnboardingScaffold>
  );
}

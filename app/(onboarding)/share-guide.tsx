import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";

import { DarkOnboardingScaffold } from "@/components/DarkOnboardingScaffold";
import { updateProfile } from "@/lib/profile";
import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

const STEPS = [
  {
    n: "01",
    emoji: "🔖",
    headline: "see something worth keeping",
    detail: "a reel, a restaurant, a product, a playlist — anything.",
  },
  {
    n: "02",
    emoji: "📤",
    headline: "hit the share button",
    detail: "tap Dibs in the share sheet. one tap.",
  },
  {
    n: "03",
    emoji: "✨",
    headline: "we'll bring it back",
    detail: "at the right time, in the right place. that's the whole deal.",
  },
];

function AnimatedStep({ step, index }: { step: typeof STEPS[number]; index: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(28)).current;
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 450, delay: 200 + index * 220, useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0, delay: 200 + index * 220, useNativeDriver: true,
        damping: 14, stiffness: 120,
      }),
    ]).start(() => {
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(bounce, { toValue: 0, useNativeDriver: true, damping: 6, stiffness: 140 }),
      ]).start();
    });
  }, []);

  return (
    <Animated.View
      style={{
        flexDirection: "row", gap: 16, alignItems: "flex-start",
        opacity,
        transform: [{ translateX }],
      }}
    >
      <Animated.Text
        style={{
          fontSize: 20, marginTop: 1, width: 26,
          transform: [{ scale: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
        }}
      >
        {step.emoji}
      </Animated.Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "700", marginBottom: 3 }}>
          {step.headline}
        </Text>
        <Text style={{ color: "rgba(26,26,26,0.45)", fontSize: 14, lineHeight: 20 }}>
          {step.detail}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function ShareGuideStep() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    if (!session) return;
    try {
      setFinishing(true);
      await updateProfile(session.user.id, { onboarding_completed: true });
      await refreshProfile();
      // Don't rely solely on the root layout's routing-gate effect picking
      // up the profile change — navigate explicitly so this never stalls.
      router.replace("/(app)" as never);
    } catch (err) {
      appAlert("Hmm", err instanceof Error ? err.message : "Couldn't finish setup.");
      setFinishing(false);
    }
  }

  return (
    <DarkOnboardingScaffold
      step={4}
      totalSteps={4}
      title="saving takes one tap."
      titleAccent="one tap"
      subtitle="Dibs lives behind the share button in every app. No copy-pasting, no typing URLs."
      primaryLabel="start saving →"
      primaryLoading={finishing}
      onPrimary={finish}
    >
      <View style={{ gap: 22 }}>
        {STEPS.map((s, i) => (
          <AnimatedStep key={s.n} step={s} index={i} />
        ))}
      </View>
    </DarkOnboardingScaffold>
  );
}

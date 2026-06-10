import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface DarkOnboardingScaffoldProps {
  step: number;
  totalSteps: number;
  title: string;
  titleAccent?: string;      // word in the title to highlight coral
  subtitle?: string;
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  skipLabel?: string;
  onSkip?: () => void;
}

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <Animated.View
          key={i}
          style={{
            height: 3,
            width: i < step ? 20 : 6,
            borderRadius: 2,
            backgroundColor: i < step ? "#FF6B4A" : "#2A2A2A",
          }}
        />
      ))}
    </View>
  );
}

export function DarkOnboardingScaffold({
  step,
  totalSteps,
  title,
  titleAccent,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryLoading = false,
  primaryDisabled = false,
  skipLabel,
  onSkip,
}: DarkOnboardingScaffoldProps) {
  const insets = useSafeAreaInsets();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, delay: 80, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 380, delay: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  // Render title with optional accent word
  const renderTitle = () => {
    if (!titleAccent) {
      return (
        <Text style={{ color: "#fff", fontSize: 34, fontWeight: "800", lineHeight: 40, letterSpacing: -1 }}>
          {title}
        </Text>
      );
    }
    const parts = title.split(titleAccent);
    return (
      <Text style={{ color: "#fff", fontSize: 34, fontWeight: "800", lineHeight: 40, letterSpacing: -1 }}>
        {parts[0]}
        <Text style={{ color: "#FF6B4A" }}>{titleAccent}</Text>
        {parts[1]}
      </Text>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      <StatusBar style="light" />

      <Animated.View
        style={{
          flex: 1,
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          paddingTop: insets.top + 20,
          paddingHorizontal: 24,
          justifyContent: "space-between",
          paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
      >
        {/* Top content */}
        <View style={{ flex: 1 }}>
          {/* Step dots */}
          <StepDots step={step} total={totalSteps} />

          {/* Title */}
          <View style={{ marginTop: 36 }}>
            {renderTitle()}
          </View>

          {/* Subtitle */}
          {subtitle && (
            <Text style={{
              color: "rgba(255,255,255,0.45)", fontSize: 15,
              lineHeight: 23, marginTop: 14, fontWeight: "400",
            }}>
              {subtitle}
            </Text>
          )}

          {/* Children (inputs, cards, etc.) */}
          {children && (
            <View style={{ marginTop: 32 }}>
              {children}
            </View>
          )}
        </View>

        {/* Bottom actions */}
        <View style={{ gap: 12, marginTop: 24 }}>
          <Pressable
            onPress={onPrimary}
            disabled={primaryLoading || primaryDisabled}
            style={({ pressed }) => ({
              backgroundColor: primaryDisabled ? "#1E1E1E" : "#FF6B4A",
              borderRadius: 18, paddingVertical: 17,
              alignItems: "center", justifyContent: "center",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {primaryLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{
                color: primaryDisabled ? "#444" : "#fff",
                fontSize: 16, fontWeight: "700",
              }}>
                {primaryLabel}
              </Text>
            )}
          </Pressable>

          {skipLabel && onSkip && (
            <Pressable onPress={onSkip} style={{ alignItems: "center", paddingVertical: 6 }}>
              <Text style={{
                color: "rgba(255,255,255,0.25)", fontSize: 13, fontWeight: "500",
              }}>
                {skipLabel}
              </Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

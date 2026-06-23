import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface DarkOnboardingScaffoldProps {
  step: number;
  totalSteps: number;
  title: string;
  titleAccent?: string;      // word in the title to highlight purple
  subtitle?: string;
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  skipLabel?: string;
  onSkip?: () => void;
  /** Renders the primary/skip buttons right after `children` instead of
   *  pinned to the bottom of the screen — keeps the CTA next to the input
   *  it acts on. */
  buttonsInline?: boolean;
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
            backgroundColor: i < step ? "#9013BB" : "#E5E5E5",
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
  buttonsInline = false,
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

  const renderTitle = () => {
    if (!titleAccent) {
      return (
        <Text style={{ color: "#1A1A1A", fontSize: 34, fontWeight: "800", lineHeight: 40, letterSpacing: -1 }}>
          {title}
        </Text>
      );
    }
    const parts = title.split(titleAccent);
    return (
      <Text style={{ color: "#1A1A1A", fontSize: 34, fontWeight: "800", lineHeight: 40, letterSpacing: -1 }}>
        {parts[0]}
        <Text style={{ color: "#9013BB" }}>{titleAccent}</Text>
        {parts[1]}
      </Text>
    );
  };

  const actions = (
    <View style={{ gap: 12, marginTop: buttonsInline ? 24 : 0 }}>
      <Pressable
        onPress={onPrimary}
        disabled={primaryLoading || primaryDisabled}
        style={({ pressed }) => ({
          backgroundColor: "#9013BB",
          borderRadius: 18, paddingVertical: 17,
          alignItems: "center", justifyContent: "center",
          opacity: primaryDisabled ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        {primaryLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
            {primaryLabel}
          </Text>
        )}
      </Pressable>

      {skipLabel && onSkip && (
        <Pressable onPress={onSkip} style={{ alignItems: "center", paddingVertical: 6 }}>
          <Text style={{
            color: "rgba(26,26,26,0.35)", fontSize: 13, fontWeight: "500",
          }}>
            {skipLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      <Animated.View
        style={{
          flex: 1,
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          paddingTop: insets.top + 20,
          justifyContent: "space-between",
          paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
      >
        {/* Top content — scrollable so it can never push the bottom actions
            off-screen on shorter devices or content-heavy steps. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step dots */}
          <StepDots step={step} total={totalSteps} />

          {/* Title */}
          <View style={{ marginTop: 36 }}>
            {renderTitle()}
          </View>

          {/* Subtitle */}
          {subtitle && (
            <Text style={{
              color: "rgba(26,26,26,0.45)", fontSize: 15,
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

          {buttonsInline && actions}
        </ScrollView>

        {/* Bottom actions */}
        {!buttonsInline && (
          <View style={{ paddingHorizontal: 24 }}>
            {actions}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

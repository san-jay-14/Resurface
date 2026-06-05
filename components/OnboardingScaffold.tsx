import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Button } from "./Button";
import { Screen } from "./Screen";

interface OnboardingScaffoldProps {
  step: number; // 1-based
  totalSteps: number;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  /** Optional low-emphasis action shown under the primary button. */
  skipLabel?: string;
  onSkip?: () => void;
}

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <View className="flex-row gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          className={`h-2 rounded-full ${
            i < step ? "w-6 bg-coral" : "w-2 bg-line"
          }`}
        />
      ))}
    </View>
  );
}

export function OnboardingScaffold({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryLoading = false,
  primaryDisabled = false,
  skipLabel,
  onSkip,
}: OnboardingScaffoldProps) {
  return (
    <Screen className="justify-between py-6">
      <View className="mt-6">
        <StepDots step={step} total={totalSteps} />
        <Text className="mt-8 text-3xl font-extrabold text-ink">{title}</Text>
        {subtitle ? (
          <Text className="mt-3 text-base leading-6 text-muted">{subtitle}</Text>
        ) : null}
        <View className="mt-8">{children}</View>
      </View>

      <View className="gap-3 pb-2">
        <Button
          label={primaryLabel}
          onPress={onPrimary}
          loading={primaryLoading}
          disabled={primaryDisabled}
        />
        {skipLabel && onSkip ? (
          <Pressable onPress={onSkip} className="items-center py-2">
            <Text className="text-sm font-medium text-muted">{skipLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

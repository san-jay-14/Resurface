import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Optional leading element (e.g. a provider icon). */
  leading?: ReactNode;
}

const containerByVariant: Record<Variant, string> = {
  primary: "bg-coral active:bg-coral-dark",
  secondary: "bg-white border border-line active:bg-sand",
  ghost: "bg-transparent active:bg-coral-soft",
};

const textByVariant: Record<Variant, string> = {
  primary: "text-white",
  secondary: "text-ink",
  ghost: "text-coral-dark",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  leading,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      className={`h-14 flex-row items-center justify-center rounded-2xl px-5 ${
        containerByVariant[variant]
      } ${isDisabled ? "opacity-50" : ""}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : "#1C1714"} />
      ) : (
        <View className="flex-row items-center gap-3">
          {leading}
          <Text className={`text-base font-semibold ${textByVariant[variant]}`}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

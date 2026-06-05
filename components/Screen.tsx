import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Standard warm-cream screen frame with safe-area padding. */
export function Screen({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <View className={`flex-1 px-6 ${className}`}>{children}</View>
    </SafeAreaView>
  );
}

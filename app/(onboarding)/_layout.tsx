import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false, // keep users inside the flow until it's done
        contentStyle: { backgroundColor: "#FFF8F2" },
      }}
    />
  );
}

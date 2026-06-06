import { Stack } from "expo-router";

export default function ShareLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_bottom",
        contentStyle: { backgroundColor: "#FFF8F2" },
      }}
    />
  );
}

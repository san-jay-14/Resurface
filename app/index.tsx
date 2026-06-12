import { ActivityIndicator, View } from "react-native";

/**
 * Bare entry route. The routing gate in _layout.tsx immediately redirects to
 * the correct group (auth / onboarding / app) based on session state, so this
 * only ever shows for a frame.
 */
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-cream">
      <ActivityIndicator color="#9013BB" size="large" />
    </View>
  );
}

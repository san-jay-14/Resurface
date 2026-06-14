import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

interface Props {
  emoji: string;
  headline: string;
  subtext: string;
  dark?: boolean;
}

export function CategoryEmptyHeader({ emoji, headline, subtext, dark = false }: Props) {
  const floatY = useSharedValue(0);
  const glowOpacity = useSharedValue(0.4);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 1800 }),
        withTiming(0.3, { duration: 1800 })
      ),
      -1,
      false
    );
  }, []);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const bg = dark ? "rgba(255,255,255,0.07)" : "rgba(144,19,187,0.07)";
  const border = dark ? "rgba(255,255,255,0.1)" : "rgba(144,19,187,0.12)";
  const textColor = dark ? "#FFFFFF" : "#1A1A1A";
  const subtextColor = dark ? "rgba(255,255,255,0.45)" : "#888";

  return (
    <View style={{
      marginHorizontal: 16,
      borderRadius: 24,
      backgroundColor: bg,
      borderWidth: 1,
      borderColor: border,
      padding: 24,
      alignItems: "flex-start",
      overflow: "hidden",
    }}>
      {/* Glow behind emoji */}
      <Animated.View style={[{
        position: "absolute",
        width: 80, height: 80,
        borderRadius: 40,
        backgroundColor: "#9013BB",
        top: 10, left: 14,
        filter: [{ blur: 20 }],
      }, glowStyle]} />

      <Animated.Text style={[{ fontSize: 38, marginBottom: 14 }, floatStyle]}>
        {emoji}
      </Animated.Text>
      <Text style={{ fontSize: 17, fontWeight: "700", color: textColor, marginBottom: 6, letterSpacing: -0.2 }}>
        {headline}
      </Text>
      <Text style={{ fontSize: 13, color: subtextColor, lineHeight: 19 }}>
        {subtext}
      </Text>
    </View>
  );
}

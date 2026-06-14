import { Component } from "react";
import type { ReactNode } from "react";
import LottieView from "lottie-react-native";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOTTIE_SOURCE = require("../../assets/lottie/a6309fa0-1151-11ee-b271-bb42fb1b548d.lottie");

// ---------------------------------------------------------------------------
// Error boundary — catches "LottieAnimationView not in registry" crash that
// occurs when the dev client hasn't been rebuilt after installing lottie-react-native.
// Swap in a Reanimated fallback so the app stays usable. Once you run
// `npx expo run:android` / `npx expo run:ios` the real Lottie will appear.
// ---------------------------------------------------------------------------
class LottieBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

function PulsingDots() {
  const s1 = useSharedValue(0.4);
  const s2 = useSharedValue(0.4);
  const s3 = useSharedValue(0.4);

  useEffect(() => {
    const make = (sv: typeof s1, delay: number) => {
      sv.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      // stagger via initial hold — crude but works without delay API
      void delay;
    };
    make(s1, 0);
    setTimeout(() => make(s2, 160), 160);
    setTimeout(() => make(s3, 320), 320);
  }, []);

  const dot = (sv: typeof s1) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: sv.value, transform: [{ scale: sv.value }] }));

  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", height: 150 }}>
      {[s1, s2, s3].map((sv, i) => (
        <Animated.View
          key={i}
          style={[{
            width: 14, height: 14, borderRadius: 7,
            backgroundColor: "#9013BB",
          }, dot(sv)]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Time-based prompt
// ---------------------------------------------------------------------------
function getRecipePrompt(): string {
  const h = new Date().getHours();
  const d = new Date().getDay();
  const isWE = d === 0 || d === 6;
  const isFri = d === 5;
  let base: string;
  if (h >= 5 && h < 10)       base = "What's for breakfast?";
  else if (h >= 10 && h < 12)  base = isWE ? "Brunch ideas?" : "Quick lunch ideas?";
  else if (h >= 12 && h < 15)  base = "What's for lunch?";
  else if (h >= 15 && h < 18)  base = "Evening snack ideas?";
  else if (h >= 18 && h < 22)  base = "What's for dinner tonight?";
  else                          base = "Late night craving?";
  return (isWE ? "It's the weekend — " : isFri ? "Weekend's here — " : "") + base;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function RecipePromptHeader({ saveCount }: { saveCount: number }) {
  const prompt = getRecipePrompt();
  const countText =
    saveCount === 0
      ? "Share your first recipe reel to start"
      : `${saveCount} recipe ${saveCount === 1 ? "save" : "saves"} waiting for you`;

  return (
    <View style={{ paddingHorizontal: 20 }}>
      {/* Text above the animation */}
      <Text style={{
        fontSize: 22, fontWeight: "800", color: "#1A1A1A",
        letterSpacing: -0.4, lineHeight: 29,
      }}>
        {prompt}
      </Text>

      <Text style={{ fontSize: 13, fontWeight: "600", color: "#9013BB", marginTop: 5 }}>
        {countText}
      </Text>

      {/* Lottie — centred below the text */}
      <View style={{ alignItems: "center", marginTop: 10 }}>
        <LottieBoundary fallback={<PulsingDots />}>
          <LottieView
            source={LOTTIE_SOURCE}
            autoPlay
            loop
            style={{ width: 150, height: 150 }}
          />
        </LottieBoundary>
      </View>
    </View>
  );
}

import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LINES = [
  { text: "a few more steps", accent: false },
  { text: "to call", accent: false },
  { text: "dibs.", accent: true },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const anims = useRef(
    LINES.map(() => ({
      opacity: new Animated.Value(0),
      y: new Animated.Value(20),
    })),
  ).current;

  const subtitleAnim = useRef({
    opacity: new Animated.Value(0),
    y: new Animated.Value(12),
  }).current;

  useEffect(() => {
    const lineAnims = LINES.map((_, i) =>
      Animated.parallel([
        Animated.timing(anims[i].opacity, {
          toValue: 1, duration: 500, delay: i * 220, useNativeDriver: true,
        }),
        Animated.timing(anims[i].y, {
          toValue: 0, duration: 420, delay: i * 220, useNativeDriver: true,
        }),
      ]),
    );

    const subtitleIn = Animated.parallel([
      Animated.timing(subtitleAnim.opacity, {
        toValue: 1, duration: 400, delay: LINES.length * 220 + 100, useNativeDriver: true,
      }),
      Animated.timing(subtitleAnim.y, {
        toValue: 0, duration: 380, delay: LINES.length * 220 + 100, useNativeDriver: true,
      }),
    ]);

    Animated.sequence([
      Animated.parallel([...lineAnims, subtitleIn]),
      Animated.delay(900),
    ]).start(() => {
      router.replace("/(onboarding)/birthday");
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      <StatusBar style="light" />

      <View
        style={{
          flex: 1, justifyContent: "center",
          paddingHorizontal: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Animated lines */}
        {LINES.map((line, i) => (
          <Animated.Text
            key={i}
            style={{
              opacity: anims[i].opacity,
              transform: [{ translateY: anims[i].y }],
              color: line.accent ? "#FF6B4A" : "#fff",
              fontSize: 46,
              fontWeight: "900",
              lineHeight: 52,
              letterSpacing: -1.5,
            }}
          >
            {line.text}
          </Animated.Text>
        ))}

        {/* Subtitle */}
        <Animated.Text
          style={{
            opacity: subtitleAnim.opacity,
            transform: [{ translateY: subtitleAnim.y }],
            color: "rgba(255,255,255,0.35)",
            fontSize: 16,
            fontStyle: "italic",
            marginTop: 20,
          }}
        >
          this won't take long.
        </Animated.Text>
      </View>
    </View>
  );
}

import * as AppleAuthentication from "expo-apple-authentication";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

const { width: SCREEN_W } = Dimensions.get("window");

type Phase = "intro" | "auth";
type Pending = "google" | "apple" | null;

// ---------------------------------------------------------------------------
// Dibs wordmark badge
// ---------------------------------------------------------------------------
function DibsBadge() {
  return (
    <View style={{ width: 48, height: 48, borderRadius: 14, overflow: "hidden" }}>
      <Image
        source={require("@/assets/logo_d.png")}
        style={{ width: "100%", height: "100%" }}
        resizeMode="cover"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Intro phase — staggered text animations
// ---------------------------------------------------------------------------
function IntroPhase({ onGetStarted }: {
  onGetStarted: () => void;
}) {
  const insets = useSafeAreaInsets();

  const anims = useRef(
    Array.from({ length: 5 }, () => ({
      opacity: new Animated.Value(0),
      y: new Animated.Value(28),
    })),
  ).current;

  useEffect(() => {
    const delays = [120, 320, 520, 820, 1150];
    const animations = anims.map((a, i) =>
      Animated.parallel([
        Animated.timing(a.opacity, {
          toValue: 1, duration: 600, delay: delays[i], useNativeDriver: true,
        }),
        Animated.timing(a.y, {
          toValue: 0, duration: 500, delay: delays[i], useNativeDriver: true,
        }),
      ]),
    );
    Animated.parallel(animations).start();
  }, []);

  const line = (i: number, children: React.ReactNode) => (
    <Animated.View
      style={{ opacity: anims[i].opacity, transform: [{ translateY: anims[i].y }] }}
    >
      {children}
    </Animated.View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Badge */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 24 }}>
        {line(0, <DibsBadge />)}
      </View>

      {/* Headline */}
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 0 }}>
        {line(1,
          <Text style={{ color: "#1A1A1A", fontSize: 52, fontWeight: "900", lineHeight: 58, letterSpacing: -2 }}>
            you call dibs{"\n"}on everything.
          </Text>
        )}
        <View style={{ height: 6 }} />
        {line(2,
          <Text style={{ fontSize: 52, fontWeight: "900", lineHeight: 58, letterSpacing: -2 }}>
            <Text style={{ color: "#1A1A1A" }}>do </Text>
            <Text style={{ color: "#9013BB" }}>none</Text>
            <Text style={{ color: "#1A1A1A" }}>{"\n"}of it.</Text>
          </Text>
        )}
        <View style={{ height: 24 }} />
        {line(3,
          <Text style={{
            color: "rgba(26,26,26,0.45)", fontSize: 20,
            fontStyle: "italic", fontWeight: "400", letterSpacing: -0.3,
          }}>
            let's fix that.
          </Text>
        )}
      </View>

      {/* CTAs */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: Math.max(insets.bottom, 24) + 12,
          gap: 14,
        }}
      >
        {line(4,
          <Pressable
            onPress={onGetStarted}
            style={{
              backgroundColor: "#9013BB", borderRadius: 18,
              paddingVertical: 18,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.3 }}>
              get started
            </Text>
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>→</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Auth phase — sign-in options
// ---------------------------------------------------------------------------
function AuthPhase({
  onBack,
  pending,
  onGoogle,
  onApple,
}: {
  onBack: () => void;
  pending: Pending;
  onGoogle: () => void;
  onApple: () => void;
}) {
  const insets = useSafeAreaInsets();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={{
        flex: 1, backgroundColor: "#FFFFFF",
        opacity: fadeAnim, transform: [{ translateY: slideAnim }],
      }}
    >
      <StatusBar style="dark" />

      {/* Back */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20 }}>
        <Pressable onPress={onBack} hitSlop={12} style={{ alignSelf: "flex-start" }}>
          <Text style={{ color: "rgba(26,26,26,0.4)", fontSize: 28, lineHeight: 32 }}>←</Text>
        </Pressable>
      </View>

      {/* Brand */}
      <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, paddingBottom: 48 }}>
        <Image
          source={require("@/assets/logo_purple.png")}
          style={{ height: 46, width: 140, marginBottom: 20 }}
          resizeMode="contain"
        />
        <Text style={{
          color: "#1A1A1A", fontSize: 32, fontWeight: "800",
          lineHeight: 38, letterSpacing: -1, marginBottom: 8,
        }}>
          Save it.{"\n"}Actually do it.
        </Text>
        <Text style={{
          color: "rgba(26,26,26,0.4)", fontSize: 15,
          lineHeight: 21, fontWeight: "400",
        }}>
          The app that actually brings your saves back.
        </Text>
      </View>

      {/* Sign-in buttons */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: Math.max(insets.bottom, 24) + 12,
          gap: 12,
        }}
      >
        {/* Google */}
        <Pressable
          onPress={onGoogle}
          disabled={pending !== null}
          style={({ pressed }) => ({
            backgroundColor: "#9013BB", borderRadius: 18,
            paddingVertical: 17,
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
            opacity: pressed || (pending !== null && pending !== "google") ? 0.5 : 1,
          })}
        >
          {pending === "google" ? (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Signing in…</Text>
          ) : (
            <>
              <View
                style={{
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: "#fff",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Text style={{ color: "#4285F4", fontSize: 13, fontWeight: "800" }}>G</Text>
              </View>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                Sign in with Google
              </Text>
            </>
          )}
        </Pressable>

        {/* Apple (iOS only) */}
        {Platform.OS === "ios" && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={18}
            style={{ height: 54 }}
            onPress={onApple}
          />
        )}
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Root component — manages phase transitions
// ---------------------------------------------------------------------------
export default function SignIn() {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [phase, setPhase] = useState<Phase>("intro");
  const [pending, setPending] = useState<Pending>(null);

  const introOpacity = useRef(new Animated.Value(1)).current;

  const switchToAuth = () => {
    Animated.timing(introOpacity, {
      toValue: 0, duration: 280, useNativeDriver: true,
    }).start(() => setPhase("auth"));
  };

  const switchToIntro = () => {
    introOpacity.setValue(0);
    setPhase("intro");
    Animated.timing(introOpacity, {
      toValue: 1, duration: 300, useNativeDriver: true,
    }).start();
  };

  async function run(which: Exclude<Pending, null>, fn: () => Promise<void>) {
    try {
      setPending(which);
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      appAlert("Couldn't sign in", msg);
    } finally {
      setPending(null);
    }
  }

  if (phase === "intro") {
    return (
      <Animated.View style={{ flex: 1, opacity: introOpacity }}>
        <IntroPhase onGetStarted={switchToAuth} />
      </Animated.View>
    );
  }

  return (
    <AuthPhase
      onBack={switchToIntro}
      pending={pending}
      onGoogle={() => run("google", signInWithGoogle)}
      onApple={() => run("apple", signInWithApple)}
    />
  );
}

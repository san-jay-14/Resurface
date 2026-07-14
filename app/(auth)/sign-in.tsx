import * as AppleAuthentication from "expo-apple-authentication";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GoogleIcon from "@/components/GoogleIcon";
import { appAlert } from "@/providers/AlertProvider";
import { useAuth } from "@/providers/AuthProvider";

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
// Single welcome + sign-in screen
// ---------------------------------------------------------------------------
export default function SignIn() {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [pending, setPending] = useState<Pending>(null);
  const insets = useSafeAreaInsets();

  // Staggered entrance: badge, headline, sub-headline, subtitle, buttons.
  const anims = useRef(
    Array.from({ length: 5 }, () => ({
      opacity: new Animated.Value(0),
      y: new Animated.Value(28),
    })),
  ).current;

  useEffect(() => {
    const delays = [120, 320, 520, 820, 1120];
    Animated.parallel(
      anims.map((a, i) =>
        Animated.parallel([
          Animated.timing(a.opacity, {
            toValue: 1, duration: 600, delay: delays[i], useNativeDriver: true,
          }),
          Animated.timing(a.y, {
            toValue: 0, duration: 500, delay: delays[i], useNativeDriver: true,
          }),
        ]),
      ),
    ).start();
  }, []);

  const line = (i: number, children: React.ReactNode) => (
    <Animated.View
      style={{ opacity: anims[i].opacity, transform: [{ translateY: anims[i].y }] }}
    >
      {children}
    </Animated.View>
  );

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

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Badge */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 24 }}>
        {line(0, <DibsBadge />)}
      </View>

      {/* Headline — the crux, in one breath */}
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        {line(1,
          <Text style={{ color: "#1A1A1A", fontSize: 46, fontWeight: "900", lineHeight: 52, letterSpacing: -2 }}>
            you save it{"\n"}and forget it.
          </Text>
        )}
        <View style={{ height: 6 }} />
        {line(2,
          <Text style={{ fontSize: 46, fontWeight: "900", lineHeight: 52, letterSpacing: -2 }}>
            <Text style={{ color: "#9013BB" }}>dibs</Text>
            <Text style={{ color: "#1A1A1A" }}> brings{"\n"}it back.</Text>
          </Text>
        )}
        <View style={{ height: 20 }} />
        {line(3,
          <Text style={{
            color: "rgba(26,26,26,0.55)", fontSize: 17,
            lineHeight: 24, fontWeight: "500", letterSpacing: -0.3,
          }}>
            The links, reels and places you save{"\n"}—
            <Text style={{ color: "#1A1A1A", fontWeight: "700" }}> back right when they matter.</Text>
          </Text>
        )}
      </View>

      {/* Sign-in buttons */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: Math.max(insets.bottom, 24) + 12,
          gap: 12,
        }}
      >
        <Animated.View
          style={{
            width: "100%",
            gap: 12,
            opacity: anims[4].opacity,
            transform: [{ translateY: anims[4].y }],
          }}
        >
          {/* Google — primary */}
          <Pressable
            onPress={() => run("google", signInWithGoogle)}
            disabled={pending !== null}
            style={{
              width: "100%",
              alignSelf: "stretch",
              backgroundColor: "#9013BB",
              borderRadius: 18,
              paddingVertical: 18,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              shadowColor: "#9013BB",
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.3,
              shadowRadius: 14,
              elevation: 5,
              opacity: pending !== null && pending !== "google" ? 0.6 : 1,
            }}
          >
            {pending === "google" ? (
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>Signing in…</Text>
            ) : (
              <>
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    backgroundColor: "#fff",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <GoogleIcon size={18} />
                </View>
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.2 }}>
                  Continue with Google
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
              style={{ height: 54, width: "100%" }}
              onPress={() => run("apple", signInWithApple)}
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

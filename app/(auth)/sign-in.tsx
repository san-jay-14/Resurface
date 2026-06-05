import * as AppleAuthentication from "expo-apple-authentication";
import { useState } from "react";
import { Alert, Platform, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/providers/AuthProvider";

type Pending = "google" | "apple" | "guest" | null;

export default function SignIn() {
  const { signInWithGoogle, signInWithApple, signInAsGuest } = useAuth();
  const [pending, setPending] = useState<Pending>(null);

  async function run(which: Exclude<Pending, null>, fn: () => Promise<void>) {
    try {
      setPending(which);
      await fn();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      Alert.alert("Couldn't sign in", message);
    } finally {
      setPending(null);
    }
  }

  return (
    <Screen className="justify-between py-6">
      {/* Brand + promise */}
      <View className="mt-16">
        <Text className="text-5xl font-extrabold text-ink">Resurface</Text>
        <Text className="mt-4 text-lg leading-7 text-muted">
          Your saves, brought back at the right moment — when you&apos;re near
          that café, the week before your birthday, the evening before a long
          weekend.
        </Text>
      </View>

      {/* Sign-in options */}
      <View className="gap-3 pb-2">
        <Button
          label="Continue with Google"
          onPress={() => run("google", signInWithGoogle)}
          loading={pending === "google"}
          disabled={pending !== null}
        />

        {Platform.OS === "ios" && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
            }
            buttonStyle={
              AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={16}
            style={{ height: 56 }}
            onPress={() => run("apple", signInWithApple)}
          />
        )}

        <Button
          label="Just start saving"
          variant="secondary"
          onPress={() => run("guest", signInAsGuest)}
          loading={pending === "guest"}
          disabled={pending !== null}
        />
        <Text className="mt-1 text-center text-sm text-muted">
          No account needed to start. You can sign in later to keep your saves
          safe.
        </Text>
      </View>
    </Screen>
  );
}

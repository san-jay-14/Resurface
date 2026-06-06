import * as AppleAuthentication from "expo-apple-authentication";
import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";

import type { UserProfile } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

// Required so the OAuth popup can hand control back to the app on Android.
WebBrowser.maybeCompleteAuthSession();

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  /** True until the initial session + profile load settles. */
  initializing: boolean;
  /** True while a profile row fetch is in flight. */
  profileLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Deep link the OAuth provider redirects back to. Explicit scheme so it
 *  works in dev builds and production (makeRedirectUri without args can
 *  return an exp:// URL in some environments). */
const redirectTo = makeRedirectUri({ scheme: "resurface" });

/** Exchange the ?code= from an OAuth redirect URL for a Supabase session. */
async function createSessionFromUrl(url: string) {
  const { queryParams } = Linking.parse(url);
  const code = queryParams?.code;
  if (typeof code === "string") {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.warn("Failed to load profile:", error.message);
        setProfile(null);
        return;
      }
      setProfile((data as UserProfile) ?? null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Initial session + auth state subscription.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user.id);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) {
          await loadProfile(nextSession.user.id);
        } else {
          setProfile(null);
        }
      },
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // On Android with singleTask launch mode (required by expo-share-intent),
  // the OAuth deep link arrives as a new Intent rather than being caught by
  // openAuthSessionAsync. This listener handles that path so the ?code= is
  // always exchanged for a session regardless of how Android delivers the link.
  useEffect(() => {
    // App opened cold via the deep link (rare but possible)
    Linking.getInitialURL().then((url) => {
      if (url?.includes("code=")) void createSessionFromUrl(url);
    });

    // App already running and brought to foreground via the deep link
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url.includes("code=")) void createSessionFromUrl(url);
    });

    return () => sub.remove();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("No OAuth URL returned from Supabase.");

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "success") {
      await createSessionFromUrl(result.url);
    }
    // result.type === "cancel" | "dismiss": user backed out — no-op.
  }, []);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== "ios") {
      throw new Error("Apple Sign-In is only available on iOS.");
    }
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error("Apple did not return an identity token.");
    }
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });
    if (error) throw error;
  }, []);

  const signInAsGuest = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      initializing,
      profileLoading,
      signInWithGoogle,
      signInWithApple,
      signInAsGuest,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      initializing,
      profileLoading,
      signInWithGoogle,
      signInWithApple,
      signInAsGuest,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

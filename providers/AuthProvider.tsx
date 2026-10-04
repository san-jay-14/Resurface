import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { ApiError, setUnauthorizedHandler } from "@/lib/api";
import { authClient } from "@/lib/auth";
import type { UserProfile } from "@/lib/database.types";
import { env } from "@/lib/env";
import { unregisterDeviceToken } from "@/lib/notifications";
import { fetchProfile } from "@/lib/profile";
import { getShareToken, provisionShareToken, revokeShareToken } from "@/lib/shareToken";

interface AuthSession {
  user: { id: string; name: string; email: string; image?: string | null };
}

interface AuthContextValue {
  session: AuthSession | null;
  profile: UserProfile | null;
  /** True until the initial session + profile load settles. */
  initializing: boolean;
  /** Resolves to false when the user dismissed the sign-in sheet. */
  signInWithGoogle: () => Promise<boolean>;
  signInWithApple: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Replace the cached profile with a fresher copy (e.g. a PATCH /v1/me response). */
  setProfile: (profile: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  if (!env.googleWebClientId) {
    throw new Error("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set.");
  }
  // The WEB client id is the token audience the API verifies; Android picks its own client by SHA-1.
  GoogleSignin.configure({ webClientId: env.googleWebClientId });
  googleConfigured = true;
}

/** Throw a readable error for a failed Better Auth call. */
function assertOk(result: { error?: { message?: string; status?: number } | null }) {
  if (result.error) {
    throw new Error(result.error.message ?? "Sign-in failed. Please try again.");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const session = (data as AuthSession | null | undefined) ?? null;
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  // Profile follows the session. `profileReady` keeps `initializing` true until the first
  // profile fetch for a signed-in user settles, so the routing gate never sees "no profile yet".
  useEffect(() => {
    if (isPending) return;
    if (!userId) {
      setProfile(null);
      setProfileReady(true);
      return;
    }
    let cancelled = false;
    setProfileReady(false);
    fetchProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch((err: unknown) => {
        console.warn("Failed to load profile:", err);
        if (!cancelled) setProfile(null);
      })
      .finally(() => !cancelled && setProfileReady(true));
    return () => {
      cancelled = true;
    };
  }, [isPending, userId]);

  // The Android share worker authenticates with a scoped token; make sure one exists.
  const provisioned = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || provisioned.current === userId) return;
    provisioned.current = userId;
    void (async () => {
      try {
        if (!(await getShareToken())) await provisionShareToken();
      } catch (err) {
        provisioned.current = null;
        console.warn("Failed to provision share token:", err);
      }
    })();
  }, [userId]);

  // The API rejected our session (expired or revoked elsewhere): drop it locally.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void authClient.signOut().catch(() => undefined);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfile(await fetchProfile());
  }, [userId]);

  const signInWithGoogle = useCallback(async () => {
    configureGoogle();
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return false; // user cancelled
      const idToken = response.data.idToken;
      if (!idToken) throw new Error("Google did not return an identity token.");
      assertOk(await authClient.signIn.social({ provider: "google", idToken: { token: idToken } }));
      return true;
    } catch (err) {
      if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return false;
      throw err;
    }
  }, []);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== "ios") {
      throw new Error("Apple Sign-In is only available on iOS.");
    }
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return false;
      throw err;
    }
    if (!credential.identityToken) {
      throw new Error("Apple did not return an identity token.");
    }
    assertOk(
      await authClient.signIn.social({
        provider: "apple",
        idToken: { token: credential.identityToken },
      }),
    );
    return true;
  }, []);

  const signOut = useCallback(async () => {
    // Best effort and BEFORE the session goes away (these calls need it): a failure must never
    // trap the user in a signed-in state.
    await Promise.allSettled([revokeShareToken(), unregisterDeviceToken()]);
    if (googleConfigured) await GoogleSignin.signOut().catch(() => undefined);
    await authClient.signOut();
    provisioned.current = null;
    setProfile(null);
  }, []);

  const initializing = isPending || !profileReady;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      initializing,
      signInWithGoogle,
      signInWithApple,
      signOut,
      refreshProfile,
      setProfile,
    }),
    [session, profile, initializing, signInWithGoogle, signInWithApple, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** True when an error is the API reporting `code` (e.g. `invalid_invite_code`). */
export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as ExpoCrypto from "expo-crypto";
import { AppState } from "react-native";

// Supabase's PKCE flow needs crypto.subtle.digest for SHA-256.
// Hermes doesn't expose it, so polyfill it with expo-crypto.
if (typeof globalThis.crypto === "undefined") {
  (globalThis as unknown as Record<string, unknown>).crypto = ExpoCrypto;
} else if (typeof globalThis.crypto.subtle === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis.crypto as any).subtle = (ExpoCrypto as any).subtle;
}

import { env } from "./env";

/**
 * Supabase client for React Native.
 *
 * - AsyncStorage persists the session across launches.
 * - detectSessionInUrl is false (no browser URL to parse on native).
 * - autoRefreshToken keeps the access token alive while the app is foregrounded.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE: OAuth redirects come back as ?code=… which we exchange for a session.
    flowType: "pkce",
  },
});

// Supabase only auto-refreshes the token while it's actively told the app is in
// the foreground. Wire that to AppState so refresh pauses in the background.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

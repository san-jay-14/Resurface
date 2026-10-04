import "react-native-url-polyfill/auto";

import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { env } from "./env";

/**
 * Better Auth client. The session lives in SecureStore (never AsyncStorage) and is sent to the API
 * as a Cookie header (see `lib/api.ts`), not through the platform cookie jar.
 */
export const authClient = createAuthClient({
  baseURL: env.apiUrl,
  plugins: [
    expoClient({
      scheme: "resurface",
      storagePrefix: "dibs",
      storage: SecureStore,
    }),
  ],
});

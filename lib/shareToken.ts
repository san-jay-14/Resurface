import AsyncStorage from "@react-native-async-storage/async-storage";

import { api, send } from "@/lib/api";

/**
 * The Android share worker and headless task run without the app UI (and without its session), so
 * they authenticate with a scoped, revocable share token: it can only call `POST /v1/saves/enqueue`.
 *
 * The native SaveWorker reads this exact AsyncStorage key straight out of RKStorage. Keep in sync
 * with STORAGE_KEY in plugins/withHeadlessShare.js.
 */
export const SHARE_TOKEN_KEY = "dibs.share";

/** Mint a fresh share token for this device and store it. Call after every sign-in. */
export async function provisionShareToken(): Promise<void> {
  const { token } = await api.post<{ token: string }>("/share-token", { label: "android-share" });
  await AsyncStorage.setItem(SHARE_TOKEN_KEY, token);
  // The server keeps at most 10 active tokens per user and evicts the oldest, so replacing the
  // stored one needs no explicit revoke.
}

export const getShareToken = () => AsyncStorage.getItem(SHARE_TOKEN_KEY);

/** Forget the local token and revoke every token server-side. Call BEFORE the session is destroyed. */
export async function revokeShareToken(): Promise<void> {
  await AsyncStorage.removeItem(SHARE_TOKEN_KEY);
  await api.delete("/share-token");
}

/**
 * Enqueue a shared URL using only the share token (no session): the path used by the headless
 * share task. Returns null when no token is stored, i.e. the user isn't signed in.
 */
export async function enqueueWithShareToken(
  url: string,
): Promise<{ saveId: string; created: boolean } | null> {
  const token = await getShareToken();
  if (!token) return null;
  const r = await send<{ save_id: string; created: boolean }>(
    "POST",
    "/saves/enqueue",
    { Authorization: `ShareToken ${token}` },
    { body: { url } },
  );
  return { saveId: r.save_id, created: r.created };
}

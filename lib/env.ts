/**
 * Centralised, validated access to public env vars.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time. We read them once here
 * so the rest of the app imports typed constants instead of poking at process.env.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.startsWith("YOUR-")) {
    // Throwing here (rather than later, deep in a network call) makes a missing
    // .env obvious immediately. See SETUP.md / .env.example.
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env and fill in real values.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    "EXPO_PUBLIC_SUPABASE_URL",
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  // Optional — only needed once the respective feature is wired up.
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "",
  // Mapbox public token — required for the Places map view.
  // Get yours at https://console.mapbox.com/account/access-tokens/
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",
};

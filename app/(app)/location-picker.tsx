import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

// ---------------------------------------------------------------------------
// City data
// ---------------------------------------------------------------------------
interface City {
  name: string;
  icon: string;
  lat: number;
  lng: number;
  popular?: boolean;
}

const CITIES: City[] = [
  // Popular Indian cities
  { name: "Mumbai",      icon: "🏙️", lat: 19.0760,  lng: 72.8777,  popular: true },
  { name: "Delhi",       icon: "🕌", lat: 28.6139,  lng: 77.2090,  popular: true },
  { name: "Bengaluru",   icon: "🌳", lat: 12.9716,  lng: 77.5946,  popular: true },
  { name: "Hyderabad",   icon: "🍖", lat: 17.3850,  lng: 78.4867,  popular: true },
  { name: "Chandigarh",  icon: "🌻", lat: 30.7333,  lng: 76.7794,  popular: true },
  { name: "Ahmedabad",   icon: "🪁", lat: 23.0225,  lng: 72.5714,  popular: true },
  { name: "Pune",        icon: "🎓", lat: 18.5204,  lng: 73.8567,  popular: true },
  { name: "Chennai",     icon: "🌊", lat: 13.0827,  lng: 80.2707,  popular: true },
  { name: "Kolkata",     icon: "🎨", lat: 22.5726,  lng: 88.3639,  popular: true },
  { name: "Kochi",       icon: "⛵", lat: 9.9312,   lng: 76.2673,  popular: true },
  // Other cities
  { name: "Jaipur",      icon: "🏰", lat: 26.9124,  lng: 75.7873 },
  { name: "Goa",         icon: "🏖️", lat: 15.2993,  lng: 74.1240 },
  { name: "Surat",       icon: "💎", lat: 21.1702,  lng: 72.8311 },
  { name: "Lucknow",     icon: "🌹", lat: 26.8467,  lng: 80.9462 },
  { name: "Indore",      icon: "🍛", lat: 22.7196,  lng: 75.8577 },
  { name: "Nagpur",      icon: "🍊", lat: 21.1458,  lng: 79.0882 },
  { name: "Bhopal",      icon: "🌿", lat: 23.2599,  lng: 77.4126 },
  { name: "Patna",       icon: "🏛️", lat: 25.5941,  lng: 85.1376 },
  { name: "Bhubaneswar", icon: "⛩️", lat: 20.2961,  lng: 85.8245 },
  { name: "Coimbatore",  icon: "🏭", lat: 11.0168,  lng: 76.9558 },
  { name: "Visakhapatnam", icon: "🌊", lat: 17.6868, lng: 83.2185 },
  { name: "Thiruvananthapuram", icon: "🌴", lat: 8.5241, lng: 76.9366 },
  { name: "Mysuru",      icon: "👑", lat: 12.2958,  lng: 76.6394 },
  { name: "Vadodara",    icon: "🎪", lat: 22.3072,  lng: 73.1812 },
  { name: "Agra",        icon: "🕌", lat: 27.1767,  lng: 78.0081 },
  { name: "Varanasi",    icon: "🪔", lat: 25.3176,  lng: 82.9739 },
  { name: "Amritsar",    icon: "✨", lat: 31.6340,  lng: 74.8723 },
  { name: "Jodhpur",     icon: "🔵", lat: 26.2389,  lng: 73.0243 },
  { name: "Udaipur",     icon: "🏯", lat: 24.5854,  lng: 73.7125 },
  { name: "Ranchi",      icon: "🌲", lat: 23.3441,  lng: 85.3096 },
  { name: "Guwahati",    icon: "🐘", lat: 26.1445,  lng: 91.7362 },
  { name: "Dehradun",    icon: "🏔️", lat: 30.3165,  lng: 78.0322 },
  { name: "Shimla",      icon: "❄️", lat: 31.1048,  lng: 77.1734 },
  { name: "Mangaluru",   icon: "🌺", lat: 12.9141,  lng: 74.8560 },
  { name: "Raipur",      icon: "🌾", lat: 21.2514,  lng: 81.6296 },
];

const POPULAR_CITIES = CITIES.filter((c) => c.popular);
const OTHER_CITIES = CITIES.filter((c) => !c.popular).sort((a, b) => a.name.localeCompare(b.name));

export default function LocationPickerScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // mode=home  → updates home_city (used from Settings)
  // mode=current (default) → updates current_city (used from home screen)
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isHomeMode = mode === "home";

  const [query, setQuery] = useState("");
  const [detecting, setDetecting] = useState(false);

  // Fire an immediate local notification when the user manually sets their
  // current city, so they don't have to wait for the nightly cron run.
  async function notifyPlacesInCity(cityName: string) {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted" || !session) return;

    const { data: locationRows } = await supabase
      .from("save_locations")
      .select("save_id, place_name")
      .ilike("city", `%${cityName}%`);

    if (!locationRows?.length) return;

    const saveIds = locationRows.map((r) => r.save_id as string);

    const { data: saves } = await supabase
      .from("saves")
      .select("id, title, ai_description, caption")
      .eq("user_id", session.user.id)
      .in("category", ["places", "fashion"])
      .eq("acted_on", false)
      .eq("archived", false)
      .in("id", saveIds)
      .limit(5);

    if (!saves?.length) return;

    const firstName = (profile?.name ?? "").split(" ")[0] || "";
    const top = saves[0];
    const label = top.title ?? top.ai_description ?? top.caption ?? "a spot";

    const title = firstName
      ? `${firstName}, you're in ${cityName}!`
      : `You're in ${cityName}!`;
    const body = saves.length === 1
      ? `You saved "${label}" here — want to check it out?`
      : `You've got ${saves.length} saves in ${cityName}, including "${label}". Go explore?`;

    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { save_id: top.id, trigger_type: "city_select" }, sound: "default" },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2 },
    });
  }

  const filteredCities = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return CITIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [query]);

  async function selectCity(city: City) {
    if (!session) return;
    if (isHomeMode) {
      await supabase.from("users").update({
        home_city: city.name,
        home_city_lat: city.lat,
        home_city_lng: city.lng,
      }).eq("id", session.user.id);
    } else {
      await supabase.from("users").update({
        current_city: city.name,
        current_city_lat: city.lat,
        current_city_lng: city.lng,
        current_city_updated_at: new Date().toISOString(),
      }).eq("id", session.user.id);
      void notifyPlacesInCity(city.name); // immediate notification, fire-and-forget
    }
    await refreshProfile();
    router.back();
  }

  async function autoDetect() {
    setDetecting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location denied", "Please enable location access in Settings.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const rev = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      const cityName = rev[0]?.city ?? rev[0]?.subregion ?? rev[0]?.region ?? "Unknown";

      if (!session) return;
      if (isHomeMode) {
        await supabase.from("users").update({
          home_city: cityName,
          home_city_lat: loc.coords.latitude,
          home_city_lng: loc.coords.longitude,
        }).eq("id", session.user.id);
      } else {
        await supabase.from("users").update({
          current_city: cityName,
          current_city_lat: loc.coords.latitude,
          current_city_lng: loc.coords.longitude,
          current_city_updated_at: new Date().toISOString(),
        }).eq("id", session.user.id);
        void notifyPlacesInCity(cityName);
      }
      await refreshProfile();
      router.back();
    } catch {
      Alert.alert("Couldn't detect", "Try selecting your city manually.");
    } finally {
      setDetecting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        flexDirection: "row", alignItems: "center", gap: 12,
        borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#1A1A1A", flex: 1 }}>
          {isHomeMode ? "Change home city" : "Where are you?"}
        </Text>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 10,
          backgroundColor: "#F5F5F5", borderRadius: 14,
          paddingHorizontal: 14, paddingVertical: 12,
        }}>
          <Ionicons name="search-outline" size={18} color="#888" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search for your city"
            placeholderTextColor="#888"
            autoFocus
            autoCorrect={false}
            style={{ flex: 1, fontSize: 15, color: "#1A1A1A" }}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#888" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Auto-detect */}
      <Pressable
        onPress={autoDetect}
        disabled={detecting}
        style={{
          flexDirection: "row", alignItems: "center", gap: 12,
          paddingHorizontal: 16, paddingVertical: 14,
          marginHorizontal: 16, marginBottom: 8,
          backgroundColor: "#F0E8F7", borderRadius: 14,
        }}
      >
        {detecting
          ? <ActivityIndicator size="small" color="#9013BB" />
          : <Ionicons name="locate" size={20} color="#9013BB" />
        }
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#9013BB" }}>
          {detecting ? "Detecting your location…" : "Auto Detect My Location"}
        </Text>
      </Pressable>

      {/* Search results */}
      {filteredCities ? (
        <FlatList
          data={filteredCities}
          keyExtractor={(c) => c.name}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void selectCity(item)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 14,
                paddingHorizontal: 16, paddingVertical: 14,
                borderBottomWidth: 1, borderBottomColor: "#F5F5F5",
              }}
            >
              <Text style={{ fontSize: 22 }}>{item.icon}</Text>
              <Text style={{ fontSize: 15, color: "#1A1A1A" }}>{item.name}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: "center" }}>
              <Text style={{ color: "#888", fontSize: 14 }}>No cities found for "{query}"</Text>
            </View>
          }
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* Popular cities grid */}
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#888", letterSpacing: 0.8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
            POPULAR CITIES
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 0 }}>
            {POPULAR_CITIES.map((city) => (
              <Pressable
                key={city.name}
                onPress={() => void selectCity(city)}
                style={{ width: "25%", alignItems: "center", paddingVertical: 14, gap: 6 }}
              >
                <View style={{
                  width: 52, height: 52, borderRadius: 14,
                  backgroundColor: "#F5F5F5",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 24 }}>{city.icon}</Text>
                </View>
                <Text style={{ fontSize: 11, color: "#1A1A1A", textAlign: "center" }} numberOfLines={1}>
                  {city.name}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Other cities list */}
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#888", letterSpacing: 0.8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
            OTHER CITIES
          </Text>
          {OTHER_CITIES.map((city) => (
            <Pressable
              key={city.name}
              onPress={() => void selectCity(city)}
              style={{
                paddingHorizontal: 16, paddingVertical: 14,
                borderBottomWidth: 1, borderBottomColor: "#F5F5F5",
              }}
            >
              <Text style={{ fontSize: 15, color: "#1A1A1A" }}>{city.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

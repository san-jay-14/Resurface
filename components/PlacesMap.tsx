// Requires @rnmapbox/maps and a native rebuild (npx expo prebuild --clean).
// MapView will show a blank screen in Expo Go — use a development build.

import React, { memo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Mapbox, { Camera, MapView, MarkerView } from "@rnmapbox/maps";

import type { PlaceSave } from "@/lib/database.types";
import { env } from "@/lib/env";

Mapbox.setAccessToken(env.mapboxToken);

const DEFAULT_CAMERA = {
  centerCoordinate: [78.9629, 20.5937] as [number, number], // India centre [lng, lat]
  zoomLevel: 4.5,
};

// ─── helpers ────────────────────────────────────────────────────────────────

function getCameraBounds(saves: PlaceSave[]) {
  if (saves.length === 0) return DEFAULT_CAMERA;

  const lats = saves.map((s) => s.lat);
  const lngs = saves.map((s) => s.lng);
  return {
    bounds: {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
    },
    padding: { top: 60, bottom: 160, left: 40, right: 40 },
  };
}

function getCitiesFromSaves(saves: PlaceSave[]): string[] {
  const cities = saves.map((s) => s.location_city).filter(Boolean) as string[];
  return ["All", ...Array.from(new Set(cities)).sort()];
}

// ─── PinBubble ───────────────────────────────────────────────────────────────

const PinBubble = memo(function PinBubble({ save }: { save: PlaceSave }) {
  const visited = save.acted_on;
  const label =
    save.location_name.length > 18
      ? save.location_name.slice(0, 17) + "…"
      : save.location_name;

  return (
    <View style={pinStyles.wrapper}>
      <View style={[pinStyles.bubble, visited && pinStyles.bubbleVisited]}>
        <Text
          style={[pinStyles.text, visited && pinStyles.textVisited]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <View style={[pinStyles.tail, visited && pinStyles.tailVisited]} />
    </View>
  );
});

const pinStyles = StyleSheet.create({
  wrapper: { alignItems: "center" },
  bubble: {
    backgroundColor: "#FF6B35",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
  },
  bubbleVisited: {
    backgroundColor: "rgba(40,40,40,0.85)",
    borderColor: "rgba(255,255,255,0.1)",
  },
  text: { color: "#fff", fontSize: 11, fontWeight: "500" },
  textVisited: { color: "rgba(255,255,255,0.35)" },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#FF6B35",
    marginTop: -1,
  },
  tailVisited: { borderTopColor: "rgba(40,40,40,0.85)" },
});

// ─── PlacesMap ───────────────────────────────────────────────────────────────

type Props = {
  saves: PlaceSave[];
  unmappedCount: number;
  loading?: boolean;
  onPinPress: (save: PlaceSave) => void;
  onAddLocationPress: (save: PlaceSave) => void;
};

export const PlacesMap = memo(function PlacesMap({
  saves,
  unmappedCount,
  loading,
  onPinPress,
}: Props) {
  const cameraRef = useRef<Camera>(null);
  const [selectedCity, setSelectedCity] = useState<string>("All");
  const cities = getCitiesFromSaves(saves);

  function flyToCity(city: string) {
    setSelectedCity(city);
    const citySaves = city === "All" ? saves : saves.filter((s) => s.location_city === city);
    if (citySaves.length === 0) return;

    const bounds = getCameraBounds(citySaves);
    if (!("bounds" in bounds)) return;

    cameraRef.current?.fitBounds(
      bounds.bounds.ne,
      bounds.bounds.sw,
      [bounds.padding.top, bounds.padding.right, bounds.padding.bottom, bounds.padding.left],
      600,
    );
  }

  // Empty states
  if (!loading && saves.length === 0 && unmappedCount === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📍</Text>
        <Text style={styles.emptyTitle}>No places saved yet</Text>
        <Text style={styles.emptyBody}>
          Share an Instagram reel of a café, restaurant, or destination to Dibs — it'll show up here.
        </Text>
      </View>
    );
  }

  if (!loading && saves.length === 0 && unmappedCount > 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📍</Text>
        <Text style={styles.emptyTitle}>No spots mapped yet</Text>
        <Text style={styles.emptyBody}>
          Your next saves will appear here automatically when location data is available.
        </Text>
      </View>
    );
  }

  const initialBounds = getCameraBounds(saves);

  return (
    <View style={styles.container}>
      <MapView
        styleURL="mapbox://styles/mapbox/dark-v11"
        style={styles.map}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
      >
        <Camera
          ref={cameraRef}
          {...("bounds" in initialBounds
            ? {
                bounds: {
                  ...initialBounds.bounds,
                  paddingTop: initialBounds.padding.top,
                  paddingBottom: initialBounds.padding.bottom,
                  paddingLeft: initialBounds.padding.left,
                  paddingRight: initialBounds.padding.right,
                },
              }
            : { centerCoordinate: DEFAULT_CAMERA.centerCoordinate, zoomLevel: DEFAULT_CAMERA.zoomLevel })}
          animationMode="none"
        />

        {saves.map((save) => (
          <MarkerView
            key={save.id}
            coordinate={[save.lng, save.lat]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <Pressable onPress={() => onPinPress(save)}>
              <PinBubble save={save} />
            </Pressable>
          </MarkerView>
        ))}
      </MapView>

      {/* City filter pills — absolute overlay */}
      <View style={styles.cityFilterContainer} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cityFilterContent}
          pointerEvents="auto"
        >
          {cities.map((city) => (
            <Pressable
              key={city}
              onPress={() => flyToCity(city)}
              style={[
                styles.cityPill,
                selectedCity === city && styles.cityPillActive,
              ]}
            >
              <Text
                style={[
                  styles.cityPillText,
                  selectedCity === city && styles.cityPillTextActive,
                ]}
              >
                {city}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#FF6B35" size="small" />
        </View>
      )}

      {/* Unmapped count note */}
      {unmappedCount > 0 && (
        <View style={styles.unmappedNote} pointerEvents="none">
          <Text style={styles.unmappedText}>
            {unmappedCount} {unmappedCount === 1 ? "place" : "places"} couldn't be mapped — no location data.
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  cityFilterContainer: {
    position: "absolute",
    top: 12,
    left: 0,
    right: 0,
  },
  cityFilterContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  cityPill: {
    backgroundColor: "rgba(30,30,30,0.85)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  cityPillActive: {
    backgroundColor: "#FF6B35",
    borderColor: "transparent",
  },
  cityPillText: { color: "#aaa", fontSize: 13, fontWeight: "500" },
  cityPillTextActive: { color: "#fff" },

  loadingOverlay: {
    position: "absolute",
    top: "50%",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 12,
    borderRadius: 12,
  },

  unmappedNote: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    backgroundColor: "rgba(20,20,20,0.85)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  unmappedText: { color: "#888", fontSize: 12 },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16, opacity: 0.4 },
  emptyTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  emptyBody: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});

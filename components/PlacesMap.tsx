// Requires @rnmapbox/maps and a native rebuild (npx expo prebuild --clean).
// MapView will show a blank screen in Expo Go — use a development build.

import React, { memo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Mapbox, { Camera, MapView, MarkerView } from "@rnmapbox/maps";

import type { PlaceSave } from "@/lib/database.types";
import { env } from "@/lib/env";

// Token init is safe at module level once the package is installed.
// If the native module isn't built yet (Expo Go / no prebuild), this will
// throw — the component catches it via the error boundary in BoardView.
try {
  Mapbox.setAccessToken(env.mapboxToken);
} catch {
  // Native Mapbox module not available yet — needs npx expo prebuild + rebuild.
}

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
    backgroundColor: "#9013BB",
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
    borderTopColor: "#9013BB",
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

  const isEmpty = !loading && saves.length === 0;
  const emptyMessage =
    unmappedCount > 0
      ? { title: "No spots mapped yet", body: "Your next saves will appear here automatically when location data is available." }
      : { title: "No places saved yet", body: "Share an Instagram reel of a café, restaurant, or destination to Dibs — it'll show up here." };

  const initialBounds = getCameraBounds(saves);

  return (
    <View style={styles.container}>
      <MapView
        styleURL="mapbox://styles/sanjay14/cmq8aymq5002k01qw5peha5jq"
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

      {/* Empty state — floats over the map so the map is still visible/pannable */}
      {isEmpty && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📍</Text>
            <Text style={styles.emptyTitle}>{emptyMessage.title}</Text>
            <Text style={styles.emptyBody}>{emptyMessage.body}</Text>
          </View>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#9013BB" size="small" />
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

  emptyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 80,
    paddingHorizontal: 32,
  },
  emptyCard: {
    backgroundColor: "rgba(20,20,20,0.88)",
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyIcon: { fontSize: 40, marginBottom: 12, opacity: 0.5 },
  emptyTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
  },
  emptyBody: {
    color: "#888",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
});

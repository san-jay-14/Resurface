import { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { PlaceSave } from "@/lib/database.types";

type Props = {
  save: PlaceSave;
  onDismiss: () => void;
  onMarkVisited: (saveId: string) => void;
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const months = Math.floor(ms / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return "this month";
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function PlaceDetailCard({ save, onDismiss, onMarkVisited }: Props) {
  const slideY = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    }).start();
  }, [slideY]);

  function dismiss() {
    Animated.timing(slideY, {
      toValue: 300,
      duration: 200,
      useNativeDriver: true,
    }).start(onDismiss);
  }

  return (
    <Pressable style={styles.backdrop} onPress={dismiss}>
      <Animated.View
        style={[styles.card, { transform: [{ translateY: slideY }] }]}
        // Prevent backdrop tap from firing when tapping inside the card
        onStartShouldSetResponder={() => true}
      >
        {/* Thumbnail */}
        {save.thumbnail_url ? (
          <Image
            source={{ uri: save.thumbnail_url }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailFallback]}>
            <Text style={{ fontSize: 36 }}>📍</Text>
          </View>
        )}

        {/* Details */}
        <View style={styles.body}>
          <Text style={styles.locationName} numberOfLines={1}>
            {save.location_name}
          </Text>
          <Text style={styles.meta}>
            {[save.location_city, "places"].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.timeAgo}>Saved {timeAgo(save.created_at)}</Text>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, save.acted_on && styles.btnDisabled]}
              onPress={() => {
                if (!save.acted_on) onMarkVisited(save.id);
              }}
              disabled={save.acted_on}
            >
              <Text style={[styles.btnText, save.acted_on && styles.btnTextDisabled]}>
                {save.acted_on ? "Visited ✓" : "Mark as visited"}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnOutline]}
              onPress={() => {
                if (save.source_url) void Linking.openURL(save.source_url);
              }}
              disabled={!save.source_url}
            >
              <Text style={styles.btnOutlineText}>Open original reel →</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: 80,
  },
  thumbnailFallback: {
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    padding: 16,
    gap: 4,
  },
  locationName: {
    color: "#1A1A1A",
    fontSize: 15,
    fontWeight: "500",
  },
  meta: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  timeAgo: {
    color: "#888",
    fontSize: 10,
    marginTop: 2,
    marginBottom: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    backgroundColor: "#9013BB",
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDisabled: {
    backgroundColor: "#F0F0F0",
  },
  btnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  btnTextDisabled: {
    color: "#888",
  },
  btnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  btnOutlineText: {
    color: "#888",
    fontSize: 13,
    fontWeight: "500",
  },
});

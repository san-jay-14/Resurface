import { Dimensions, Image, StyleSheet, View } from "react-native";

import { CategoryEmptyHeader } from "./CategoryEmptyHeader";
import type { Save } from "@/lib/database.types";

interface Props {
  saves: Save[];
}

const SCREEN_W = Dimensions.get("window").width;
const TILE = 90;
const GAP = 3;
const STRIDE = TILE + GAP;
const COLS = Math.ceil(SCREEN_W / STRIDE) + 1; // +1 so right edge always bleeds off screen
const ROWS = 6;

export function InspoCollageHeader({ saves }: Props) {
  const thumbs = saves
    .filter((s) => !!s.thumbnail_url)
    .map((s) => s.thumbnail_url as string);

  if (thumbs.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <CategoryEmptyHeader
          emoji="💫"
          headline="Your inspo board is empty"
          subtext="Share mood boards, aesthetics, and reels to fill it up"
          dark
        />
      </View>
    );
  }

  // Tile enough images to fill the grid (repeat if fewer than needed)
  const total = COLS * ROWS;
  const tiles = Array.from({ length: total }, (_, i) => thumbs[i % thumbs.length]);

  // Stagger every even row by half a tile for an editorial brick effect
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tiled thumbnail grid */}
      <View style={{ overflow: "hidden", flex: 1 }}>
        {Array.from({ length: ROWS }, (_, row) => {
          const offset = row % 2 === 1 ? -(STRIDE / 2) : 0;
          return (
            <View
              key={row}
              style={{
                flexDirection: "row",
                gap: GAP,
                marginTop: row === 0 ? 0 : GAP,
                marginLeft: offset,
              }}
            >
              {Array.from({ length: COLS + (row % 2 === 1 ? 1 : 0) }, (_, col) => {
                const url = tiles[(row * COLS + col) % thumbs.length];
                return (
                  <Image
                    key={col}
                    source={{ uri: url }}
                    style={{ width: TILE, height: TILE, borderRadius: 6 }}
                    resizeMode="cover"
                    blurRadius={7}
                  />
                );
              })}
            </View>
          );
        })}
      </View>

      {/* Dark mood overlay */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(8,5,14,0.58)" }]} />

      {/* Purple glow bloom — bottom */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 120,
        backgroundColor: "rgba(144,19,187,0.18)",
      }} />

      {/* Purple glow bloom — top left accent */}
      <View style={{
        position: "absolute", top: -40, left: -40,
        width: 160, height: 160, borderRadius: 80,
        backgroundColor: "rgba(144,19,187,0.22)",
      }} />
    </View>
  );
}

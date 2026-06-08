import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORY_COLORS, CATEGORY_EMOJI, CATEGORY_LABEL, getSaveTitle } from "@/components/SaveCard";
import { TabBar } from "@/components/TabBar";
import type { Save } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const RECENT_KEY = "resurface_recent_searches_v2";
const MAX_RECENT = 8;

type RecentSearch = { term: string; thumbnail: string | null };

async function loadRecentSearches(): Promise<RecentSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Migrate old string[] format
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
      return (parsed as string[]).map((term) => ({ term, thumbnail: null }));
    }
    return parsed as RecentSearch[];
  } catch { return []; }
}

async function persistRecentSearch(term: string, thumbnail: string | null) {
  try {
    const existing = await loadRecentSearches();
    const updated = [
      { term, thumbnail },
      ...existing.filter((s) => s.term !== term),
    ].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch { /* best-effort */ }
}

async function deleteRecentSearch(term: string) {
  try {
    const existing = await loadRecentSearches();
    await AsyncStorage.setItem(
      RECENT_KEY,
      JSON.stringify(existing.filter((s) => s.term !== term)),
    );
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Recent search row
// ---------------------------------------------------------------------------
function RecentRow({
  item,
  onPress,
  onRemove,
}: {
  item: RecentSearch;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 14 }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: "#1A1A1A",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <Ionicons name="search-outline" size={22} color="#555" />
        )}
      </View>
      <Text style={{ flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" }}>
        {item.term}
      </Text>
      <Pressable onPress={onRemove} hitSlop={10}>
        <Ionicons name="close" size={18} color="#555" />
      </Pressable>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Search result row
// ---------------------------------------------------------------------------
function ResultRow({ save, onPress }: { save: Save; onPress: () => void }) {
  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? "🗂️";
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const title  = getSaveTitle(save);

  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 14 }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {save.thumbnail_url ? (
          <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 24 }}>{emoji}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: "#666", fontSize: 12, marginTop: 2 }}>{label}</Text>
      </View>
      {save.is_favorite && (
        <Ionicons name="heart" size={14} color="#D4537E" />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Search screen
// ---------------------------------------------------------------------------
export default function SearchScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Save[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadRecentSearches().then(setRecentSearches);
    setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  const doSearch = async (q: string) => {
    if (!session || !q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const term = `%${q.trim()}%`;
    const { data } = await supabase
      .from("saves")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("archived", false)
      .or(`title.ilike.${term},ai_description.ilike.${term},note.ilike.${term}`)
      .order("created_at", { ascending: false })
      .limit(50);
    setResults((data as Save[]) ?? []);
    setSearching(false);
  };

  const handleChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(text), 250);
  };

  const commitSearch = (term: string, thumbnail: string | null = null) => {
    if (!term.trim()) return;
    const entry: RecentSearch = { term: term.trim(), thumbnail };
    void persistRecentSearch(term.trim(), thumbnail);
    setRecentSearches((prev) =>
      [entry, ...prev.filter((s) => s.term !== term.trim())].slice(0, MAX_RECENT),
    );
  };

  const removeRecent = (term: string) => {
    void deleteRecentSearch(term);
    setRecentSearches((prev) => prev.filter((s) => s.term !== term));
  };

  const clearQuery = () => {
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
  };

  const isEmpty = query.trim().length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />

      {/* Search bar row */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Pill input */}
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#1A1A1A",
            borderRadius: 26,
            paddingHorizontal: 14,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          <Ionicons name="search" size={16} color="#666" />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={handleChange}
            onSubmitEditing={() => commitSearch(query, results[0]?.thumbnail_url ?? null)}
            placeholder="Search your saves"
            placeholderTextColor="#555"
            returnKeyType="search"
            style={{ flex: 1, color: "#fff", fontSize: 15 }}
          />
          {query.length > 0 && (
            <Pressable onPress={clearQuery} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#555" />
            </Pressable>
          )}
        </View>

        {/* Cancel */}
        <Pressable onPress={() => router.replace("/(app)/" as never)}>
          <Text style={{ color: "#fff", fontSize: 15 }}>Cancel</Text>
        </Pressable>
      </View>

      {/* Body */}
      {isEmpty ? (
        <FlatList
          data={recentSearches}
          keyExtractor={(item) => item.term}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: 20,
          }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", paddingTop: 60 }}>
              <Text style={{ color: "#555", fontSize: 14 }}>Search your saves</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RecentRow
              item={item}
              onPress={() => {
                setQuery(item.term);
                handleChange(item.term);
              }}
              onRemove={() => removeRecent(item.term)}
            />
          )}
        />
      ) : searching ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#FF6B4A" size="small" />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: 20,
          }}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={{ color: "#555", fontSize: 12, marginBottom: 6 }}>
                {results.length} result{results.length !== 1 ? "s" : ""}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <ResultRow
              save={item}
              onPress={() => {
                commitSearch(query, item.thumbnail_url ?? null);
                router.push({ pathname: "/(app)/save/[id]", params: { id: item.id } } as never);
              }}
            />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ fontSize: 32 }}>🔍</Text>
              <Text style={{ marginTop: 12, color: "#666", fontSize: 14, textAlign: "center" }}>
                No saves match "{query}"
              </Text>
            </View>
          }
        />
      )}

      <TabBar active="search" variant="dark" />
    </View>
  );
}

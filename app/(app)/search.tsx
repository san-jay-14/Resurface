import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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

const RECENT_KEY = "resurface_recent_searches";
const MAX_RECENT = 5;

async function addRecentSearch(term: string) {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const updated = [term, ...existing.filter((t) => t !== term)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Compact save row for results list
// ---------------------------------------------------------------------------
function SaveRow({ save, onPress }: { save: Save; onPress: () => void }) {
  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? "🗂️";
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const title  = getSaveTitle(save);

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-3 border-b border-line gap-3"
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-ink" numberOfLines={1}>{title}</Text>
        <Text className="text-xs text-muted">{label}</Text>
      </View>
      {save.is_favorite && <Text style={{ fontSize: 13, color: "#D4537E" }}>♥</Text>}
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
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => { if (raw) setRecentSearches(JSON.parse(raw)); })
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 100);
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

  const commitSearch = (term: string) => {
    if (!term.trim()) return;
    void addRecentSearch(term.trim());
    setRecentSearches((prev) => {
      const updated = [term.trim(), ...prev.filter((t) => t !== term.trim())].slice(0, MAX_RECENT);
      return updated;
    });
  };

  const clearQuery = () => {
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
  };

  const isEmpty = query.trim().length === 0;

  return (
    <View className="flex-1 bg-cream">
      {/* Search bar */}
      <View
        style={{ paddingTop: insets.top + 12 }}
        className="px-5 pb-3 flex-row items-center gap-3"
      >
        <View className="flex-1 flex-row items-center bg-sand rounded-xl px-3 py-2.5 gap-2">
          <Text style={{ fontSize: 14 }}>🔍</Text>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={handleChange}
            onSubmitEditing={() => commitSearch(query)}
            placeholder="Search your saves…"
            placeholderTextColor="#8A7E74"
            returnKeyType="search"
            className="flex-1 text-sm text-ink"
          />
          {query.length > 0 && (
            <Pressable onPress={clearQuery} hitSlop={8}>
              <Text className="text-muted text-base">✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Results or recent searches */}
      {isEmpty ? (
        <View className="flex-1 px-5">
          {recentSearches.length > 0 && (
            <>
              <Text className="text-xs text-muted mb-2">Recent searches</Text>
              <View className="flex-row flex-wrap gap-2">
                {recentSearches.map((term) => (
                  <Pressable
                    key={term}
                    onPress={() => { setQuery(term); handleChange(term); }}
                    className="px-3 py-1.5 rounded-full border border-line bg-white"
                  >
                    <Text className="text-xs text-muted">{term}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {recentSearches.length === 0 && (
            <View className="flex-1 items-center justify-center">
              <Text className="text-muted text-sm text-center">
                Type something to search your saves
              </Text>
            </View>
          )}
        </View>
      ) : searching ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B4A" size="small" />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <Text className="text-xs text-muted mb-1 px-5">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </Text>
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16 }}
          renderItem={({ item }) => (
            <SaveRow
              save={item}
              onPress={() => {
                commitSearch(query);
                router.push({ pathname: "/(app)/save/[id]", params: { id: item.id } } as never);
              }}
            />
          )}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-3xl">🔍</Text>
              <Text className="mt-3 text-sm text-muted text-center">No saves match "{query}"</Text>
            </View>
          }
        />
      )}

      <TabBar active="search" />
    </View>
  );
}

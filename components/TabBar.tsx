import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type ActiveTab = "library" | "boards" | "search" | "profile";

const TABS: { id: ActiveTab; label: string; emoji: string }[] = [
  { id: "library", label: "Library",  emoji: "⊞" },
  { id: "boards",  label: "Boards",   emoji: "⊟" },
  { id: "search",  label: "Search",   emoji: "⊕" },
  { id: "profile", label: "Profile",  emoji: "○" },
];

const ROUTES: Record<ActiveTab, string> = {
  library: "/(app)/",
  boards:  "/(app)/boards",
  search:  "/(app)/search",
  profile: "/(app)/profile",
};

export function TabBar({ active }: { active: ActiveTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      className="border-t border-line bg-white flex-row"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              if (isActive) return;
              router.replace(ROUTES[tab.id] as never);
            }}
            className="flex-1 items-center pt-2"
          >
            <Text
              style={{ fontSize: 20 }}
              className={isActive ? "text-ink" : "text-muted"}
            >
              {tab.emoji}
            </Text>
            <Text
              className={`text-xs mt-0.5 ${isActive ? "font-semibold text-ink" : "text-muted"}`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

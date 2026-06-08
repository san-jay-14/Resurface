import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type ActiveTab = "library" | "boards" | "search" | "profile";

const TABS: { id: ActiveTab; icon: string; route: string }[] = [
  { id: "library", icon: "home",          route: "/(app)/" },
  { id: "search",  icon: "search",        route: "/(app)/search" },
  { id: "profile", icon: "person-circle", route: "/(app)/profile" },
];

interface TabBarProps {
  active: ActiveTab;
  variant?: "light" | "dark";
}

export function TabBar({ active, variant = "light" }: TabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dark = variant === "dark";

  // Boards are now inside the profile screen — treat any boards-related
  // active state as "profile" so the correct tab is highlighted.
  const effectiveActive: ActiveTab =
    active === "boards" ? "profile" : active;

  return (
    <View
      style={{
        backgroundColor: dark ? "#000" : "#fff",
        borderTopWidth: dark ? 0 : 1,
        borderTopColor: "#E7DBCF",
        paddingBottom: Math.max(insets.bottom, 8),
        flexDirection: "row",
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === effectiveActive;
        const color = dark
          ? isActive ? "#ffffff" : "#555555"
          : isActive ? "#1C1714" : "#8A7E74";
        const iconName = (isActive ? tab.icon : `${tab.icon}-outline`) as never;
        return (
          <Pressable
            key={tab.id}
            onPress={() => { if (!isActive) router.replace(tab.route as never); }}
            style={{ flex: 1, alignItems: "center", paddingTop: 12, paddingBottom: 2 }}
            hitSlop={4}
          >
            <Ionicons name={iconName} size={25} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}

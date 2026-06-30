import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function startWeekday(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Custom-themed calendar picker — replaces the native DateTimePicker dialog
 *  (which can't be restyled, especially the Android Material popup) with one
 *  that matches the app's white/purple theme on both platforms. */
export function AppDatePicker({
  visible, value, onClose, onChange, minimumDate, maximumDate,
}: {
  visible: boolean;
  value: Date;
  onClose: () => void;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const insets = useSafeAreaInsets();
  const [viewDate, setViewDate] = useState(value);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const numDays = daysInMonth(year, month);
  const startDay = startWeekday(year, month);

  const cells: (number | null)[] = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];

  const minDay = minimumDate ? stripTime(minimumDate) : null;
  const maxDay = maximumDate ? stripTime(maximumDate) : null;

  const isDisabled = (day: number) => {
    const d = new Date(year, month, day);
    if (minDay && d < minDay) return true;
    if (maxDay && d > maxDay) return true;
    return false;
  };

  const goMonth = (delta: number) => setViewDate(new Date(year, month + delta, 1));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: 16 }} />

        {/* Month nav */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Pressable onPress={() => goMonth(-1)} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="chevron-back" size={20} color="#1A1A1A" />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A" }}>
            {MONTH_LABELS[month]} {year}
          </Text>
          <Pressable onPress={() => goMonth(1)} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name="chevron-forward" size={20} color="#1A1A1A" />
          </Pressable>
        </View>

        {/* Day labels */}
        <View style={{ flexDirection: "row" }}>
          {DAY_LABELS.map((d, i) => (
            <View key={i} style={{ width: `${100 / 7}%`, alignItems: "center", paddingBottom: 8 }}>
              <Text style={{ fontSize: 11, color: "#888", fontWeight: "600" }}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Day grid */}
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {cells.map((day, i) => {
            if (day === null) {
              return <View key={i} style={{ width: `${100 / 7}%`, height: 40 }} />;
            }
            const date = new Date(year, month, day);
            const selected = isSameDay(date, value);
            const disabled = isDisabled(day);
            return (
              <View key={i} style={{ width: `${100 / 7}%`, height: 40, alignItems: "center", justifyContent: "center" }}>
                <Pressable
                  onPress={() => { if (!disabled) onChange(date); }}
                  disabled={disabled}
                  style={{
                    width: 34, height: 34, borderRadius: 17,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: selected ? "#9013BB" : "transparent",
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    color: disabled ? "#DDD" : selected ? "#fff" : "#1A1A1A",
                    fontWeight: selected ? "700" : "400",
                  }}>
                    {day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={onClose}
          style={{ marginTop: 16, backgroundColor: "#9013BB", borderRadius: 32, paddingVertical: 15, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

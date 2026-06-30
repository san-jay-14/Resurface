import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";

export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface AlertConfig {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

type ShowAlert = (title: string, message?: string, buttons?: AppAlertButton[]) => void;

let showAlertImpl: ShowAlert | null = null;

/**
 * Drop-in replacement for React Native's `Alert.alert`, styled to match the
 * app instead of popping up the OS-default dialog. Same call signature, so
 * it can be called from anywhere (event handlers, async functions) without
 * needing a hook at the call site.
 */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]) {
  if (!showAlertImpl) {
    console.warn("[AppAlert] Provider not mounted yet:", title);
    return;
  }
  showAlertImpl(title, message, buttons);
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  const show = useCallback<ShowAlert>((title, message, buttons) => {
    setConfig({
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: "OK" }],
    });
  }, []);

  useEffect(() => {
    showAlertImpl = show;
    return () => { if (showAlertImpl === show) showAlertImpl = null; };
  }, [show]);

  const close = () => setConfig(null);

  const handlePress = (btn: AppAlertButton) => {
    close();
    // Let the modal start dismissing before running the handler, so it
    // doesn't visually fight with whatever the handler triggers next.
    setTimeout(() => btn.onPress?.(), 50);
  };

  return (
    <>
      {children}
      <Modal visible={!!config} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}
          onPress={close}
        >
          <Pressable
            // Swallow taps inside the card so they don't bubble to the backdrop's onPress.
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%", maxWidth: 360 }}
          >
            {config && (
              <>
                <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: config.message ? 8 : 18 }}>
                  {config.title}
                </Text>
                {config.message && (
                  <Text style={{ fontSize: 13, color: "#888", lineHeight: 19, marginBottom: 20 }}>
                    {config.message}
                  </Text>
                )}
                <View style={{ gap: 8 }}>
                  {config.buttons.map((btn, i) => {
                    const isCancel = btn.style === "cancel";
                    const isDestructive = btn.style === "destructive";
                    return (
                      <Pressable
                        key={i}
                        onPress={() => handlePress(btn)}
                        style={{
                          paddingVertical: 13, borderRadius: 14, alignItems: "center",
                          backgroundColor: isCancel ? "#F5F5F5" : isDestructive ? "#FDEAEA" : "#9013BB",
                        }}
                      >
                        <Text style={{
                          fontSize: 14, fontWeight: "700",
                          color: isCancel ? "#1A1A1A" : isDestructive ? "#E03131" : "#FFFFFF",
                        }}>
                          {btn.text}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { isDesktopRuntimeAvailable } from "../../lib/desktop-runtime";
import { getAppPreferences, settingsKeys } from "./api";

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: settingsKeys.preferences,
    queryFn: getAppPreferences,
    enabled: isDesktopRuntimeAvailable(),
  });
  const appearance = data?.appearance;

  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement;
    root.dataset.motion = appearance.motion;
    root.dataset.density = appearance.compactMode ? "compact" : "comfortable";
    root.dataset.fontSize = appearance.fontSize;
    return () => {
      delete root.dataset.motion;
      delete root.dataset.density;
      delete root.dataset.fontSize;
    };
  }, [appearance]);

  return (
    <MotionConfig
      reducedMotion={appearance?.motion === "full" ? "user" : "always"}
      skipAnimations={appearance?.motion === "off"}
    >
      {children}
    </MotionConfig>
  );
}

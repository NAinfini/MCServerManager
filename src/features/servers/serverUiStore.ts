import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ServerDetailTab =
  | "console"
  | "files"
  | "content"
  | "backups"
  | "settings"
  | "activity";

export type ServerViewMode = "table" | "cards";

interface ServerUiState {
  selectedTabs: Record<string, ServerDetailTab>;
  viewMode: ServerViewMode;
  setSelectedTab: (serverId: string, tab: ServerDetailTab) => void;
  setViewMode: (viewMode: ServerViewMode) => void;
}

export const useServerUiStore = create<ServerUiState>()(
  persist(
    (set) => ({
      selectedTabs: {},
      viewMode: "cards",
      setSelectedTab: (serverId, tab) =>
        set((state) => ({
          selectedTabs: { ...state.selectedTabs, [serverId]: tab },
        })),
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    { name: "mc-server-manager-server-ui" },
  ),
);

import { create } from "zustand";

export type ServerDetailTab =
  | "console"
  | "files"
  | "content"
  | "backups"
  | "settings"
  | "activity";

interface ServerUiState {
  selectedTabs: Record<string, ServerDetailTab>;
  setSelectedTab: (serverId: string, tab: ServerDetailTab) => void;
}

export const useServerUiStore = create<ServerUiState>((set) => ({
  selectedTabs: {},
  setSelectedTab: (serverId, tab) =>
    set((state) => ({
      selectedTabs: { ...state.selectedTabs, [serverId]: tab },
    })),
}));

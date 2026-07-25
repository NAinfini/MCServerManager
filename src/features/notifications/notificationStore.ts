import { create } from "zustand";

export type NotificationSeverity = "error" | "warning" | "info" | "success";

export interface TransientNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: string;
}

type NotificationInput = Omit<TransientNotification, "id" | "createdAt">;

interface NotificationState {
  items: TransientNotification[];
  push: (input: NotificationInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let fallbackId = 0;

function notificationId() {
  fallbackId += 1;
  return globalThis.crypto?.randomUUID?.() ?? `notification-${fallbackId}`;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  push: (input) => {
    const id = notificationId();
    set((state) => ({
      items: [
        {
          ...input,
          id,
          createdAt: new Date().toISOString(),
        },
        ...state.items,
      ].slice(0, 50),
    }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),
  clear: () => set({ items: [] }),
}));

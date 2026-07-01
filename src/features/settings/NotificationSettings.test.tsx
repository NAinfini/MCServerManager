import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const preferences = {
  desktopEnabled: true,
  crashEnabled: true,
  restartFailedEnabled: true,
  backupFailedEnabled: true,
  taskFailedEnabled: true,
  updateAvailableEnabled: true,
  tunnelStoppedEnabled: true,
  informationalEnabled: false,
};

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
}

describe("NotificationSettings", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows informational notifications disabled by default", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_notification_preferences") {
        return preferences;
      }
      return [];
    });

    renderSettings();

    expect(
      await screen.findByLabelText(/informational notifications/i),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/desktop notifications/i)).toBeChecked();
  });

  it("persists preference changes", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_notification_preferences") {
        return preferences;
      }
      if (command === "list_notification_events") {
        return [];
      }
      return { ...preferences, desktopEnabled: false };
    });

    renderSettings();
    fireEvent.click(await screen.findByLabelText(/desktop notifications/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_notification_preferences", {
        preferences: {
          ...preferences,
          desktopEnabled: false,
        },
      });
    });
  });

  it("saves rapid switch changes from the same draft", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_notification_preferences") {
        return preferences;
      }
      if (command === "list_notification_events") {
        return [];
      }
      return {
        ...preferences,
        desktopEnabled: false,
        informationalEnabled: true,
      };
    });

    renderSettings();
    fireEvent.click(await screen.findByLabelText(/desktop notifications/i));
    fireEvent.click(screen.getByLabelText(/informational notifications/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_notification_preferences", {
        preferences: {
          ...preferences,
          desktopEnabled: false,
          informationalEnabled: true,
        },
      });
    });
  });
});


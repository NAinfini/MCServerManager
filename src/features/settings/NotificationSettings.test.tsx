import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
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

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_notification_preferences", {
        preferences: {
          ...preferences,
          desktopEnabled: false,
        },
      });
    });
  });

  it("shows auto-save feedback without a separate save action", async () => {
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
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save$/i }),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_notification_preferences", {
        preferences: {
          ...preferences,
          desktopEnabled: false,
        },
      });
    });
  });

  it("lets users retry failed notification preferences", async () => {
    const user = userEvent.setup();
    let preferenceAttempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_notification_preferences") {
        preferenceAttempts += 1;
        if (preferenceAttempts === 1) {
          throw new Error("preferences unavailable");
        }
        return preferences;
      }
      return [];
    });

    renderSettings();

    expect(
      await screen.findByRole("alert", {
        name: /could not load notification settings/i,
      }),
    ).toHaveTextContent("preferences unavailable");
    expect(
      screen.queryByLabelText(/desktop notifications/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByLabelText(/desktop notifications/i),
    ).toBeChecked();
    expect(preferenceAttempts).toBe(2);
  });

  it("shows retryable event errors without a contradictory empty state", async () => {
    const user = userEvent.setup();
    let eventAttempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_notification_preferences") {
        return preferences;
      }
      if (command === "list_notification_events") {
        eventAttempts += 1;
        if (eventAttempts === 1) {
          throw new Error("events unavailable");
        }
        return [];
      }
      return {};
    });

    renderSettings();

    expect(
      await screen.findByRole("alert", {
        name: /could not load notification history/i,
      }),
    ).toHaveTextContent("events unavailable");
    expect(screen.queryByText("No notifications yet.")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Retry notification history" }),
    );

    expect(
      await screen.findByText("No notifications yet."),
    ).toBeInTheDocument();
    expect(eventAttempts).toBe(2);
  });
});

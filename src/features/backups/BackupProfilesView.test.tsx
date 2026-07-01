import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../servers/types";
import { BackupProfilesView } from "./BackupProfilesView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: null,
  javaPath: null,
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  autoStart: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

function renderProfiles() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BackupProfilesView server={server} />
    </QueryClientProvider>,
  );
}

describe("BackupProfilesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a world-only profile by default", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_backup_profiles") {
        return [];
      }
      return {
        id: "profile-1",
        serverId: server.id,
        name: "Configs",
        mode: "worldOnly",
        includePaths: [],
        excludePaths: [],
        retentionCount: 3,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      };
    });

    renderProfiles();
    await userEvent.type(
      await screen.findByLabelText(/profile name/i),
      "Configs",
    );
    await userEvent.clear(screen.getByLabelText(/retention count/i));
    await userEvent.type(screen.getByLabelText(/retention count/i), "3");
    fireEvent.click(screen.getByRole("button", { name: /add profile/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_backup_profile", {
        input: {
          serverId: server.id,
          name: "Configs",
          mode: "worldOnly",
          includePaths: [],
          excludePaths: [],
          retentionCount: 3,
          confirmFullServer: false,
        },
      });
    });
  });

  it("runs a selected backup profile", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_backup_profiles") {
        return [
          {
            id: "profile-1",
            serverId: server.id,
            name: "Keep one",
            mode: "worldOnly",
            includePaths: [],
            excludePaths: [],
            retentionCount: 1,
            createdAt: "2026-07-01T00:00:00Z",
            updatedAt: "2026-07-01T00:00:00Z",
          },
        ];
      }
      return {};
    });

    renderProfiles();
    fireEvent.click(await screen.findByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_profile_backup", {
        input: {
          profileId: "profile-1",
        },
      });
    });
  });

  it("confirms before deleting a backup profile", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_backup_profiles") {
        return [
          {
            id: "profile-1",
            serverId: server.id,
            name: "Keep one",
            mode: "worldOnly",
            includePaths: [],
            excludePaths: [],
            retentionCount: 1,
            createdAt: "2026-07-01T00:00:00Z",
            updatedAt: "2026-07-01T00:00:00Z",
          },
        ];
      }
      return {};
    });

    renderProfiles();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(invoke).not.toHaveBeenCalledWith("delete_backup_profile", {
      profileId: "profile-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete backup profile" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_backup_profile", {
        profileId: "profile-1",
      });
    });
  });
});


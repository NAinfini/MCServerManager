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
import { ProfileImportExport } from "./ProfileImportExport";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: "122",
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

const document = {
  formatVersion: 1,
  exportedAt: "2026-07-01T00:00:00Z",
  server: {
    name: "Survival",
    loaderType: "paper",
    minecraftVersion: "1.21.4",
  },
  warnings: [],
};

function renderProfileIo() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileImportExport server={server} />
    </QueryClientProvider>,
  );
}

describe("ProfileImportExport", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("exports the selected profile as JSON", async () => {
    vi.mocked(invoke).mockResolvedValue(document);

    renderProfileIo();
    fireEvent.click(
      screen.getByRole("button", { name: /export selected profile/i }),
    );

    expect(
      await screen.findByDisplayValue(/"formatVersion": 1/),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("export_server_profile", {
      input: {
        serverId: server.id,
      },
    });
  });

  it("previews import warnings and blocks unsafe import", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "preview_profile_import") {
        return {
          document,
          warnings: ["missing tunnel provider: Ngrok (custom)"],
        };
      }
      return server;
    });

    renderProfileIo();
    fireEvent.change(screen.getByLabelText(/profile json/i), {
      target: { value: JSON.stringify(document) },
    });
    await userEvent.type(screen.getByLabelText(/import name/i), "Imported");
    await userEvent.type(
      screen.getByLabelText(/target server folder/i),
      "C:/servers/imported",
    );
    await userEvent.type(
      screen.getByLabelText(/java runtime/i),
      "C:/java/bin/java.exe",
    );
    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));

    expect(
      await screen.findByText("missing tunnel provider: Ngrok (custom)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import profile/i }),
    ).toBeDisabled();
  });

  it("imports with remapped paths after a clean preview", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "preview_profile_import") {
        return {
          document,
          warnings: [],
        };
      }
      return server;
    });

    renderProfileIo();
    fireEvent.change(screen.getByLabelText(/profile json/i), {
      target: { value: JSON.stringify(document) },
    });
    await userEvent.type(screen.getByLabelText(/import name/i), "Imported");
    await userEvent.type(
      screen.getByLabelText(/target server folder/i),
      "C:/servers/imported",
    );
    await userEvent.type(
      screen.getByLabelText(/java runtime/i),
      "C:/java/bin/java.exe",
    );
    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /import profile/i }),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /import profile/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_profile", {
        input: {
          documentJson: JSON.stringify(document),
          name: "Imported",
          targetRootDir: "C:/servers/imported",
          javaPath: "C:/java/bin/java.exe",
        },
      });
    });
  });
});


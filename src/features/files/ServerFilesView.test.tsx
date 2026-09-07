import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../../domain/server";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerFilesView } from "./ServerFilesView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

vi.mock("./monacoSetup", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="Monaco editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
  restartPolicy: { enabled: false, maxAttempts: 0, cooldownSeconds: 0 },
};

const entries = [
  {
    name: "notes.txt",
    relativePath: "notes.txt",
    kind: "file" as const,
    sizeBytes: 12,
    modifiedAt: "2026-07-01T00:00:00Z",
    editable: true,
  },
  {
    name: "world.dat",
    relativePath: "world.dat",
    kind: "file" as const,
    sizeBytes: 64,
    modifiedAt: "2026-07-01T00:00:00Z",
    editable: false,
  },
];

function renderFiles() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ServerFilesView server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerFilesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_server_files") return entries;
      if (command === "read_server_text_file") {
        return {
          relativePath: args?.relativePath,
          content: "motd=hello",
          revision: "revision-1",
          sizeBytes: 10,
          readOnly: false,
          warning: null,
        };
      }
      if (command === "write_server_text_file") {
        return {
          relativePath: args?.relativePath,
          content: args?.content,
          revision: "revision-2",
          sizeBytes: String(args?.content).length,
          readOnly: false,
          warning: null,
        };
      }
      if (command === "mutate_server_files") return { relativePaths: [] };
      return null;
    });
  });

  afterEach(cleanup);

  it("saves text with the loaded revision", async () => {
    const user = userEvent.setup();
    renderFiles();

    await user.click(await screen.findByRole("button", { name: "notes.txt" }));
    fireEvent.change(await screen.findByLabelText("Monaco editor"), {
      target: { value: "motd=updated" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("write_server_text_file", {
        serverId: server.id,
        relativePath: "notes.txt",
        content: "motd=updated",
        expectedRevision: "revision-1",
      });
    });
  });

  it("shows binary files read-only without reading them as text", async () => {
    const user = userEvent.setup();
    renderFiles();

    await user.click(await screen.findByRole("button", { name: "world.dat" }));

    expect(
      await screen.findByText("Binary file — read only"),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("read_server_text_file", {
      serverId: server.id,
      relativePath: "world.dat",
    });
  });

  it("creates files through the unified file mutation", async () => {
    const user = userEvent.setup();
    renderFiles();

    await user.click(await screen.findByRole("button", { name: "New file" }));
    await user.type(screen.getByLabelText("File name"), "whitelist.json");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("mutate_server_files", {
        input: {
          serverId: server.id,
          operation: "createFile",
          relativePath: "whitelist.json",
          content: "",
        },
      });
    });
  });

  it("keeps the draft visible when a revision conflict rejects the save", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_server_files") return entries;
      if (command === "read_server_text_file") {
        return {
          relativePath: args?.relativePath,
          content: "motd=hello",
          revision: "revision-1",
          sizeBytes: 10,
          readOnly: false,
          warning: null,
        };
      }
      if (command === "write_server_text_file") {
        throw new Error("file changed on disk; reload before saving");
      }
      return null;
    });
    renderFiles();

    await user.click(await screen.findByRole("button", { name: "notes.txt" }));
    fireEvent.change(await screen.findByLabelText("Monaco editor"), {
      target: { value: "motd=my draft" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Could not save the file"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Monaco editor")).toHaveValue("motd=my draft");
    expect(
      screen.getByRole("button", { name: "Reload disk version" }),
    ).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerList } from "./ServerList";
import type { ServerProfile } from "./types";

vi.mock("./ServerActions", () => ({
  ServerActions: () => <button type="button">Actions</button>,
}));

const server: ServerProfile = {
  id: "survival",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.1",
  loaderType: "paper",
  loaderVersion: "1.21.1-120",
  javaPath: "C:/Java/bin/java.exe",
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  autoStart: false,
  createdAt: "2026-07-20T12:00:00.000Z",
  updatedAt: "2026-07-20T12:00:00.000Z",
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

function renderList(props: Partial<React.ComponentProps<typeof ServerList>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerList servers={[]} {...props} />
    </QueryClientProvider>,
  );
}

describe("ServerList states", () => {
  afterEach(cleanup);
  it("turns the empty dashboard into a create or import starting point", async () => {
    const onCreateServer = vi.fn();
    const onImportServer = vi.fn();
    renderList({ onCreateServer, onImportServer });

    await userEvent.click(
      screen.getByRole("button", { name: "Create Server" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import Server" }),
    );

    expect(onCreateServer).toHaveBeenCalledOnce();
    expect(onImportServer).toHaveBeenCalledOnce();
  });

  it("offers a direct retry when server profiles fail to load", async () => {
    const onRetry = vi.fn();
    renderList({ error: new Error("Desktop bridge unavailable"), onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load server profiles",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the latest completed backup instead of a fixed placeholder", async () => {
    renderList({
      lastBackups: {
        [server.id]: "2026-07-22T12:00:00.000Z",
      },
      servers: [server],
    });

    expect(await screen.findByText(/Jul 22, 2026/)).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
  });

  it("states when a server has no completed backup", async () => {
    renderList({ servers: [server] });

    expect(await screen.findByText("No backups yet")).toBeInTheDocument();
  });
});

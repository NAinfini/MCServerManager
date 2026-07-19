import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../../features/servers/types";
import { useSidebarStore } from "./sidebarStore";
import { Sidebar } from "./Sidebar";

vi.mock("../../features/process/api", () => ({
  getServerProcessStatus: vi.fn(async (serverId: string) => ({
    id: `process-${serverId}`,
    serverId,
    command: "java -jar server.jar",
    status: "stopped",
    pid: null,
  })),
}));

const servers: ServerProfile[] = [
  {
    id: "survival",
    name: "Survival SMP",
    rootDir: "C:/servers/survival",
    minecraftVersion: "1.20.4",
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
  },
  {
    id: "forge",
    name: "Modded Forge",
    rootDir: "C:/servers/forge",
    minecraftVersion: "1.20.1",
    loaderType: "forge",
    loaderVersion: null,
    javaPath: null,
    serverPort: 25566,
    minMemoryMb: 1024,
    maxMemoryMb: 6144,
    autoStart: false,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    restartPolicy: {
      enabled: true,
      maxAttempts: 3,
      cooldownSeconds: 30,
    },
  },
  {
    id: "paper",
    name: "Paper Lobby",
    rootDir: "C:/servers/lobby",
    minecraftVersion: "1.21.1",
    loaderType: "paper",
    loaderVersion: null,
    javaPath: null,
    serverPort: 25567,
    minMemoryMb: 1024,
    maxMemoryMb: 2048,
    autoStart: false,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    restartPolicy: {
      enabled: true,
      maxAttempts: 3,
      cooldownSeconds: 30,
    },
  },
];

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSelectPage = vi.fn();
  const onSelectServer = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <Sidebar
        activePage="servers"
        onSelectPage={onSelectPage}
        onSelectServer={onSelectServer}
        selectedServerId="survival"
        servers={servers}
      />
    </QueryClientProvider>,
  );

  return { onSelectPage, onSelectServer };
}

function createDataTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: "move",
    effectAllowed: "move",
    getData: vi.fn((type: string) => data.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
  };
}

describe("Sidebar server organization", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useSidebarStore.getState().resetServerLayout();
  });

  it("creates a group when one server is dropped onto another", async () => {
    renderSidebar();

    const dragged = screen.getByRole("button", { name: /modded forge/i });
    const target = screen.getByRole("button", { name: /survival smp/i });
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    const group = await screen.findByRole("group", { name: /new group/i });
    expect(within(group).getByRole("button", { name: /modded forge/i })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /survival smp/i })).toBeInTheDocument();
  });

  it("reorders servers when dropped on a row insertion target", async () => {
    renderSidebar();

    const dragged = screen.getByRole("button", { name: /paper lobby/i });
    const beforeSurvival = screen.getByLabelText(/move before survival smp/i);
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragOver(beforeSurvival, { dataTransfer });
    fireEvent.drop(beforeSurvival, { dataTransfer });

    const renderedServers = Array.from(
      document.querySelectorAll("[data-testid^='server-nav-row-']"),
    ).map((element) => element.getAttribute("data-testid"));

    expect(renderedServers).toEqual([
      "server-nav-row-paper",
      "server-nav-row-survival",
      "server-nav-row-forge",
    ]);
  });

  it("opens a right-click menu with server organization actions", async () => {
    renderSidebar();

    fireEvent.contextMenu(screen.getByRole("button", { name: /survival smp/i }));

    expect(
      await screen.findByRole("menu", { name: /survival smp actions/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: /create group/i }));

    expect(
      await screen.findByRole("group", { name: /new group/i }),
    ).toBeInTheDocument();
  });

  it("navigates a server context menu by keyboard and restores trigger focus", async () => {
    renderSidebar();

    const trigger = screen.getByRole("button", { name: /survival smp/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.contextMenu(trigger);

    const menu = await screen.findByRole("menu", {
      name: /survival smp actions/i,
    });
    const items = within(menu).getAllByRole("menuitem");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(items[0]).toHaveFocus());

    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(items.at(-1)).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(items.at(-1)).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("exposes and keyboard-navigates group context menus", async () => {
    renderSidebar();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(
      screen.getByRole("button", { name: /modded forge/i }),
      { dataTransfer },
    );
    fireEvent.drop(screen.getByRole("button", { name: /survival smp/i }), {
      dataTransfer,
    });

    const group = await screen.findByRole("group", { name: /new group/i });
    const trigger = group.querySelector<HTMLButtonElement>(
      ".server-nav-group-header",
    )!;
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.contextMenu(trigger);

    const menu = await screen.findByRole("menu", { name: /new group actions/i });
    const items = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

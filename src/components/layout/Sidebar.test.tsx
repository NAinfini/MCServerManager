import {
  act,
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
import type { ServerProfile } from "../../domain/server";
import type { ManagedProcessStatus } from "../../features/process/api";
import en from "../../i18n/locales/en.json";
import zhCN from "../../i18n/locales/zh-CN.json";
import { useSidebarStore } from "./sidebarStore";
import { Sidebar } from "./Sidebar";

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

function renderSidebar(
  serverStatuses: Record<string, ManagedProcessStatus> = {},
) {
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
        serverStatuses={serverStatuses}
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
    expect(
      within(group).getByRole("button", { name: /modded forge/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: /survival smp/i }),
    ).toBeInTheDocument();
  });

  it("reorders servers when dropped on a row insertion target", async () => {
    renderSidebar();

    const dragged = screen.getByRole("button", { name: /paper lobby/i });
    const beforeSurvival = screen.getByTestId("drop-before-survival");
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

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /survival smp/i }),
    );

    expect(
      await screen.findByRole("menu", { name: /survival smp actions/i }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("menuitem", { name: /create group/i }),
    );

    expect(
      await screen.findByRole("group", { name: /new group/i }),
    ).toBeInTheDocument();
    const groupedServer = within(
      screen.getByRole("group", { name: /new group/i }),
    ).getByRole("button", { name: /survival smp/i });
    await waitFor(() => expect(groupedServer).toHaveFocus());
  });

  it("navigates a server context menu by keyboard and restores trigger focus", async () => {
    renderSidebar();

    const trigger = screen.getByRole("button", { name: /survival smp/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });

    const menu = await screen.findByRole("menu", {
      name: /survival smp actions/i,
    });
    const items = within(menu).getAllByRole("menuitem");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(items[0]).toHaveFocus());

    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(items[items.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(items[items.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("exposes and keyboard-navigates group context menus", async () => {
    renderSidebar();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: /modded forge/i }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: /survival smp/i }), {
      dataTransfer,
    });

    const group = await screen.findByRole("group", { name: /new group/i });
    const trigger = group.querySelector<HTMLButtonElement>(
      ".server-nav-group-header",
    )!;
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.contextMenu(trigger);

    const menu = await screen.findByRole("menu", {
      name: /new group actions/i,
    });
    const items = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.contextMenu(trigger);
    const reopenedMenu = await screen.findByRole("menu", {
      name: /new group actions/i,
    });
    await userEvent.click(
      within(reopenedMenu).getByRole("menuitem", { name: /disband group/i }),
    );

    expect(group).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^servers$/i })).toHaveFocus(),
    );
  });

  it("closes context menus on Tab and outside click", async () => {
    renderSidebar();

    const trigger = screen.getByRole("button", { name: /survival smp/i });
    fireEvent.contextMenu(trigger);
    const tabMenu = await screen.findByRole("menu", {
      name: /survival smp actions/i,
    });
    await waitFor(() =>
      expect(within(tabMenu).getAllByRole("menuitem")[0]).toHaveFocus(),
    );
    await userEvent.tab();
    expect(tabMenu).not.toBeInTheDocument();

    fireEvent.contextMenu(trigger);
    const outsideMenu = await screen.findByRole("menu", {
      name: /survival smp actions/i,
    });
    fireEvent.click(screen.getByRole("button", { name: /^servers$/i }));
    expect(outsideMenu).not.toBeInTheDocument();
  });
});

describe("Sidebar status lines", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useSidebarStore.setState({ collapsed: false });
    useSidebarStore.getState().resetServerLayout();
  });

  // A Record, so adding a process status without a line stops compiling here.
  const statusLines: Record<
    ManagedProcessStatus,
    { en: string; zh: string; tone: string }
  > = {
    running: { en: "Running", zh: "运行中", tone: "running" },
    stopping: { en: "Stopping", zh: "正在停止", tone: "stopping" },
    stopped: { en: "Stopped", zh: "已停止", tone: "stopped" },
    crashed: { en: "Crashed · see why", zh: "崩溃 · 查看原因", tone: "crashed" },
    externalRunning: {
      en: "Running externally",
      zh: "在外部运行",
      tone: "running",
    },
  };
  const statuses = Object.keys(statusLines) as ManagedProcessStatus[];

  it("makes a server that needs attention stand out from a healthy one", async () => {
    renderSidebar({ forge: "crashed", survival: "stopped" });

    const crashedRow = screen.getByRole("button", { name: /modded forge/i });
    const crashedLine = within(crashedRow).getByText("Crashed · see why");
    expect(crashedLine).toHaveClass("server-nav-status-crashed");
    expect(crashedRow.querySelector(".status-dot")).toHaveClass(
      "status-dot-crashed",
    );

    // Every row carries a line now, so calm ones must not read as alarms.
    const stoppedRow = screen.getByRole("button", { name: /survival smp/i });
    expect(within(stoppedRow).getByText("Stopped")).not.toHaveClass(
      "server-nav-status-crashed",
    );
    expect(within(stoppedRow).queryByText(/crashed/i)).not.toBeInTheDocument();
  });

  it("treats a server with no reported status as stopped", () => {
    renderSidebar();

    expect(
      within(screen.getByRole("button", { name: /paper lobby/i })).getByText(
        "Stopped",
      ),
    ).toBeInTheDocument();
  });

  it.each(statuses)("has a %s line in both languages", (status) => {
    const line = statusLines[status];
    expect(en[`server.statusLine.${status}`]).toBe(line.en);
    expect(zhCN[`server.statusLine.${status}`]).toBe(line.zh);

    renderSidebar({ survival: status });
    const row = screen.getByRole("button", { name: /survival smp/i });
    expect(within(row).getByText(line.en)).toHaveClass(
      `server-nav-status-${line.tone}`,
    );
  });

  it("still flags a crash through the dot when collapsed", () => {
    useSidebarStore.setState({ collapsed: true });
    renderSidebar({ forge: "crashed" });

    const crashedRow = screen.getByRole("button", { name: /modded forge/i });
    expect(within(crashedRow).queryByText(/crashed/i)).not.toBeInTheDocument();
    expect(crashedRow.querySelector(".status-dot")).toHaveClass(
      "status-dot-crashed",
    );
  });
});

describe("Sidebar footer", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useSidebarStore.setState({ collapsed: false });
    useSidebarStore.getState().resetServerLayout();
  });

  function renderFooter() {
    const onCreateServer = vi.fn();
    render(
      <Sidebar
        activePage="servers"
        notifications={<button type="button">Bell</button>}
        onCreateServer={onCreateServer}
        onSelectPage={vi.fn()}
        servers={servers}
      />,
    );
    return { onCreateServer };
  }

  it("has no dashboard entry and hosts notifications in the footer nav", () => {
    renderFooter();

    const primary = screen.getByRole("navigation", { name: /primary/i });
    expect(within(primary).getByRole("button", { name: "Bell" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^dashboard$/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the drop hint as a create button, except when collapsed", async () => {
    const { onCreateServer } = renderFooter();

    await userEvent.click(
      screen.getByRole("button", { name: "Drop a pack to start a server" }),
    );
    expect(onCreateServer).toHaveBeenCalledTimes(1);

    act(() => useSidebarStore.setState({ collapsed: true }));
    expect(
      screen.queryByRole("button", { name: "Drop a pack to start a server" }),
    ).not.toBeInTheDocument();
  });
});

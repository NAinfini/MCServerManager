import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerWorkspaceSection } from "../../app/router";
import { AppSettingsProvider } from "../../i18n";
import { cleanup, render, screen, within } from "../../test/render";
import { ServerDetail } from "./ServerDetail";
import type { ServerProfile } from "./types";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(async (command: string) => {
    if (command === "get_server_process_status") return null;
    if (command === "get_server_setup_status") {
      return {
        serverId: "server-1",
        serverName: "Review Server",
        checks: [
          {
            id: "java",
            status: "ready",
            message: "Java 21 satisfies required Java 21.",
          },
          {
            id: "serverRuntime",
            status: "actionRequired",
            exists: false,
            kind: "structured",
            message: "The provisioned server runtime is incomplete.",
          },
          {
            id: "eula",
            status: "actionRequired",
            exists: true,
            accepted: false,
            fileName: "eula.txt",
            message: "Read the Minecraft EULA, then set eula=true yourself if you accept it.",
          },
          {
            id: "backup",
            status: "warning",
            count: 0,
            message: "Create a backup before changing jars, mods, configs, or worlds.",
          },
        ],
      };
    }
    if (command === "list_process_events") return [];
    if (command === "get_performance_history") {
      return { serverId: "server-1", samples: null, events: [] };
    }
    return null;
  }),
}));

vi.mock("../console/ConsoleView", () => ({
  ConsoleView: () => {
    throw new Error("console render failed");
  },
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Review Server",
  rootDir: "C:/Temp/review-server",
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
};

function renderDetail({
  section = "overview",
  view,
  onNavigate = vi.fn(),
  profile = server,
}: {
  section?: ServerWorkspaceSection;
  view?: string;
  onNavigate?: (section: ServerWorkspaceSection, view?: string) => void;
  profile?: ServerProfile;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return {
    onNavigate,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AppSettingsProvider>
          <ServerDetail
            onNavigate={onNavigate}
            section={section}
            server={profile}
            view={view}
          />
        </AppSettingsProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("ServerDetail command deck", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses eight task-oriented workspace sections instead of the legacy tab wall", () => {
    renderDetail();

    const workspace = screen.getByRole("navigation", {
      name: "Review Server workspace",
    });
    expect(within(workspace).getAllByRole("button")).toHaveLength(8);
    [
      "Overview",
      "Console",
      "Players",
      "Content",
      "Files & backups",
      "Operations",
      "Automation",
      "Server settings",
    ].forEach((label) => {
      expect(
        within(workspace).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Server context" }),
    ).not.toBeInTheDocument();
  });

  it("localizes all primary workspace sections", () => {
    localStorage.setItem("mcsm.language", "zh-CN");
    renderDetail();

    const workspace = screen.getByRole("navigation", {
      name: "Review Server 工作台",
    });
    ["概览", "控制台", "玩家", "内容", "文件与备份", "运行状况", "自动化", "服务器设置"].forEach(
      (label) => {
        expect(
          within(workspace).getByRole("button", { name: label }),
        ).toBeInTheDocument();
      },
    );
  });

  it("requests canonical child views when a workspace section is chosen", async () => {
    const onNavigate = vi.fn();
    renderDetail({ onNavigate });

    await userEvent.click(screen.getByRole("button", { name: "Players" }));
    expect(onNavigate).toHaveBeenCalledWith("players", "online");

    await userEvent.click(
      screen.getByRole("button", { name: "Server settings" }),
    );
    expect(onNavigate).toHaveBeenCalledWith("settings", "general");
  });

  it("shows one compact child-view switcher for a section", async () => {
    const onNavigate = vi.fn();
    renderDetail({ onNavigate, section: "players", view: "online" });

    const switcher = screen.getByRole("navigation", {
      name: "Workspace views",
    });
    expect(within(switcher).getAllByRole("button")).toHaveLength(4);
    expect(
      within(switcher).getByRole("button", { name: "Online" }),
    ).toHaveAttribute("aria-current", "page");

    await userEvent.click(
      within(switcher).getByRole("button", { name: "Operators" }),
    );
    expect(onNavigate).toHaveBeenCalledWith("players", "ops");
  });

  it("normalizes an unknown child view to the section default", () => {
    renderDetail({ section: "players", view: "removed-view" });

    expect(
      screen.getByRole("button", { name: "Online" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps the shell usable when a lazy workspace panel crashes", async () => {
    renderDetail({ section: "console", view: "terminal" });

    expect(
      await screen.findByText("This panel could not load"),
    ).toBeInTheDocument();
    expect(screen.getByText("console render failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Review Server")).toBeInTheDocument();
  });

  it("places setup guidance and quick links on overview", async () => {
    renderDetail();

    const checklist = await screen.findByLabelText("Server setup checklist");
    expect(await within(checklist).findByText("Java")).toBeInTheDocument();
    expect(within(checklist).getByText("Minecraft EULA")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Server shortcuts" }),
    ).toBeInTheDocument();
  });

  it("renders invalid profile dates without crashing overview", async () => {
    renderDetail({ profile: { ...server, updatedAt: "not-a-date" } });

    const lastUpdated = await screen.findByText("Last updated");
    expect(within(lastUpdated.parentElement!).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Review Server")).toBeInTheDocument();
  });

  it("keeps server identity, lifecycle actions, invite, and backup in one header", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Review Server" }),
    ).toBeInTheDocument();
    expect(screen.getByText("MC 1.20.4")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Review Server" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Invite friends")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup" })).toBeInTheDocument();
  });

  it("shows a back button only when a back handler is provided", async () => {
    const onBack = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = render(
      <QueryClientProvider client={queryClient}>
        <AppSettingsProvider>
          <ServerDetail onBack={onBack} server={server} />
        </AppSettingsProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    first.unmount();
    renderDetail();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });
});

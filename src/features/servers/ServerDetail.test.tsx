import { cleanup, render, screen, within } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { ServerDetail } from "./ServerDetail";
import { useServerUiStore } from "./serverUiStore";
import type { ServerProfile } from "./types";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(async (command: string) => {
    if (command === "get_server_process_status") {
      return null;
    }
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
    if (command === "list_process_events") {
      return [];
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

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <ServerDetail server={server} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

describe("ServerDetail", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useServerUiStore.setState({ selectedTabs: {} });
  });

  it("keeps the server detail view usable when a lazy tab panel crashes", async () => {
    renderDetail();

    await userEvent.click(screen.getByRole("tab", { name: "Console" }));

    expect(
      await screen.findByText("This panel could not load"),
    ).toBeInTheDocument();
    expect(screen.getByText("console render failed")).toBeInTheDocument();
    expect(screen.getByText("Review Server")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(await screen.findByText("Root folder")).toBeInTheDocument();
  });

  it("renders invalid profile dates without crashing the activity panel", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppSettingsProvider>
          <ServerDetail server={{ ...server, updatedAt: "not-a-date" }} />
        </AppSettingsProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(await screen.findByText("Invalid date")).toBeInTheDocument();
    expect(screen.getByText("Review Server")).toBeInTheDocument();
  });

  it("localizes every server detail tab", () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    renderDetail();

    [
      "控制台",
      "文件",
      "内容",
      "备份",
      "设置",
      "活动",
    ].forEach((label) => {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    });
  });

  it("uses a left section menu with a bounded content workspace", () => {
    const { container } = renderDetail();

    expect(container.querySelector(".server-detail-workspace")).not.toBeNull();
    expect(container.querySelector(".server-detail-menu")).not.toBeNull();
    expect(container.querySelector(".detail-tab-content")).not.toBeNull();
  });

  it("shows a setup checklist in settings so new users know the current required actions", async () => {
    renderDetail();

    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const checklist = await screen.findByLabelText("Server setup checklist");

    expect(within(checklist).getByText("Setup checklist")).toBeInTheDocument();
    expect(await within(checklist).findByText("Java")).toBeInTheDocument();
    expect(within(checklist).getByText("Server runtime")).toBeInTheDocument();
    expect(within(checklist).getByText("Minecraft EULA")).toBeInTheDocument();
    expect(within(checklist).getByText("Backup")).toBeInTheDocument();
    expect(within(checklist).getByText("Done")).toBeInTheDocument();
    expect(within(checklist).getAllByText("Action needed")).toHaveLength(2);
    expect(within(checklist).getByText("Recommended")).toBeInTheDocument();
    expect(within(checklist).getByText("Install or repair the validated server runtime before starting.")).toBeInTheDocument();
    expect(within(checklist).getByText("Read the Minecraft EULA, then set eula=true yourself if you accept it.")).toBeInTheDocument();
    expect(within(checklist).getByText("Create a backup before changing jars, mods, configs, or worlds.")).toBeInTheDocument();
  });

  it("renders the server name as the page heading in its merged header", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Review Server" }),
    ).toBeInTheDocument();
  });

  it("shows a back button that calls onBack when provided", async () => {
    const onBack = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppSettingsProvider>
          <ServerDetail server={server} onBack={onBack} />
        </AppSettingsProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("omits the back button when no onBack handler is provided", () => {
    renderDetail();

    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });
});


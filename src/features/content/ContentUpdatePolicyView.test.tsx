import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../servers/types";
import { ContentUpdatePolicyView } from "./ContentUpdatePolicyView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: "1",
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

function renderPolicyView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ContentUpdatePolicyView server={server} />
      </QueryClientProvider>,
    ),
  };
}

async function chooseSelect(label: RegExp, optionName: string) {
  const trigger = await screen.findByLabelText(label);
  await userEvent.click(trigger);
  await userEvent.click(
    await screen.findByRole("option", { name: optionName }),
  );
  return trigger;
}

describe("ContentUpdatePolicyView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_content_update_policy") {
        return {
          id: "default",
          serverId: server.id,
          contentId: null,
          policy: "manual_only",
          pinnedVersion: null,
          ignoredUpdate: null,
          updatedAt: "2026-07-01T00:00:00Z",
        };
      }
      if (command === "save_content_update_policy") {
        const input = (args as { input: Record<string, unknown> }).input;
        return {
          id: "policy-1",
          serverId: server.id,
          contentId: input.contentId,
          policy: input.policy,
          pinnedVersion: input.pinnedVersion,
          ignoredUpdate: input.ignoredUpdate,
          updatedAt: "2026-07-01T00:00:00Z",
        };
      }
      if (command === "plan_content_updates") {
        return {
          serverId: server.id,
          policy: "batch_confirm",
          plannedUpdates: ["Mod A"],
          warnings: [],
          requiresConfirmation: true,
        };
      }
      throw new Error(`unexpected command ${command}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads manual-only policy and saves batch confirmation", async () => {
    renderPolicyView();
    const select = await screen.findByLabelText(/default behavior/i);

    expect(select).toHaveTextContent("Manual only");
    await chooseSelect(/default behavior/i, "Batch after confirmation");
    fireEvent.click(screen.getByRole("button", { name: /save policy/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_content_update_policy", {
        input: {
          serverId: server.id,
          contentId: null,
          policy: "batch_confirm",
          pinnedVersion: null,
          ignoredUpdate: null,
        },
      });
    });
  });

  it("previews batch updates with explicit confirmation and does not call install commands", async () => {
    renderPolicyView();
    await chooseSelect(/default behavior/i, "Batch after confirmation");
    await userEvent.type(screen.getByLabelText(/candidate name/i), "Mod A");
    await userEvent.type(screen.getByLabelText(/current version/i), "1.0.0");
    await userEvent.type(screen.getByLabelText(/latest version/i), "1.1.0");
    fireEvent.click(screen.getByRole("button", { name: /preview updates/i }));

    expect(await screen.findByText("1 updates planned")).toBeInTheDocument();
    expect(screen.getByText("Mod A")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("plan_content_updates", {
      input: {
        serverId: server.id,
        availableUpdates: [
          {
            contentId: "Mod A",
            name: "Mod A",
            currentVersion: "1.0.0",
            latestVersion: "1.1.0",
            warnings: [],
          },
        ],
        installAnyway: false,
        confirmBatch: true,
      },
    });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(
          ([command]) => !String(command).startsWith("install_"),
        ),
    ).toBe(true);
  });

  it("records content-specific pin and ignore state", async () => {
    renderPolicyView();
    await chooseSelect(/default behavior/i, "Pin current version");
    await userEvent.type(screen.getByLabelText(/content id/i), "mod-a");
    await userEvent.type(screen.getByLabelText(/pinned version/i), "1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /save policy/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_content_update_policy", {
        input: {
          serverId: server.id,
          contentId: "mod-a",
          policy: "pin_current",
          pinnedVersion: "1.0.0",
          ignoredUpdate: null,
        },
      });
    });

    await chooseSelect(/default behavior/i, "Ignore update");
    await userEvent.clear(screen.getByLabelText(/content id/i));
    await userEvent.type(screen.getByLabelText(/content id/i), "mod-b");
    await userEvent.type(
      screen.getByLabelText(/ignored update version/i),
      "2.0.0",
    );
    fireEvent.click(screen.getByRole("button", { name: /save policy/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_content_update_policy", {
        input: {
          serverId: server.id,
          contentId: "mod-b",
          policy: "ignore_update",
          pinnedVersion: null,
          ignoredUpdate: "2.0.0",
        },
      });
    });
  });

  it("keeps unsaved policy edits when the policy refetches", async () => {
    const { queryClient } = renderPolicyView();

    await chooseSelect(/default behavior/i, "Batch after confirmation");
    act(() => {
      queryClient.setQueryData(["contentUpdatePolicy", server.id, null], {
        id: "default",
        serverId: server.id,
        contentId: null,
        policy: "manual_only",
        pinnedVersion: null,
        ignoredUpdate: null,
        updatedAt: "2026-07-01T00:00:01Z",
      });
    });

    expect(screen.getByLabelText(/default behavior/i)).toHaveTextContent(
      "Batch after confirmation",
    );
  });
});


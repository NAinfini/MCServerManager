import { cleanup, fireEvent, render, screen } from "../../test/render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { InstallDialog } from "./InstallDialog";
import type { ProjectSummary, ProjectVersion } from "./marketplaceApi";

vi.mock("../../lib/desktop-runtime", () => ({ invokeDesktopCommand: vi.fn() }));

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AppSettingsProvider>{children}</AppSettingsProvider>
    </QueryClientProvider>
  );
}

const project: ProjectSummary = {
  id: "project-a",
  slug: "project-a",
  title: "Project A",
  description: "A useful mod",
  projectType: "mod",
  loaders: ["fabric"],
  gameVersions: ["1.21.4"],
};

const version: ProjectVersion = {
  id: "version-a",
  projectId: "project-a",
  name: "Project A 1.0",
  versionNumber: "1.0.0",
  loaders: ["fabric"],
  gameVersions: ["1.21.4"],
  files: [],
  dependencies: [],
  warnings: ["incompatible dependency detected: project-b"],
};

describe("InstallDialog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_modrinth_project") {
        return {
          ...project,
          id: "P7dR8mSH",
          title: "Fabric API",
        };
      }
      throw new Error(`unexpected ${command}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("requires install-anyway confirmation before installing warned versions", async () => {
    const onInstall = vi.fn();
    const onInstallAnywayChange = vi.fn();

    const { rerender } = render(
      <Providers>
        <InstallDialog
          error={null}
          installAnyway={false}
          isInstalling={false}
          project={project}
          version={version}
          onCancel={vi.fn()}
          onInstall={onInstall}
          onInstallAnywayChange={onInstallAnywayChange}
        />
      </Providers>,
    );

    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/install anyway/i));
    expect(onInstallAnywayChange).toHaveBeenCalledWith(true);

    rerender(
      <Providers>
        <InstallDialog
          error={null}
          installAnyway
          isInstalling={false}
          project={project}
          version={version}
          onCancel={vi.fn()}
          onInstall={onInstall}
          onInstallAnywayChange={onInstallAnywayChange}
        />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("resolves dependency names only when the install review opens", async () => {
    render(
      <Providers>
        <InstallDialog
          error={null}
          installAnyway={false}
          isInstalling={false}
          project={project}
          version={{
            ...version,
            warnings: [],
            dependencies: [
              {
                projectId: "P7dR8mSH",
                versionId: "0.100.8+1.21",
                dependencyType: "required",
              },
              {
                versionId: "unknown-version-id",
                dependencyType: "optional",
              },
            ],
          }}
          onCancel={vi.fn()}
          onInstall={vi.fn()}
          onInstallAnywayChange={vi.fn()}
        />
      </Providers>,
    );

    expect(await screen.findByText("Fabric API")).toBeInTheDocument();
    expect(screen.getByText(/P7dR8mSH/)).toBeInTheDocument();
    expect(screen.getByText("Name could not be resolved")).toBeInTheDocument();
    expect(screen.getByText("unknown-version-id")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

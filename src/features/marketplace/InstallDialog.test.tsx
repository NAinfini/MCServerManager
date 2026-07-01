import { cleanup, fireEvent, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { InstallDialog } from "./InstallDialog";
import type { ProjectSummary, ProjectVersion } from "./marketplaceApi";

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
  afterEach(() => {
    cleanup();
  });

  it("requires install-anyway confirmation before installing warned versions", async () => {
    const onInstall = vi.fn();
    const onInstallAnywayChange = vi.fn();

    const { rerender } = render(
      <AppSettingsProvider>
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
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("button", { name: /install/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/install anyway/i));
    expect(onInstallAnywayChange).toHaveBeenCalledWith(true);

    rerender(
      <AppSettingsProvider>
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
      </AppSettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});


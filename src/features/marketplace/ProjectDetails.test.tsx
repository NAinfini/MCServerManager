import { cleanup, render, screen } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { ProjectDetails } from "./ProjectDetails";
import type { ProjectDetails as ProjectDetailsData } from "./marketplaceApi";

const project: ProjectDetailsData = {
  id: "pack-a",
  slug: "pack-a",
  title: "Pack A",
  description: "Short pack summary",
  body: [
    "## Overview",
    "Line one",
    "Line two",
    "",
    "- Feature A",
    "- Feature B",
    "",
    '<script>alert("x")</script>',
  ].join("\n"),
  projectType: "modpack",
  loaders: ["fabric"],
  gameVersions: ["1.21.8"],
  downloads: 10,
  follows: 2,
  websiteUrl: "https://modrinth.com/modpack/pack-a",
};

describe("ProjectDetails", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders provider descriptions as sanitized markdown", () => {
    render(
      <AppSettingsProvider>
        <ProjectDetails
          isLoading={false}
          project={project}
          provider="Modrinth"
          selectedVersionId={null}
          versions={[]}
          onSelectVersion={vi.fn()}
        />
      </AppSettingsProvider>,
    );

    const details = screen.getByRole("region", { name: /project details/i });
    const markdown = details.querySelector(".marketplace-markdown");

    expect(markdown?.querySelector("h2")).toHaveTextContent("Overview");
    expect(markdown?.querySelector("br")).toBeInTheDocument();
    expect(markdown?.querySelectorAll("li")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /open on modrinth/i }),
    ).toHaveAttribute("href", "https://modrinth.com/modpack/pack-a");
    expect(details).not.toHaveTextContent("<script>");
    expect(details).not.toHaveTextContent("alert");
  });

  it("does not repeat the summary when a provider has no long description", () => {
    render(
      <AppSettingsProvider>
        <ProjectDetails
          isLoading={false}
          project={{ ...project, body: null }}
          provider="BBSMC"
          selectedVersionId={null}
          versions={[]}
          onSelectVersion={vi.fn()}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getAllByText("Short pack summary")).toHaveLength(1);
  });

  it("presents BBSMC versions without raw ids or backend warning copy", () => {
    render(
      <AppSettingsProvider>
        <ProjectDetails
          isLoading={false}
          project={{ ...project, body: null }}
          provider="BBSMC"
          selectedVersionId={null}
          versions={[
            {
              id: "8545214",
              projectId: "pack-a",
              name: "thematipack-fabric-1.20.1-1.6.5",
              versionNumber: "8545214",
              loaders: ["fabric"],
              gameVersions: ["1.20.1"],
              files: [],
              dependencies: [],
              warnings: [
                "This BBSMC version also provides external disk download links.",
              ],
            },
          ]}
          onSelectVersion={vi.fn()}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByText("Available versions")).toBeInTheDocument();
    expect(
      screen.getByText("Also available through an external download link"),
    ).toBeInTheDocument();
    expect(screen.queryByText("8545214")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "This BBSMC version also provides external disk download links.",
      ),
    ).not.toBeInTheDocument();
  });
});

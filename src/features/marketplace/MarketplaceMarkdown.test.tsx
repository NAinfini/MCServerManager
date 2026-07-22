import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { MarketplaceMarkdown } from "./MarketplaceMarkdown";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

describe("MarketplaceMarkdown", () => {
  beforeEach(() => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue({
      contentType: "image/webp",
      dataUrl: "data:image/webp;base64,AQID",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps expanded details open when the rendered description refreshes", async () => {
    const source = [
      "<details>",
      "<summary>点击展开mod list</summary>",
      "<p>Fabric API</p>",
      "</details>",
    ].join("");
    const { rerender } = render(<MarketplaceMarkdown source={source} />);

    await userEvent.click(screen.getByText("点击展开mod list"));
    expect(screen.getByText("点击展开mod list").closest("details")).toHaveAttribute(
      "open",
    );

    rerender(
      <MarketplaceMarkdown
        source={`${source}<p>后台刷新后的新增说明</p>`}
      />,
    );

    expect(screen.getByText("点击展开mod list").closest("details")).toHaveAttribute(
      "open",
    );
  });

  it("marks a broken direct body image so it collapses instead of leaking alt text", async () => {
    render(
      <MarketplaceMarkdown source="![Banner](https://cdn.modrinth.com/data/pack/banner.png)" />,
    );

    const image = screen.getByAltText("Banner") as HTMLImageElement;
    // jsdom never loads the remote src, so a fresh error event will not fire;
    // the effect must reconcile the already-broken image on its own.
    expect(image).not.toHaveAttribute("data-marketplace-image-error");

    // Simulate the natural <img> error the renderer would emit for a dead host.
    image.dispatchEvent(new Event("error", { bubbles: false }));

    await waitFor(() =>
      expect(image).toHaveAttribute("data-marketplace-image-error", "true"),
    );
    // A direct image must never be routed through the BBSMC proxy command.
    expect(invokeDesktopCommand).not.toHaveBeenCalled();
  });

  it("converts markdown images and headings embedded in HTML sources", () => {
    const source = [
      "<details><summary>Info</summary><p>body</p></details>",
      "# My Modpack",
      "![Badge](https://img.shields.io/badge/test-green)",
      "[Homepage](https://example.com)",
    ].join("\n");
    render(<MarketplaceMarkdown source={source} />);

    expect(screen.getByText("My Modpack").tagName).toBe("H1");
    expect(screen.getByAltText("Badge")).toBeInTheDocument();
    expect(screen.getByAltText("Badge").tagName).toBe("IMG");
    expect(screen.getByText("Homepage").tagName).toBe("A");
    expect(screen.getByText("Homepage")).toHaveAttribute(
      "href",
      "https://example.com/",
    );
  });

  it("loads BBSMC markdown images through the desktop backend", async () => {
    render(
      <MarketplaceMarkdown
        source="![任务截图](https://cdn.bbsmc.net/bbsmc/data/cached_images/task.webp)"
      />,
    );

    const image = screen.getByAltText("任务截图");
    await waitFor(() =>
      expect(image).toHaveAttribute("src", "data:image/webp;base64,AQID"),
    );
    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "fetch_marketplace_image",
      {
        input: {
          url: "https://cdn.bbsmc.net/bbsmc/data/cached_images/task.webp",
        },
      },
    );
  });
});

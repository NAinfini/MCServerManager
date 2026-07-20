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

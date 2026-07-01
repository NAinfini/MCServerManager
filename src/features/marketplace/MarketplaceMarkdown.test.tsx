import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MarketplaceMarkdown } from "./MarketplaceMarkdown";

describe("MarketplaceMarkdown", () => {
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
});

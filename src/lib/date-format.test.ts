import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date-format";

describe("date formatting", () => {
  it("formats invalid date input without throwing during render", () => {
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });

  it("reports missing dates explicitly", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("uses the selected application locale", () => {
    expect(formatDate("2026-07-23T15:00:00.000Z", "zh-CN")).toContain(
      "2026年",
    );
  });
});

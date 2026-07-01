import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date-format";

describe("date formatting", () => {
  it("formats invalid date input without throwing during render", () => {
    expect(formatDate("not-a-date")).toBe("Invalid date");
    expect(formatDateTime("not-a-date")).toBe("Invalid date");
  });

  it("reports missing dates explicitly", () => {
    expect(formatDate(null)).toBe("Not available");
    expect(formatDateTime(undefined)).toBe("Not available");
  });
});

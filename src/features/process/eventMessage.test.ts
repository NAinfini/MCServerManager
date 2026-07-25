import { describe, expect, it } from "vitest";
import { formatProcessEventMessage } from "./eventMessage";

const t = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => `${key}:${JSON.stringify(values ?? {})}`;

describe("formatProcessEventMessage", () => {
  it("localizes known lifecycle events", () => {
    expect(formatProcessEventMessage("Server process started.", t)).toBe(
      "processEvents.started:{}",
    );
    expect(
      formatProcessEventMessage("Server process exited with code 1.", t),
    ).toBe('processEvents.exited:{"code":"1"}');
  });

  it("keeps console and mod output verbatim", () => {
    expect(formatProcessEventMessage("[Server thread/INFO]: Done", t)).toBe(
      "[Server thread/INFO]: Done",
    );
  });
});

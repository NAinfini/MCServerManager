import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { formatDuration, formatMegabytes, formatMinutes } from "./format-units";

type Values = Record<string, string | number | null | undefined>;

const en = (key: string, values?: Values) => translate("en", key, values);
const zh = (key: string, values?: Values) => translate("zh-CN", key, values);

describe("formatMegabytes", () => {
  it("keeps small figures in megabytes", () => {
    expect(formatMegabytes(512)).toBe("512 MB");
    expect(formatMegabytes(1023)).toBe("1023 MB");
  });

  it("promotes a drive-sized figure to gigabytes", () => {
    expect(formatMegabytes(1024)).toBe("1 GB");
    expect(formatMegabytes(102_400)).toBe("100 GB");
    expect(formatMegabytes(1536)).toBe("1.5 GB");
  });
});

describe("formatDuration", () => {
  it("reads an exact hour as one unit", () => {
    expect(formatDuration(3600, en)).toBe("1 h");
    expect(formatDuration(3600, zh)).toBe("1 小时");
  });

  it("carries a remainder into a second unit and stops there", () => {
    expect(formatDuration(5400, en)).toBe("1 h 30 min");
    // 1 d 1 h 1 min: the minutes are dropped rather than making a third unit.
    expect(formatDuration(90_060, en)).toBe("1 d 1 h");
  });

  it("falls back to seconds for short and zero durations", () => {
    expect(formatDuration(45, zh)).toBe("45 秒");
    expect(formatDuration(0, zh)).toBe("0 秒");
  });
});

describe("formatMinutes", () => {
  it("states a nightly schedule in days, not minutes", () => {
    expect(formatMinutes(1440, zh)).toBe("1 天");
    expect(formatMinutes(90, en)).toBe("1 h 30 min");
  });
});

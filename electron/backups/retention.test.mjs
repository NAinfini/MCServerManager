import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { selectRetention, normalizePolicy, DEFAULT_POLICY } = require(
  "./retention.cjs",
);

/* Local noon of the given day offset (negative = days ago) from a fixed date,
   plus hours, so day boundaries do not depend on the machine's timezone. */
const base = new Date(2026, 5, 30, 12, 0, 0);
function at(daysAgo, hour = 12) {
  const date = new Date(base);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
const point = (id, createdAt) => ({ id, createdAt });

describe("backup retention", () => {
  it("removes the oldest points until storage fits, and never the newest", async () => {
    const { pruneToCap, capBytesFor } = require("./retention.cjs");
    const sizes = new Map([["new", 10], ["mid", 10], ["old", 10]]);
    const run = (capBytes) =>
      pruneToCap({
        automatic: [...sizes.keys()].map((id) => ({ id })),
        capBytes,
        measureBytes: async () =>
          [...sizes.values()].reduce((sum, size) => sum + size, 0),
        remove: async (id) => sizes.delete(id),
      });
    expect(await run(30)).toEqual([]);
    expect(await run(25)).toEqual(["old"]);
    expect(await run(1)).toEqual(["mid"]);
    expect([...sizes.keys()]).toEqual(["new"]);
    expect(capBytesFor(1024, 5)).toBe(1024 * 1024 * 1024);
    expect(capBytesFor(null, 100)).toBe(500);
    expect(capBytesFor(null, 0)).toBe(Infinity);
  });

  it("defaults to 8 recent, 5 daily and 2 weekly", () => {
    expect(DEFAULT_POLICY).toEqual({ keepRecent: 8, keepDaily: 5, keepWeekly: 2 });
    expect(normalizePolicy()).toEqual(DEFAULT_POLICY);
  });

  it("keeps everything while there are fewer points than the limits", () => {
    const items = [0, 1, 2].map((i) => point(`p${i}`, at(0, 10 - i)));
    const { keep, remove } = selectRetention(items, {});
    expect(keep).toHaveLength(3);
    expect(remove).toEqual([]);
  });

  it("keeps the newest N and drops the rest when daily and weekly are off", () => {
    const items = Array.from({ length: 10 }, (_, i) => point(`p${i}`, at(0, i + 1)));
    const { keep, remove } = selectRetention(items, {
      keepRecent: 3,
      keepDaily: 0,
      keepWeekly: 0,
    });
    // p9 is the newest (hour 10).
    expect(keep).toEqual(["p9", "p8", "p7"]);
    expect(remove).toHaveLength(7);
  });

  it("keeps the newest point of each recent day beyond the recent window", () => {
    const items = [];
    // 4 points a day for 10 days, 6 hours apart, newest day first.
    for (let day = 0; day < 10; day++)
      for (const hour of [0, 6, 12, 18])
        items.push(point(`d${day}h${hour}`, at(day, hour)));
    const { keep } = selectRetention(items, {
      keepRecent: 4,
      keepDaily: 7,
      keepWeekly: 0,
    });
    // 4 recent (all of day 0) + the newest of days 1..6.
    expect(keep).toHaveLength(4 + 6);
    expect(keep).toContain("d3h18");
    expect(keep).not.toContain("d3h12");
    expect(keep).not.toContain("d7h18");
  });

  it("keeps the newest point of each of the last weeks", () => {
    const items = [];
    for (let day = 0; day < 60; day += 3) items.push(point(`d${day}`, at(day)));
    const { keep, remove } = selectRetention(items, {
      keepRecent: 1,
      keepDaily: 0,
      keepWeekly: 4,
    });
    expect(keep.length).toBeLessThanOrEqual(5);
    expect(keep).toContain("d0");
    // Nothing older than about a month survives.
    expect(remove).toContain("d57");
  });

  it("is pure: same input, same answer, input untouched", () => {
    const items = Array.from({ length: 40 }, (_, i) => point(`p${i}`, at(0, 0)));
    items.forEach((item, i) => {
      item.createdAt = new Date(base.getTime() - i * 3_600_000).toISOString();
    });
    const snapshot = JSON.stringify(items);
    const first = selectRetention(items, {});
    const second = selectRetention(items, {});
    expect(first).toEqual(second);
    expect(JSON.stringify(items)).toBe(snapshot);
    // 40 hourly points with defaults: 8 recent, plus daily/weekly extras.
    expect(first.keep.length).toBeGreaterThanOrEqual(8);
    expect(first.keep.length + first.remove.length).toBe(40);
  });

  it("never removes a point whose date cannot be read", () => {
    const { keep, remove } = selectRetention(
      [point("bad", "not a date"), point("a", at(0)), point("b", at(1))],
      { keepRecent: 1, keepDaily: 0, keepWeekly: 0 },
    );
    expect(remove).not.toContain("bad");
    expect(keep).toEqual(["a"]);
    expect(remove).toEqual(["b"]);
  });

  it("rejects nonsense limits", () => {
    expect(() => normalizePolicy({ keepRecent: 0 })).toThrow();
    expect(() => normalizePolicy({ keepDaily: -1 })).toThrow();
    expect(() => normalizePolicy({ keepWeekly: 1.5 })).toThrow();
  });
});

import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAutoBackups } = require("./auto.cjs");
const { createActivityTracker } = require("./activity.cjs");
const settings = require("./settings.cjs");

const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

function setup({ activity, backups = [], config = {} }) {
  const sets = {
    configured: true,
    enabled: true,
    beforeRestart: true,
    beforeUpdate: true,
    keepRecent: 1,
    keepDaily: 0,
    keepWeekly: 0,
    maxTotalMb: null,
    lastSuccessAt: iso(Date.now() - 10 * HOUR),
    ...config,
  };
  vi.spyOn(settings, "getBackupSettings").mockReturnValue(sets);
  const list = [...backups];
  const createBackup = vi.fn(async (_db, _id, _p, _op, options) => ({
    id: `new-${list.length}`,
    kind: options.mode || "worldOnly",
    trigger: options.trigger,
    status: "completed",
    createdAt: iso(Date.now()),
  }));
  const deleteBackup = vi.fn(async (_db, id) => {
    list.splice(
      list.findIndex((b) => b.id === id),
      1,
    );
  });
  vi.spyOn(settings, "markSuccess").mockImplementation(() => {});
  const auto = createAutoBackups({
    createBackup,
    deleteBackup,
    listBackups: () => list,
    measureBytes: null,
    notifyFailure: vi.fn(),
    getActivity: () => activity,
  });
  return { auto, createBackup, deleteBackup };
}

const point = (id, ageH, extra = {}) => ({
  id,
  status: "completed",
  trigger: "scheduled",
  kind: "world",
  createdAt: iso(Date.now() - ageH * HOUR),
  ...extra,
});

describe("pre_update points", () => {
  it("are full-server and never gated by activity", async () => {
    const { auto, createBackup } = setup({
      activity: { online: false, lastActivityMs: null, trackingSinceMs: 0 },
      backups: [point("a", 5)],
    });
    const result = await auto.run({}, "s1", "pre_update");
    expect(result.status).toBe("created");
    expect(createBackup.mock.calls[0][4]).toEqual({
      trigger: "pre_update",
      mode: "fullServer",
    });
  });

  it("keeps the newest 2 full pre-update points out of retention", async () => {
    const full = (id, ageH) =>
      point(id, ageH, { trigger: "pre_update", kind: "fullServer" });
    const { auto, deleteBackup } = setup({
      activity: { online: true },
      backups: [
        point("s-new", 1),
        point("s-old", 9),
        full("u1", 20),
        full("u2", 30),
        full("u3", 40),
        point("legacy-update", 50, { trigger: "pre_update", kind: "world" }),
      ],
    });
    await auto.prune({}, "s1");
    const removed = deleteBackup.mock.calls.map((call) => call[1]).sort();
    expect(removed).toEqual(["legacy-update", "s-old", "u3"]);
  });
});

describe("scheduled backups and player activity", () => {
  const lastSuccessMs = Date.now() - 10 * HOUR;
  const cfg = { lastSuccessAt: iso(lastSuccessMs) };

  it("skips when nobody is online and activity predates the last success", async () => {
    const { auto, createBackup } = setup({
      activity: {
        online: false,
        lastActivityMs: lastSuccessMs - HOUR,
        trackingSinceMs: 0,
      },
      backups: [point("a", 10)],
      config: cfg,
    });
    expect(await auto.run({}, "s1", "scheduled")).toEqual({ status: "idle" });
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("skips when activity was never seen while we were watching all along", async () => {
    const { auto } = setup({
      activity: { online: false, lastActivityMs: null, trackingSinceMs: lastSuccessMs - 1 },
      backups: [point("a", 10)],
      config: cfg,
    });
    expect((await auto.run({}, "s1", "scheduled")).status).toBe("idle");
  });

  it("backs up when we started watching after the last success and saw nothing", async () => {
    const { auto, createBackup } = setup({
      activity: { online: false, lastActivityMs: null, trackingSinceMs: lastSuccessMs + HOUR },
      backups: [point("a", 10)],
      config: cfg,
    });
    expect((await auto.run({}, "s1", "scheduled")).status).toBe("created");
    expect(createBackup).toHaveBeenCalled();
  });

  it.each([
    ["someone is online", { online: true, lastActivityMs: 0, trackingSinceMs: 0 }, [point("a", 10)], cfg],
    ["activity is newer than the last success", { online: false, lastActivityMs: lastSuccessMs + 1, trackingSinceMs: 0 }, [point("a", 10)], cfg],
    ["there is no restore point yet", { online: false, lastActivityMs: 0, trackingSinceMs: 0 }, [], cfg],
    ["there was never a successful backup", { online: false, lastActivityMs: 0, trackingSinceMs: 0 }, [point("a", 10)], { lastSuccessAt: null }],
  ])("does not skip when %s", async (_label, activity, backups, config) => {
    const { auto, createBackup } = setup({ activity, backups, config });
    expect((await auto.run({}, "s1", "scheduled")).status).toBe("created");
    expect(createBackup).toHaveBeenCalled();
  });

  it("never gates pre_restart", async () => {
    const { auto } = setup({
      activity: { online: false, lastActivityMs: lastSuccessMs - HOUR, trackingSinceMs: 0 },
      backups: [point("a", 10)],
      config: cfg,
    });
    expect((await auto.run({}, "s1", "pre_restart")).status).toBe("created");
  });
});

describe("activity tracker", () => {
  const parseLine = (line) => {
    const m = /^((?:\[[^\]\n]*\]\s*)+):\s?([^\n]*)$/.exec(line);
    return m ? { header: m[1], message: m[2] } : { header: "", message: line };
  };
  const isPlayerControlled = (message) => /^<[^>\n]{1,64}>\s/.test(message);
  let clock = 1000;
  const make = () =>
    createActivityTracker({ parseLine, isPlayerControlled, now: () => clock });
  const line = (text) => `[12:00:00] [Server thread/INFO]: ${text}`;

  it("tracks who is online and when anyone last joined or left", () => {
    const tracker = make();
    expect(tracker.snapshot("s").online).toBe(false);
    clock = 2000;
    tracker.observe("s", line("Steve joined the game"));
    expect(tracker.snapshot("s")).toMatchObject({ online: true, lastActivityMs: 2000 });
    clock = 3000;
    tracker.observe("s", line("Steve left the game"));
    expect(tracker.snapshot("s")).toMatchObject({ online: false, lastActivityMs: 3000 });
  });

  it("ignores chat that imitates a join", () => {
    const tracker = make();
    tracker.observe("s", line("<Mallory> Steve joined the game"));
    expect(tracker.snapshot("s")).toMatchObject({ online: false, lastActivityMs: null });
  });

  it("counts players still on when the process dies as active until then", () => {
    const tracker = make();
    clock = 5000;
    tracker.observe("s", line("Alex joined the game"));
    clock = 9000;
    tracker.serverStopped("s");
    expect(tracker.snapshot("s")).toMatchObject({ online: false, lastActivityMs: 9000 });
  });
});

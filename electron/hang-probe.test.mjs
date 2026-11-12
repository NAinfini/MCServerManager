import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createHangProbe, probeWanted } = require("./hang-probe.cjs");

const REPLY = "[12:00:00] [Server thread/INFO]: There are 0 of a max of 20 players online: ";

function make(extra = {}) {
  const sendList = vi.fn();
  const onHung = vi.fn();
  const probe = createHangProbe({
    sendList,
    onHung,
    parseLine: (line) => ({ message: line.replace(/^.*?\]: /, "") }),
    ...extra,
  });
  return { probe, sendList, onHung };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("probeWanted", () => {
  it("is on only for max-tick-time -1 or 180000 and above", () => {
    expect(probeWanted({ "max-tick-time": "-1" })).toBe(true);
    expect(probeWanted({ "max-tick-time": "180000" })).toBe(true);
    expect(probeWanted({ "max-tick-time": "600000" })).toBe(true);
    expect(probeWanted({ "max-tick-time": "60000" })).toBe(false);
    expect(probeWanted({ "max-tick-time": "179999" })).toBe(false);
    expect(probeWanted({ "max-tick-time": "abc" })).toBe(false);
    expect(probeWanted({})).toBe(false);
    expect(probeWanted(null)).toBe(false);
  });
});

describe("hang probe", () => {
  it("stays quiet while the server keeps talking", () => {
    const { probe, sendList } = make();
    probe.start();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000);
      probe.onLine("tick");
    }
    expect(sendList).not.toHaveBeenCalled();
  });

  it("sends list after 60s of silence and treats any line within 30s as alive", () => {
    const { probe, sendList, onHung } = make();
    probe.start();
    vi.advanceTimersByTime(59_999);
    expect(sendList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sendList).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_000);
    probe.onLine("some unrelated output");
    vi.advanceTimersByTime(29_000);
    expect(sendList).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    expect(sendList).toHaveBeenCalledTimes(2);
    expect(onHung).not.toHaveBeenCalled();
  });

  it("declares the server hung after 5 unanswered probes, once", () => {
    const { probe, sendList, onHung } = make();
    probe.start();
    vi.advanceTimersByTime(60_000 + 5 * 30_000 - 1);
    expect(sendList).toHaveBeenCalledTimes(5);
    expect(onHung).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHung).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(sendList).toHaveBeenCalledTimes(5);
    expect(onHung).toHaveBeenCalledTimes(1);
  });

  it("an answer resets the unanswered count", () => {
    const { probe, onHung } = make();
    probe.start();
    vi.advanceTimersByTime(60_000 + 4 * 30_000);
    probe.onLine("alive");
    vi.advanceTimersByTime(60_000 + 4 * 30_000);
    expect(onHung).not.toHaveBeenCalled();
  });

  it("hides only its own reply, and only while a probe is outstanding", () => {
    const { probe } = make();
    probe.start();
    expect(probe.onLine(REPLY)).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(probe.onLine("[12:00:00] [Server thread/INFO]: Steve joined the game")).toBe(false);
    // Another line already ended the wait; the reply is still hidden.
    expect(probe.onLine(REPLY)).toBe(true);
    expect(probe.onLine(REPLY)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    probe.onLine("x");
    expect(probe.onLine(REPLY)).toBe(false);
  });

  it("is paused for a backup and starts a fresh silence window after", () => {
    const { probe, sendList, onHung } = make();
    probe.start();
    vi.advanceTimersByTime(50_000);
    probe.pause("backup");
    vi.advanceTimersByTime(20 * 60_000);
    expect(sendList).not.toHaveBeenCalled();
    probe.resume("backup");
    vi.advanceTimersByTime(59_000);
    expect(sendList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(sendList).toHaveBeenCalledTimes(1);
    expect(onHung).not.toHaveBeenCalled();
  });

  it("pausing mid-probe forgets the misses; two reasons both have to clear", () => {
    const { probe, sendList, onHung } = make();
    probe.start();
    vi.advanceTimersByTime(60_000 + 3 * 30_000);
    probe.pause("backup");
    probe.pause("stopping");
    probe.resume("backup");
    vi.advanceTimersByTime(60 * 60_000);
    expect(sendList).toHaveBeenCalledTimes(4);
    probe.resume("stopping");
    vi.advanceTimersByTime(60_000 + 4 * 30_000);
    expect(onHung).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onHung).toHaveBeenCalledTimes(1);
  });

  it("stop ends everything, and a throwing pipe counts as unanswered", () => {
    const { probe, sendList, onHung } = make({
      sendList: () => {
        throw new Error("EPIPE");
      },
    });
    probe.start();
    vi.advanceTimersByTime(60_000 + 5 * 30_000);
    expect(onHung).toHaveBeenCalledTimes(1);
    const other = make();
    other.probe.start();
    other.probe.stop();
    vi.advanceTimersByTime(60 * 60_000);
    expect(other.sendList).not.toHaveBeenCalled();
    expect(sendList).not.toHaveBeenCalled();
  });
});

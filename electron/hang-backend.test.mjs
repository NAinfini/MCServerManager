import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("./backend.cjs");

let root, backend, children;
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn(() => child.emit("exit", 1));
  return child;
}
const READY = "[12:00:00] [Server thread/INFO]: Done (3.2s)! For help, type \"help\"\n";
const writes = (child) => child.stdin.write.mock.calls.map(([text]) => text);

async function startServer(maxTickTime) {
  const s = backend.handle("create_server_profile", {
    input: {
      source: { kind: "blank" },
      name: "hang",
      rootDir: path.join(root, "hang"),
      loaderType: "fabric",
      minecraftVersion: "1.21.4",
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
    },
  });
  write(path.join(s.rootDir, "server.jar"), "jar");
  if (maxTickTime !== null)
    write(path.join(s.rootDir, "server.properties"), `max-tick-time=${maxTickTime}\n`);
  await backend.handle("start_server", { serverId: s.id });
  return s;
}
const events = (s) =>
  backend.handle("list_process_events", { serverId: s.id }).map((e) => e.message);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-hang-"));
  children = [];
  backend = createBackend({
    getPath: () => path.join(root, "app"),
    checkPortAvailable: async () => true,
    collectProcessMetrics: async () => null,
    runtimeDependencies: {
      inspectJava: () => ({ majorVersion: 21, architecture: "x64" }),
    },
    spawn: () => {
      const created = fakeChild(51000 + children.length);
      children.push(created);
      return created;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  backend?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("hang probe in the backend", () => {
  it("probes a silent server, hides its reply, and kills an unresponsive one as a crash", async () => {
    vi.useFakeTimers();
    const s = await startServer(-1);
    const [child] = children;
    child.stdout.emit("data", READY);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes(child)).toEqual(["list\n"]);
    child.stdout.emit(
      "data",
      "[12:01:00] [Server thread/INFO]: There are 0 of a max of 20 players online: \n",
    );
    const log = events(s).join("\n");
    expect(log).not.toContain("There are 0 of a max");
    expect(log).not.toContain("> list");
    // Silent again: five unanswered probes in a row.
    await vi.advanceTimersByTimeAsync(60_000 + 5 * 30_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(events(s).some((m) => /stopped responding/.test(m))).toBe(true);
    const status = backend.handle("get_server_process_status", { serverId: s.id });
    expect(status.status).toBe("crashed");
  });

  it("does not probe with the default max-tick-time, or before the server is ready", async () => {
    vi.useFakeTimers();
    await startServer(60000);
    const [child] = children;
    child.stdout.emit("data", READY);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(writes(child)).toEqual([]);
  });

  it("does not probe a server that never became ready", async () => {
    vi.useFakeTimers();
    await startServer(-1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(writes(children[0])).toEqual([]);
  });

  it("stops probing once a stop is requested", async () => {
    vi.useFakeTimers();
    const s = await startServer(-1);
    const [child] = children;
    child.stdout.emit("data", READY);
    await vi.advanceTimersByTimeAsync(30_000);
    backend.handle("stop_server", { serverId: s.id });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(writes(child).filter((text) => text === "list\n")).toEqual([]);
  });
});

describe("scheduled backups skip an idle server", () => {
  it("skips when nobody played since the last backup, runs once someone does", async () => {
    const { DatabaseSync } = require("node:sqlite");
    const line = (text) => `[12:00:00] [Server thread/INFO]: ${text}
`;
    const s = await startServer(null);
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    children[0].stdout.emit("data", line("Steve joined the game"));
    children[0].stdout.emit("data", line("Steve left the game"));
    children[0].kill();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = await backend.handle("create_world_backup", {
      input: { serverId: s.id },
    });
    expect(first.status).toBe("completed");
    const dbFile = path.join(root, "app", "mc-server-manager.sqlite");
    const due = () => {
      const db = new DatabaseSync(dbFile);
      db.prepare(
        "UPDATE server_backup_settings SET enabled = 1, next_run_at = ?, last_success_at = ? WHERE server_id = ?",
      ).run(
        new Date(Date.now() - 1000).toISOString(),
        new Date().toISOString(),
        s.id,
      );
      db.close();
    };
    const count = () =>
      backend.handle("list_server_backups", { serverId: s.id }).length;
    due();
    const before = await backend.handle("get_backup_status", { serverId: s.id });
    await backend.handle("run_due_scheduled_tasks");
    expect(count()).toBe(1);
    const status = await backend.handle("get_backup_status", { serverId: s.id });
    expect(new Date(status.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(status.lastSuccessAt).toBe(before.lastSuccessAt);
    // Someone is on the server again.
    write(path.join(s.rootDir, "world", "level.dat"), "level-2");
    await backend.handle("start_server", { serverId: s.id });
    children[1].stdout.emit("data", READY);
    children[1].stdout.emit("data", line("Alex joined the game"));
    due();
    const run = backend.handle("run_due_scheduled_tasks");
    await new Promise((resolve) => setTimeout(resolve, 100));
    children[1].stdout.emit("data", line("Saved the game"));
    await run;
    expect(count()).toBe(2);
  });
});

import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  BACKOFF_MS,
  MAX_RESTARTS,
  STABLE_MS,
  createPlayitAgent,
  locatePlayit,
  scrubLine,
} = require("./playit.cjs");
const {
  createPlayitService,
  normalizePublicAddress,
} = require("./playit-service.cjs");

const EXE = "C:\\Program Files\\playit_gg\\bin\\playit.exe";
const SECRET = "C:\\Users\\me\\AppData\\Local\\playit_gg\\playit.toml";
const env = {
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  PATH: "",
};

function harness({ files = [EXE, SECRET], settings = {} } = {}) {
  const present = new Set(files);
  const spawned = [];
  const timers = [];
  const drops = [];
  const spawn = (exe, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + spawned.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit("exit", null));
    };
    spawned.push({ exe, args, options, child });
    return child;
  };
  const setTimer = (fn, ms) => {
    const timer = { fn, ms, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cleared = true;
  };
  const agent = createPlayitAgent({
    spawn,
    existsSync: (file) => present.has(file),
    env,
    platform: "win32",
    setTimer,
    clearTimer,
    getSettings: () => ({ exePath: null, stopWhenIdle: true, ...settings }),
    onDrop: (info) => drops.push(info),
  });
  const fire = (ms) => {
    const timer = timers.find((item) => !item.cleared && item.ms === ms);
    if (!timer) throw new Error(`no pending timer for ${ms}`);
    timer.cleared = true;
    timer.fn();
  };
  return { agent, spawned, drops, present, fire, timers };
}

describe("playit agent", () => {
  it("locates the executable and reports the install state", () => {
    expect(
      locatePlayit({
        existsSync: (file) => file === EXE,
        env: { ProgramFiles: "C:\\Program Files", PATH: "" },
        platform: "win32",
      }),
    ).toBe(EXE);

    const { agent } = harness({ files: [] });
    expect(agent.status().state).toBe("not_installed");
    expect(harness({ files: [EXE] }).agent.status().state).toBe("needs_setup");
    expect(harness().agent.status().state).toBe("stopped");
  });

  it("does not spawn when it is not installed or not signed in", () => {
    const missing = harness({ files: [] });
    missing.agent.acquire("a");
    expect(missing.spawned).toHaveLength(0);
    const unclaimed = harness({ files: [EXE] });
    unclaimed.agent.acquire("a");
    expect(unclaimed.spawned).toHaveLength(0);
    expect(unclaimed.agent.status().state).toBe("needs_setup");
  });

  it("spawns hidden, reports starting, and only claims running once it stays up", () => {
    const { agent, spawned, fire } = harness();
    agent.acquire("a");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].exe).toBe(EXE);
    expect(spawned[0].args).toEqual(["-s", "run"]);
    expect(spawned[0].options.windowsHide).toBe(true);
    expect(agent.status().state).toBe("starting");
    fire(STABLE_MS);
    expect(agent.status().state).toBe("running");
  });

  it("refcounts: stopping one server keeps the agent for the other", async () => {
    const { agent, spawned } = harness();
    agent.acquire("a");
    agent.acquire("b");
    agent.acquire("b");
    expect(spawned).toHaveLength(1);
    agent.release("a");
    expect(spawned[0].child.killed).toBe(false);
    expect(agent.status().activeServerIds).toEqual(["b"]);
    agent.release("b");
    expect(spawned[0].child.killed).toBe(true);
    await Promise.resolve();
    expect(agent.status().state).toBe("stopped");
  });

  it("leaves the agent running when the setting says not to stop it", () => {
    const { agent, spawned } = harness({ settings: { stopWhenIdle: false } });
    agent.acquire("a");
    agent.release("a");
    expect(spawned[0].child.killed).toBe(false);
  });

  it("notices an unexpected exit once and restarts with backoff", () => {
    const { agent, spawned, drops, fire } = harness();
    agent.acquire("a");
    spawned[0].child.emit("exit", 1);
    expect(drops).toHaveLength(1);
    expect(drops[0].serverIds).toEqual(["a"]);
    expect(agent.status().state).toBe("disconnected");
    fire(BACKOFF_MS[0]);
    expect(spawned).toHaveLength(2);
    spawned[1].child.emit("exit", 1);
    expect(drops).toHaveLength(1);
    fire(BACKOFF_MS[1]);
    expect(spawned).toHaveLength(3);
  });

  it("reports again after a recovery and a second drop", () => {
    const { agent, spawned, drops, fire } = harness();
    agent.acquire("a");
    spawned[0].child.emit("exit", 1);
    fire(BACKOFF_MS[0]);
    fire(STABLE_MS);
    spawned[1].child.emit("exit", 1);
    expect(drops).toHaveLength(2);
  });

  it("gives up after too many failed restarts", () => {
    const { agent, spawned, fire } = harness();
    agent.acquire("a");
    for (let attempt = 0; attempt < MAX_RESTARTS; attempt += 1) {
      spawned.at(-1).child.emit("exit", 1);
      fire(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
    spawned.at(-1).child.emit("exit", 1);
    expect(spawned).toHaveLength(MAX_RESTARTS + 1);
    expect(agent.status().gaveUp).toBe(true);
    expect(agent.status().state).toBe("disconnected");
  });

  it("does not restart or notify when the exit was requested", async () => {
    const { agent, spawned, drops } = harness();
    agent.acquire("a");
    agent.release("a");
    await Promise.resolve();
    expect(drops).toHaveLength(0);
    expect(spawned).toHaveLength(1);
  });

  it("dispose kills the agent", () => {
    const { agent, spawned } = harness();
    agent.acquire("a");
    agent.dispose();
    expect(spawned[0].child.killed).toBe(true);
  });

  it("keeps a scrubbed error line from output", () => {
    const { agent, spawned } = harness();
    agent.acquire("a");
    spawned[0].child.stdout.emit(
      "data",
      "INFO ok\nERROR auth failed secret=abcdef0123456789abcdef0123456789abcd\n",
    );
    const { lastError } = agent.status();
    expect(lastError).toContain("failed");
    expect(lastError).not.toMatch(/abcdef0123456789/);
    expect(scrubLine("key: hunter2")).toBe("key: [redacted]");
  });
});

function serviceHarness() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE servers (id TEXT PRIMARY KEY); INSERT INTO servers VALUES ('s1'), ('s2');",
  );
  const h = harness();
  const drops = [];
  const running = new Set();
  const service = createPlayitService({
    db,
    nowIso: () => "2026-01-01T00:00:00.000Z",
    isServerRunning: (id) => running.has(id),
    notifyDrop: (serverId) => drops.push(serverId),
    // Never the real agent: nothing is installed as far as this test knows.
    agentOptions: {
      spawn: () => {
        throw new Error("the service test must not spawn");
      },
      existsSync: () => false,
    },
  });
  return { db, service, drops, running, h };
}

describe("playit service", () => {
  it("normalizes public addresses and rejects junk", () => {
    expect(normalizePublicAddress("  minecraft://Foo.JoinMC.link/ ")).toBe(
      "foo.joinmc.link",
    );
    expect(normalizePublicAddress("foo.joinmc.link:25565")).toBe(
      "foo.joinmc.link:25565",
    );
    expect(normalizePublicAddress("")).toBeNull();
    expect(() => normalizePublicAddress("not an address")).toThrow();
    expect(() => normalizePublicAddress("a.b:99999")).toThrow();
  });

  it("saves per-server settings and is safe to set up twice", () => {
    const { db, service } = serviceHarness();
    // Creating the schema again on an existing database must not fail.
    createPlayitService({ db, nowIso: () => "x" });
    const saved = service.commands.save_server_share_settings({
      input: {
        serverId: "s1",
        publicAddress: "Foo.joinmc.link",
        startTunnelWithServer: true,
      },
    });
    expect(saved).toEqual({
      serverId: "s1",
      publicAddress: "foo.joinmc.link",
      startTunnelWithServer: true,
    });
    expect(
      service.commands.get_server_share_settings({ serverId: "s2" }),
    ).toEqual({
      serverId: "s2",
      publicAddress: null,
      startTunnelWithServer: false,
    });
    const kept = service.commands.save_server_share_settings({
      input: { serverId: "s1", startTunnelWithServer: false },
    });
    expect(kept.publicAddress).toBe("foo.joinmc.link");
    service.dispose();
  });

  it("only drives the agent for servers that opted in", () => {
    const { service } = serviceHarness();
    service.commands.save_server_share_settings({
      input: { serverId: "s1", startTunnelWithServer: true },
    });
    service.serverStarted("s2");
    expect(service.commands.get_playit_status().activeServerIds).toEqual([]);
    service.serverStarted("s1");
    expect(service.commands.get_playit_status().activeServerIds).toEqual([
      "s1",
    ]);
    service.serverStopped("s1");
    expect(service.commands.get_playit_status().activeServerIds).toEqual([]);
    service.dispose();
  });
});

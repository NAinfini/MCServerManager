import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("../backend.cjs");
const backupFiles = require("../backend/backup-files.cjs");
const { DatabaseSync } = require("node:sqlite");
const realSetTimeout = setTimeout;

let root, backend;
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = (file) => fs.readFileSync(file, "utf8");
const call = (command, input) => backend.handle(command, { input });
const server = (name = "server") =>
  call("create_server_profile", {
    source: { kind: "blank" },
    name,
    rootDir: path.join(root, name),
    loaderType: "fabric",
    minecraftVersion: "1.21.4",
    serverPort: 25565,
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
  });
const dbPath = () => path.join(root, "app", "mc-server-manager.sqlite");
function database(action) {
  const db = new DatabaseSync(dbPath());
  try {
    return action(db);
  } finally {
    db.close();
  }
}
const backups = (s) => backend.handle("list_server_backups", { serverId: s.id });
const settingsOf = (s) => backend.handle("get_backup_settings", { serverId: s.id });
const makeDue = (s) =>
  database((db) =>
    db
      .prepare(
        "UPDATE server_backup_settings SET next_run_at = ? WHERE server_id = ?",
      )
      .run(new Date(Date.now() - 1000).toISOString(), s.id),
  );
async function until(condition, label = "condition") {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await new Promise((resolve) => realSetTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function fakeChild(pid = 44444) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn(() => child.emit("exit", 0));
  return child;
}
function closeBackend() {
  const current = backend;
  backend = null;
  current?.close();
}
function newBackend(children) {
  closeBackend();
  backend = createBackend({
    getPath: () => path.join(root, "app"),
    checkPortAvailable: async () => true,
    collectProcessMetrics: async () => null,
    runtimeDependencies: {
      inspectJava: () => ({ majorVersion: 21, architecture: "x64" }),
    },
    spawn: () => {
      const created = fakeChild(40000 + children.length);
      children.push(created);
      return created;
    },
  });
}
const saved = (child) =>
  child.stdout.emit("data", "[12:00:00] [Server thread/INFO]: Saved the game\n");
const writes = (child) => child.stdin.write.mock.calls.map(([text]) => text);

async function managedServer(name = "server") {
  const children = [];
  newBackend(children);
  const s = server(name);
  write(path.join(s.rootDir, "server.jar"), "jar");
  write(path.join(s.rootDir, "world", "level.dat"), "level-1");
  await backend.handle("start_server", { serverId: s.id });
  return { s, children, child: children[0] };
}
/* Points the backup location at a path that can never be a directory, so the
   snapshot fails after the world has been flushed. */
function breakBackupLocation(s) {
  const blocker = path.join(root, "blocker");
  write(blocker, "i am a file");
  database((db) =>
    db
      .prepare(
        "UPDATE server_backup_settings SET location = ? WHERE server_id = ?",
      )
      .run(path.join(blocker, "nested"), s.id),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-backups-"));
  newBackend([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeBackend();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("backup defaults and migration", () => {
  it("turns backups on for a new server: every 6h, before restart, before update", () => {
    const s = server();
    expect(settingsOf(s)).toMatchObject({
      configured: true,
      enabled: true,
      intervalMinutes: 360,
      beforeRestart: true,
      beforeUpdate: true,
      keepRecent: 8,
      keepDaily: 5,
      keepWeekly: 2,
      maxTotalMb: null,
      location: null,
    });
    const next = new Date(settingsOf(s).nextRunAt).getTime() - Date.now();
    expect(next).toBeGreaterThan(5.9 * 3_600_000);
    expect(next).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it("does not switch backups on for a server that existed before", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    // An existing server has no settings row at all.
    database((db) => db.exec("DELETE FROM server_backup_settings"));
    expect(settingsOf(s)).toMatchObject({ configured: false, enabled: false });
    await backend.handle("run_due_scheduled_tasks");
    expect(backups(s)).toEqual([]);
  });

  it("adds its columns to an existing database and keeps every old row", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    const old = await call("create_world_backup", { serverId: s.id });
    closeBackend();
    // Put the database back to the shape it had before this feature.
    database((db) => {
      db.exec("DROP TABLE server_backup_settings");
      for (const column of ["trigger_kind", "format", "logical_bytes", "new_bytes"])
        db.exec(`ALTER TABLE backups DROP COLUMN ${column}`);
    });
    newBackend([]);
    const [row] = backups(s);
    expect(row).toMatchObject({
      id: old.id,
      status: "completed",
      trigger: "manual",
      format: "full",
      sizeBytes: old.sizeBytes,
      logicalBytes: old.sizeBytes,
      newBytes: old.sizeBytes,
    });
    // The server that predates the table stays off.
    expect(settingsOf(s).enabled).toBe(false);
    await backend.handle("restore_world_backup", {
      input: { backupId: old.id, confirm: true },
    });
  });

  it("keeps an old full-copy row listed and restorable", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "from-old-backup");
    const archive = path.join(s.rootDir, "backups", "old-copy");
    const manifest = await backupFiles.writeSnapshot({
      root: s.rootDir,
      archive,
      mode: "worldOnly",
      includes: ["world"],
      excludes: [],
      worldName: "world",
      serverState: null,
    });
    // Exactly the columns the previous version wrote.
    database((db) =>
      db
        .prepare(
          `INSERT INTO backups (id, server_id, profile_id, kind, archive_path, manifest_sha256, world_name, size_bytes, status, created_at)
           VALUES ('old-1', ?, NULL, 'world', ?, ?, 'world', ?, 'completed', '2026-01-01T00:00:00.000Z')`,
        )
        .run(
          s.id,
          archive,
          createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
          15,
        ),
    );
    expect(backups(s)[0]).toMatchObject({
      id: "old-1",
      format: "full",
      trigger: "manual",
      sizeBytes: 15,
    });
    write(path.join(s.rootDir, "world", "level.dat"), "ruined");
    await backend.handle("restore_world_backup", {
      input: { backupId: "old-1", confirm: true },
    });
    expect(read(path.join(s.rootDir, "world", "level.dat"))).toBe(
      "from-old-backup",
    );
    // A new snapshot never links to a full copy (it has no mtimes).
    const fresh = await call("create_world_backup", { serverId: s.id });
    expect(fresh.format).toBe("incremental");
    expect(fresh.newBytes).toBe(fresh.logicalBytes);
  });

  it("keeps an old zip-shaped row listed, exportable and restorable", async () => {
    const s = server();
    const zipPath = path.join(s.rootDir, "backups", "old-zip.zip");
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from("from-old-zip"), "world/level.dat");
    zip.addBuffer(Buffer.from("r"), "world/region/r.0.0.mca");
    zip.end();
    const output = fs.createWriteStream(zipPath);
    zip.outputStream.pipe(output);
    await finished(output);
    database((db) =>
      db
        .prepare(
          `INSERT INTO backups (id, server_id, profile_id, kind, archive_path, world_name, size_bytes, status, created_at)
           VALUES ('zip-1', ?, NULL, 'world', ?, 'world', 13, 'completed', '2026-01-01T00:00:00.000Z')`,
        )
        .run(s.id, zipPath),
    );
    expect(backups(s)[0]).toMatchObject({ id: "zip-1", archivePath: zipPath });

    const preview = await call("preview_backup_restore", {
      serverId: s.id,
      backupId: "zip-1",
    });
    expect(preview).toMatchObject({ fileCount: 2, mode: "worldOnly" });

    write(path.join(s.rootDir, "world", "level.dat"), "ruined");
    await backend.handle("restore_world_backup", {
      input: { backupId: "zip-1", confirm: true },
    });
    expect(read(path.join(s.rootDir, "world", "level.dat"))).toBe(
      "from-old-zip",
    );
    // No scratch folders are left behind.
    expect(
      fs.readdirSync(path.join(s.rootDir, "backups")).filter((n) => n.startsWith(".")),
    ).toEqual([]);

    const exported = await call("export_server_backup", {
      backupId: "zip-1",
      targetDir: path.join(root, "out"),
      format: "zip",
    });
    expect(fs.readFileSync(exported.exportedPath).subarray(0, 2).toString()).toBe(
      "PK",
    );
  });
});

describe("incremental backups through the backend", () => {
  it("stores snapshots as folders, reports logical and new bytes, and restores them", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    write(path.join(s.rootDir, "world", "region", "r.0.0.mca"), "r".repeat(100));
    const first = await call("create_world_backup", { serverId: s.id });
    expect(first).toMatchObject({
      format: "incremental",
      trigger: "manual",
      logicalBytes: 107,
      newBytes: 107,
    });
    expect(fs.statSync(first.archivePath).isDirectory()).toBe(true);
    write(path.join(s.rootDir, "world", "level.dat"), "level-2-changed");
    const second = await call("create_world_backup", { serverId: s.id });
    expect(second.logicalBytes).toBe(115);
    expect(second.newBytes).toBe(15);
    const status = await backend.handle("get_backup_status", { serverId: s.id });
    expect(status.restorePointCount).toBe(2);
    // 100 shared + 7 + 15, not 107 + 115.
    expect(status.usedBytes).toBe(122);

    await backend.handle("restore_world_backup", {
      input: { backupId: first.id, confirm: true },
    });
    expect(read(path.join(s.rootDir, "world", "level.dat"))).toBe("level-1");
    // Deleting the older point leaves the newer one fully restorable.
    await backend.handle("delete_server_backup", { backupId: first.id });
    await backend.handle("restore_world_backup", {
      input: { backupId: second.id, confirm: true },
    });
    expect(read(path.join(s.rootDir, "world", "level.dat"))).toBe(
      "level-2-changed",
    );
    expect(read(path.join(s.rootDir, "world", "region", "r.0.0.mca"))).toBe(
      "r".repeat(100),
    );
  });

  it("exports a zip only when asked", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    const made = await call("create_world_backup", { serverId: s.id });
    expect(fs.readdirSync(path.dirname(made.archivePath)).some((n) => n.endsWith(".zip"))).toBe(false);
    const exported = await call("export_server_backup", {
      backupId: made.id,
      targetDir: path.join(root, "out"),
      format: "zip",
    });
    expect(exported.exportedPath.endsWith(".zip")).toBe(true);
    expect(fs.readFileSync(exported.exportedPath).subarray(0, 2).toString()).toBe(
      "PK",
    );
  });

  it("skips an automatic point identical to the last one but notes the check", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    makeDue(s);
    await backend.handle("run_due_scheduled_tasks");
    expect(backups(s)).toHaveLength(1);
    expect(backups(s)[0].trigger).toBe("scheduled");
    makeDue(s);
    await backend.handle("run_due_scheduled_tasks");
    expect(backups(s)).toHaveLength(1);
    const status = await backend.handle("get_backup_status", { serverId: s.id });
    expect(new Date(status.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(status.lastSuccessAt >= backups(s)[0].createdAt).toBe(true);
  });

  it("prunes only automatic points and never a manual one", async () => {
    const s = server();
    call("save_backup_settings", {
      serverId: s.id,
      enabled: true,
      intervalMinutes: 60,
      beforeRestart: true,
      beforeUpdate: true,
      keepRecent: 2,
      keepDaily: 0,
      keepWeekly: 0,
    });
    write(path.join(s.rootDir, "world", "level.dat"), "manual-point");
    const manual = await call("create_world_backup", { serverId: s.id });
    for (let i = 0; i < 4; i++) {
      write(path.join(s.rootDir, "world", "level.dat"), `auto-${i}-${"x".repeat(i)}`);
      makeDue(s);
      // No player ever joins here, so forget the last success: otherwise the
      // idle gate (correctly) skips every run after the first.
      database((db) =>
        db
          .prepare(
            "UPDATE server_backup_settings SET last_success_at = NULL WHERE server_id = ?",
          )
          .run(s.id),
      );
      await backend.handle("run_due_scheduled_tasks");
    }
    const list = backups(s);
    expect(list.filter((b) => b.trigger === "scheduled")).toHaveLength(2);
    expect(list.map((b) => b.id)).toContain(manual.id);
    // The surviving newest point is complete even though older ones were removed.
    const newest = list[0];
    write(path.join(s.rootDir, "world", "level.dat"), "ruined");
    await backend.handle("restore_world_backup", {
      input: { backupId: newest.id, confirm: true },
    });
    expect(read(path.join(s.rootDir, "world", "level.dat"))).toMatch(/^auto-3/);
  });

  it("validates settings and refuses a location inside the server folder", () => {
    const s = server();
    const base = {
      serverId: s.id,
      enabled: true,
      intervalMinutes: 360,
      beforeRestart: true,
      beforeUpdate: true,
      keepRecent: 24,
      keepDaily: 7,
      keepWeekly: 4,
    };
    expect(() =>
      call("save_backup_settings", { ...base, intervalMinutes: 5 }),
    ).toThrow(/interval/);
    expect(() =>
      call("save_backup_settings", { ...base, keepRecent: 0 }),
    ).toThrow(/retention/);
    expect(() =>
      call("save_backup_settings", {
        ...base,
        location: path.join(s.rootDir, "snapshots"),
      }),
    ).toThrow(/outside the server folder/);
    const other = path.join(root, "second-disk");
    expect(call("save_backup_settings", { ...base, location: other }).location).toBe(
      other,
    );
    expect(fs.existsSync(path.join(other, s.id))).toBe(true);
  });

  it("writes to the chosen location", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "level-1");
    const other = path.join(root, "second-disk");
    call("save_backup_settings", {
      serverId: s.id,
      enabled: true,
      intervalMinutes: 360,
      beforeRestart: true,
      beforeUpdate: true,
      keepRecent: 24,
      keepDaily: 7,
      keepWeekly: 4,
      location: other,
    });
    const made = await call("create_world_backup", { serverId: s.id });
    expect(made.archivePath.startsWith(path.join(other, s.id))).toBe(true);
    expect(read(path.join(made.archivePath, "world", "level.dat"))).toBe("level-1");
  });
});

describe("a failed backup is loud and never leaves saving off", () => {
  it("sends save-on, raises an in-app and a system notification", async () => {
    const { s, child } = await managedServer();
    breakBackupLocation(s);
    const seen = [];
    backend.onServerEvent((event) => seen.push(event));
    const pending = call("create_world_backup", { serverId: s.id });
    await until(() => writes(child).includes("save-all flush\n"), "flush");
    saved(child);
    await expect(pending).rejects.toBeTruthy();

    const sent = writes(child);
    expect(sent.indexOf("save-off\n")).toBeGreaterThanOrEqual(0);
    expect(sent.lastIndexOf("save-on\n")).toBeGreaterThan(sent.indexOf("save-off\n"));
    expect(sent.at(-1)).toBe("save-on\n");

    const events = backend.handle("list_notification_events");
    expect(events[0]).toMatchObject({
      kind: "backup_failed",
      severity: "error",
      serverId: s.id,
    });
    const notification = seen.find((event) => event.kind === "notification");
    expect(notification.payload).toMatchObject({
      kind: "backup_failed",
      severity: "error",
      desktop: true,
    });
    // No half-written snapshot and no row.
    expect(backups(s)).toEqual([]);
  });

  it("sends save-on when the flush itself is never confirmed", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    const pending = call("create_world_backup", { serverId: s.id });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "BACKUP_SAVE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(writes(child).at(-1)).toBe("save-on\n");
    vi.useRealTimers();
    expect(backend.handle("list_notification_events")[0]).toMatchObject({
      kind: "backup_failed",
    });
  });
});

describe("scheduled restart", () => {
  async function scheduleRestart(s) {
    const task = call("create_scheduled_task", {
      serverId: s.id,
      name: "Nightly restart",
      kind: "restart",
      intervalMinutes: 1440,
    });
    database((db) =>
      db
        .prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), task.id),
    );
    const runs = await backend.handle("run_due_scheduled_tasks");
    expect(runs[0].status).toBe("completed");
  }

  it("warns players, backs up just before restarting, then restarts", async () => {
    const { s, children, child } = await managedServer();
    vi.useFakeTimers();
    await scheduleRestart(s);
    // The countdown warns players; nothing restarts yet.
    expect(writes(child).some((text) => text.startsWith("say Server restarting"))).toBe(
      true,
    );
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000);
    vi.useRealTimers();
    await until(() => writes(child).includes("save-all flush\n"), "pre-restart flush");
    saved(child);
    await until(() => writes(child).includes("stop\n"), "stop");
    child.emit("exit", 0);
    await until(() => children.length === 2, "restart");
    const [point] = backups(s);
    expect(point).toMatchObject({ trigger: "pre_restart", status: "completed" });
    // The backup finished and saving came back on before the process stopped.
    const sent = writes(child);
    expect(sent.indexOf("save-all flush\n")).toBeLessThan(sent.indexOf("save-on\n"));
    expect(sent.indexOf("save-on\n")).toBeLessThan(sent.indexOf("stop\n"));
  });

  it("still restarts when the pre-restart backup fails, and notifies", async () => {
    const { s, children, child } = await managedServer();
    breakBackupLocation(s);
    vi.useFakeTimers();
    await scheduleRestart(s);
    await vi.advanceTimersByTimeAsync(300_000);
    vi.useRealTimers();
    await until(() => writes(child).includes("save-all flush\n"), "pre-restart flush");
    saved(child);
    await until(() => writes(child).includes("stop\n"), "stop");
    child.emit("exit", 0);
    await until(() => children.length === 2, "restart after failed backup");
    expect(backups(s)).toEqual([]);
    expect(backend.handle("list_notification_events")[0]).toMatchObject({
      kind: "backup_failed",
      severity: "error",
    });
    expect(writes(child)).toContain("save-on\n");
  });

  it("does not take a pre-restart backup when it is switched off", async () => {
    const { s, children, child } = await managedServer();
    call("save_backup_settings", {
      serverId: s.id,
      enabled: true,
      intervalMinutes: 360,
      beforeRestart: false,
      beforeUpdate: true,
      keepRecent: 24,
      keepDaily: 7,
      keepWeekly: 4,
    });
    vi.useFakeTimers();
    await scheduleRestart(s);
    await vi.advanceTimersByTimeAsync(300_000);
    vi.useRealTimers();
    await until(() => writes(child).includes("stop\n"), "stop");
    child.emit("exit", 0);
    await until(() => children.length === 2, "restart");
    expect(writes(child)).not.toContain("save-all flush\n");
    expect(backups(s)).toEqual([]);
  });
});

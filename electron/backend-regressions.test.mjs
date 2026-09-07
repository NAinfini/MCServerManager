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
const { createBackend } = require("./backend.cjs");
const { DatabaseSync } = require("node:sqlite");
const originalFetch = globalThis.fetch;
let root, backend;
const hash = (value, algorithm = "sha256") =>
  createHash(algorithm).update(value).digest("hex");
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const call = (command, input) => backend.handle(command, { input });
const server = (name = "server", loaderType = "fabric") =>
  call("create_server_profile", {
    source: { kind: "blank" },
    name,
    rootDir: path.join(root, name),
    loaderType,
    minecraftVersion: "1.21.4",
    serverPort: 25565,
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
  });
const version = (id, number, overrides = {}) => ({
  id,
  project_id: "audit",
  name: "Audit",
  version_number: number,
  game_versions: ["1.21.4"],
  loaders: ["fabric"],
  files: [
    {
      filename: `audit-${number}.jar`,
      primary: true,
      url: `https://cdn.modrinth.com/audit-${number}.jar`,
      hashes: { sha512: hash(`jar-${number}`, "sha512") },
    },
  ],
  dependencies: [],
  ...overrides,
});
function mockVersions(versions) {
  globalThis.fetch = vi.fn(async (url) =>
    String(url).includes("/project/audit/version")
      ? Response.json(versions)
      : new Response(`jar-${String(url).match(/audit-(.+)\.jar$/)?.[1]}`),
  );
}
function database(action) {
  const db = new DatabaseSync(
    path.join(root, "app", "mc-server-manager.sqlite"),
  );
  try {
    return action(db);
  } finally {
    db.close();
  }
}
async function jar(file, text) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.from(`Manifest-Version: 1.0\nMain-Class: Test\n${text}\n`),
    "META-INF/MANIFEST.MF",
  );
  zip.end();
  const output = fs.createWriteStream(file);
  zip.outputStream.pipe(output);
  await finished(output);
  return fs.readFileSync(file);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-regressions-"));
  backend = createBackend({
    getPath: () => path.join(root, "app"),
    checkPortAvailable: async () => true,
    runtimeDependencies: {
      inspectJava: () => ({ majorVersion: 21, architecture: "x64" }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  backend.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("backup scopes and verified restoration", () => {
  it("backs up a named world and every existing Paper dimension", async () => {
    const s = server("paper", "paper");
    write(path.join(s.rootDir, "server.properties"), "level-name=survival\n");
    for (const dimension of ["survival", "survival_nether", "survival_the_end"])
      write(path.join(s.rootDir, dimension, "level.dat"), dimension);
    const backup = await call("create_world_backup", { serverId: s.id });
    expect(backup.worldName).toBe("survival");
    expect(
      await call("preview_backup_restore", {
        serverId: s.id,
        backupId: backup.id,
      }),
    ).toMatchObject({
      mode: "worldOnly",
      fileCount: 3,
      relativePaths: ["survival", "survival_nether", "survival_the_end"],
    });
    await call("restore_world_backup", {
      backupId: backup.id,
      targetWorldDir: "restored",
      confirm: true,
    });
    expect(
      fs.readFileSync(
        path.join(s.rootDir, "restored_the_end", "level.dat"),
        "utf8",
      ),
    ).toBe("survival_the_end");
  });
  it("refuses empty world backups without recording success", async () => {
    const s = server();
    await expect(
      call("create_world_backup", { serverId: s.id }),
    ).rejects.toMatchObject({ code: "BACKUP_EMPTY" });
    expect(backend.handle("list_server_backups", { serverId: s.id })).toEqual(
      [],
    );
  });
  it("executes full scope, excludes backup storage, and restores the full server", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "before");
    write(path.join(s.rootDir, "server.properties"), "before settings");
    write(path.join(s.rootDir, "plugins", "test.jar"), "before plugin");
    fs.mkdirSync(path.join(s.rootDir, "empty"));
    write(
      path.join(s.rootDir, "backups", "old", "world.dat"),
      "do not recurse",
    );
    const profile = call("create_backup_profile", {
      serverId: s.id,
      name: "Full",
      mode: "fullServer",
      includePaths: [],
      excludePaths: [],
      confirmFullServer: true,
    });
    const backup = await call("create_profile_backup", {
      profileId: profile.id,
    });
    expect(fs.existsSync(path.join(backup.archivePath, "backups"))).toBe(false);
    write(path.join(s.rootDir, "server.properties"), "after settings");
    write(path.join(s.rootDir, "extra.txt"), "after backup");
    expect(
      (await call("preview_backup_restore", { backupId: backup.id }))
        .relativePaths,
    ).toContain("extra.txt");
    await call("restore_world_backup", { backupId: backup.id, confirm: true });
    expect(
      fs.readFileSync(path.join(s.rootDir, "server.properties"), "utf8"),
    ).toBe("before settings");
    expect(fs.existsSync(path.join(s.rootDir, "extra.txt"))).toBe(false);
    expect(fs.existsSync(path.join(s.rootDir, "empty"))).toBe(true);
    expect(
      fs.existsSync(path.join(backup.archivePath, ".mcsm-backup.json")),
    ).toBe(true);
  });
  it("applies exclusions and preserves excluded live files during restore", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "before");
    write(path.join(s.rootDir, "world", "keep.log"), "before log");
    const profile = call("create_backup_profile", {
      serverId: s.id,
      name: "Custom",
      mode: "custom",
      includePaths: ["world"],
      excludePaths: ["**/*.log"],
    });
    const backup = await call("create_profile_backup", {
      profileId: profile.id,
    });
    expect(
      fs.existsSync(path.join(backup.archivePath, "world", "keep.log")),
    ).toBe(false);
    write(path.join(s.rootDir, "world", "keep.log"), "live log");
    write(
      path.join(backup.archivePath, "world", "injected.log"),
      "not in snapshot",
    );
    write(path.join(s.rootDir, "world", "extra.dat"), "extra");
    await call("restore_world_backup", { backupId: backup.id, confirm: true });
    expect(fs.existsSync(path.join(s.rootDir, "world", "injected.log"))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(s.rootDir, "world", "keep.log"), "utf8"),
    ).toBe("live log");
    expect(fs.existsSync(path.join(s.rootDir, "world", "extra.dat"))).toBe(
      false,
    );
  });
  it("rejects archive tampering before changing the live world", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "original");
    const backup = await call("create_world_backup", { serverId: s.id });
    write(path.join(backup.archivePath, "world", "level.dat"), "tampered");
    await expect(
      call("restore_world_backup", { backupId: backup.id, confirm: true }),
    ).rejects.toMatchObject({ code: "BACKUP_CHECKSUM_MISMATCH" });
    expect(
      fs.readFileSync(path.join(s.rootDir, "world", "level.dat"), "utf8"),
    ).toBe("original");
  });
  it("rejects scope tampering and rolls back a failed full restore database commit", async () => {
    const s = server();
    write(path.join(s.rootDir, "world", "level.dat"), "before");
    const plan = call("create_backup_profile", {
      serverId: s.id,
      name: "Full",
      mode: "fullServer",
      includePaths: [],
      excludePaths: [],
    });
    const backup = await call("create_profile_backup", { profileId: plan.id });
    const manifestPath = path.join(backup.archivePath, ".mcsm-backup.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    write(manifestPath, original.replace('"fullServer"', '"worldOnly"'));
    await expect(
      call("preview_backup_restore", { backupId: backup.id }),
    ).rejects.toMatchObject({ code: "BACKUP_MANIFEST_INVALID" });
    write(manifestPath, original);
    write(path.join(s.rootDir, "world", "level.dat"), "live");
    call("update_server_profile", { id: s.id, minecraftVersion: "1.21.5" });
    database((db) =>
      db.exec(
        "CREATE TRIGGER fail_restore BEFORE UPDATE ON servers WHEN NEW.minecraft_version = '1.21.4' BEGIN SELECT RAISE(ABORT, 'restore commit failure'); END;",
      ),
    );
    await expect(
      call("restore_world_backup", { backupId: backup.id, confirm: true }),
    ).rejects.toThrow("restore commit failure");
    expect(
      fs.readFileSync(path.join(s.rootDir, "world", "level.dat"), "utf8"),
    ).toBe("live");
    expect(backend.handle("list_server_profiles")[0].minecraftVersion).toBe(
      "1.21.5",
    );
  });
  it("executes world-plus-configs without including plugin binaries", async () => {
    const s = server("paper", "paper");
    write(path.join(s.rootDir, "world", "level.dat"), "world");
    write(path.join(s.rootDir, "plugins", "plugin.jar"), "binary");
    write(
      path.join(s.rootDir, "plugins", "Plugin", "config.yml"),
      "setting: before",
    );
    const profile = call("create_backup_profile", {
      serverId: s.id,
      name: "World/config",
      mode: "worldPlusConfigs",
      includePaths: [],
      excludePaths: [],
    });
    const backup = await call("create_profile_backup", {
      profileId: profile.id,
    });
    expect(
      (await call("preview_backup_restore", { backupId: backup.id })).mode,
    ).toBe("worldPlusConfigs");
    expect(
      fs.existsSync(path.join(backup.archivePath, "plugins", "plugin.jar")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(backup.archivePath, "plugins", "Plugin", "config.yml"),
      ),
    ).toBe(true);
  });
  it("waits for save-all flush confirmation and reenables saving on timeout", async () => {
    backend.close();
    const child = new EventEmitter();
    child.pid = 44444;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn() };
    child.kill = vi.fn(() => child.emit("exit", 0));
    backend = createBackend({
      getPath: () => path.join(root, "app"),
      checkPortAvailable: async () => true,
      spawn: () => child,
    });
    const s = server();
    write(path.join(s.rootDir, "server.jar"), "jar");
    write(path.join(s.rootDir, "world", "level.dat"), "old");
    await backend.handle("start_server", { serverId: s.id });
    const pending = call("create_world_backup", { serverId: s.id });
    expect(child.stdin.write).toHaveBeenCalledWith("save-all flush\n");
    expect(
      backend.handle("list_server_backups", { serverId: s.id }),
    ).toHaveLength(0);
    child.stdout.emit(
      "data",
      "[Server thread/INFO]: <Player> Saved the game\n",
    );
    write(path.join(s.rootDir, "world", "level.dat"), "flushed");
    child.stdout.emit("data", "[Server thread/INFO]: Saved the game\n");
    const backup = await pending;
    expect(
      fs.readFileSync(
        path.join(backup.archivePath, "world", "level.dat"),
        "utf8",
      ),
    ).toBe("flushed");
    expect(child.stdin.write).toHaveBeenLastCalledWith("save-on\n");
    vi.useFakeTimers();
    const timedOut = call("create_world_backup", { serverId: s.id });
    const rejection = expect(timedOut).rejects.toMatchObject({
      code: "BACKUP_SAVE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(child.stdin.write).toHaveBeenLastCalledWith("save-on\n");
  });
});

describe("content integrity and update policy", () => {
  it("never recommends a downgrade after installing the newest version", async () => {
    const s = server();
    mockVersions([version("v2", "2.0"), version("v1", "1.0")]);
    await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "v2",
    });
    expect(
      (await call("check_content_updates", { serverId: s.id })).updates,
    ).toEqual([]);
  });
  it("enforces pin and ignored versions in checks, individual and batch updates", async () => {
    const s = server();
    mockVersions([version("v2", "2.0"), version("v1", "1.0")]);
    const { content } = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "v1",
    });
    call("save_content_update_policy", {
      serverId: s.id,
      contentId: content.contentId,
      policy: "pin_current",
      pinnedVersion: "1.0",
    });
    expect(
      (await call("check_content_updates", { serverId: s.id })).updates,
    ).toEqual([]);
    expect(
      (await call("install_all_content_updates", { serverId: s.id })).installed,
    ).toEqual([]);
    await expect(
      call("install_content_update", {
        serverId: s.id,
        installedContentId: content.id,
      }),
    ).rejects.toMatchObject({ code: "CONTENT_ALREADY_CURRENT" });
    call("save_content_update_policy", {
      serverId: s.id,
      contentId: content.contentId,
      policy: "ignore_update",
      ignoredUpdate: "v2",
    });
    expect(
      (await call("check_content_updates", { serverId: s.id })).updates,
    ).toEqual([]);
    await expect(
      call("install_content_update", {
        serverId: s.id,
        installedContentId: content.id,
      }),
    ).rejects.toMatchObject({ code: "CONTENT_UPDATE_BLOCKED_BY_POLICY" });
  });
  it("preserves disabled state through update and durable rollback", async () => {
    const s = server();
    mockVersions([version("v2", "2.0"), version("v1", "1.0")]);
    const { content } = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "v1",
    });
    call("disable_installed_content", {
      serverId: s.id,
      contentId: content.id,
    });
    const result = await call("install_content_update", {
      serverId: s.id,
      installedContentId: content.id,
    });
    expect(result.content.installedPath).toMatch(/\.jar\.disabled$/);
    const [history] = backend.handle("list_content_update_history", {
      serverId: s.id,
    });
    expect(history).toMatchObject({
      fromVersion: "1.0",
      toVersion: "2.0",
      rollbackAvailable: true,
    });
    const restored = await call("rollback_content_update", {
      serverId: s.id,
      historyId: history.id,
      confirm: true,
    });
    expect(restored.content.version).toBe("1.0");
    expect(restored.content.installedPath).toMatch(/\.disabled$/);
    expect(fs.readFileSync(restored.content.installedPath, "utf8")).toBe(
      "jar-1.0",
    );
  });
  it("rolls files and metadata back when the database update fails", async () => {
    const s = server();
    mockVersions([version("v2", "2.0"), version("v1", "1.0")]);
    const { content } = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "v1",
    });
    database((db) =>
      db.exec(
        "CREATE TRIGGER fail_content_update BEFORE UPDATE ON installed_content WHEN NEW.version = '2.0' BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
      ),
    );
    await expect(
      call("install_content_update", {
        serverId: s.id,
        installedContentId: content.id,
      }),
    ).rejects.toThrow("test write failure");
    expect(fs.readFileSync(content.installedPath, "utf8")).toBe("jar-1.0");
    expect(fs.readdirSync(path.dirname(content.installedPath))).toEqual([
      "audit-1.0.jar",
    ]);
    expect(
      backend.handle("list_content_update_history", { serverId: s.id }),
    ).toEqual([]);
  });
  it("rejects incompatible versions unless explicitly overridden, and never bypasses hashes", async () => {
    const s = server();
    const incompatible = version("v1", "1.0", {
      loaders: ["forge"],
      game_versions: ["1.20.1"],
    });
    mockVersions([incompatible]);
    const input = {
      serverId: s.id,
      projectId: "audit",
      versionId: "v1",
      installAnyway: false,
    };
    await expect(call("install_modrinth_version", input)).rejects.toMatchObject(
      { code: "CONTENT_INCOMPATIBLE" },
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    incompatible.files[0].hashes.sha512 = "0".repeat(128);
    await expect(
      call("install_modrinth_version", { ...input, installAnyway: true }),
    ).rejects.toMatchObject({ code: "ARTIFACT_CHECKSUM_MISMATCH" });
    expect(
      await backend.handle("list_installed_content", { serverId: s.id }),
    ).toEqual([]);
    expect(fs.readdirSync(path.join(s.rootDir, "mods"))).toEqual([]);
  });
  it("reuses required dependencies and avoids duplicate project installations", async () => {
    const s = server();
    const dependency = version("dep-v1", "1.0", { project_id: "dependency" });
    const main = version("main-v1", "2.0", {
      dependencies: [
        {
          dependency_type: "required",
          project_id: "dependency",
          version_id: "dep-v1",
        },
      ],
    });
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("/project/dependency/version"))
        return Response.json([dependency]);
      if (String(url).endsWith("/version/dep-v1"))
        return Response.json(dependency);
      if (String(url).includes("/project/audit/version"))
        return Response.json([main]);
      return new Response(String(url).includes("2.0") ? "jar-2.0" : "jar-1.0");
    });
    const first = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "dependency",
      versionId: "dep-v1",
    });
    const result = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "main-v1",
    });
    expect(result.dependencies[0].content.id).toBe(first.content.id);
    expect(
      await backend.handle("list_installed_content", { serverId: s.id }),
    ).toHaveLength(2);
  });
  it("keeps two same-name local imports independent and deduplicates identical bytes", async () => {
    const s = server(),
      sourcePath = path.join(root, "incoming.jar");
    write(sourcePath, "first");
    const first = await call("import_local_content", {
      serverId: s.id,
      sourcePath,
    });
    expect(
      (await call("import_local_content", { serverId: s.id, sourcePath })).id,
    ).toBe(first.id);
    write(sourcePath, "second");
    const second = await call("import_local_content", {
      serverId: s.id,
      sourcePath,
    });
    expect(second.installedPath).not.toBe(first.installedPath);
    call("uninstall_installed_content", {
      serverId: s.id,
      contentId: first.id,
    });
    expect(fs.readFileSync(second.installedPath, "utf8")).toBe("second");
  });
  it("uses the dependency installer for updates and removes new dependencies when replacement fails", async () => {
    const s = server();
    const dependency = version("dep-v1", "0.5", { project_id: "dependency" });
    const next = version("v2", "2.0", {
      dependencies: [
        {
          dependency_type: "required",
          project_id: "dependency",
          version_id: "dep-v1",
        },
      ],
    });
    globalThis.fetch = vi.fn(async (address) => {
      const url = String(address);
      if (url.endsWith("/version/dep-v1")) return Response.json(dependency);
      if (url.includes("/project/audit/version"))
        return Response.json([next, version("v1", "1.0")]);
      return new Response(`jar-${url.match(/audit-(.+)\.jar$/)?.[1]}`);
    });
    const { content } = await call("install_modrinth_version", {
      serverId: s.id,
      projectId: "audit",
      versionId: "v1",
    });
    next.files[0].hashes.sha512 = "0".repeat(128);
    await expect(
      call("install_content_update", {
        serverId: s.id,
        installedContentId: content.id,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_CHECKSUM_MISMATCH" });
    expect(
      (await backend.handle("list_installed_content", { serverId: s.id })).map(
        (item) => item.id,
      ),
    ).toEqual([content.id]);
    expect(fs.readdirSync(path.join(s.rootDir, "mods"))).toEqual([
      "audit-1.0.jar",
    ]);
    next.files[0].hashes.sha512 = hash("jar-2.0", "sha512");
    const result = await call("install_content_update", {
      serverId: s.id,
      installedContentId: content.id,
    });
    expect(result.content.version).toBe("2.0");
    expect(
      await backend.handle("list_installed_content", { serverId: s.id }),
    ).toHaveLength(2);
  });
});

describe("file editing and scheduling", () => {
  it("rejects binary editing and stale or binary text writes without mutating disk", () => {
    const s = server();
    write(path.join(s.rootDir, "binary.jar"), Buffer.from([80, 75, 255, 0]));
    write(path.join(s.rootDir, "config.txt"), "original");
    const args = { serverId: s.id, relativePath: "config.txt" };
    expect(
      backend
        .handle("list_server_files", { serverId: s.id })
        .find((file) => file.name === "binary.jar").editable,
    ).toBe(false);
    expect(() =>
      backend.handle("read_server_text_file", {
        ...args,
        relativePath: "binary.jar",
      }),
    ).toThrow(/binary/);
    const read = backend.handle("read_server_text_file", args);
    expect(() =>
      backend.handle("write_server_text_file", {
        ...args,
        expectedRevision: read.revision,
        content: "bad\0text",
      }),
    ).toThrow(/binary/);
    write(path.join(s.rootDir, "config.txt"), "external");
    expect(() =>
      backend.handle("write_server_text_file", {
        ...args,
        expectedRevision: read.revision,
        content: "new",
      }),
    ).toThrow(/changed on disk/);
    expect(fs.readFileSync(path.join(s.rootDir, "config.txt"), "utf8")).toBe(
      "external",
    );
  });
  it("creates, moves, uploads and deletes files without overwrites or root escapes", async () => {
    const s = server();
    await call("mutate_server_files", {
      serverId: s.id,
      operation: "createDirectory",
      relativePath: "config",
    });
    await call("mutate_server_files", {
      serverId: s.id,
      operation: "createFile",
      relativePath: "config/first.txt",
      content: "first",
    });
    await call("mutate_server_files", {
      serverId: s.id,
      operation: "move",
      relativePath: "config/first.txt",
      targetRelativePath: "second.txt",
    });
    const sourcePath = path.join(root, "upload.txt");
    write(sourcePath, "uploaded");
    await call("mutate_server_files", {
      serverId: s.id,
      operation: "upload",
      relativePath: "config",
      sourcePaths: [sourcePath],
    });
    await expect(
      call("mutate_server_files", {
        serverId: s.id,
        operation: "upload",
        relativePath: "config",
        sourcePaths: [sourcePath],
      }),
    ).rejects.toMatchObject({ code: "FILE_TARGET_EXISTS" });
    await expect(
      call("mutate_server_files", {
        serverId: s.id,
        operation: "delete",
        relativePath: ".",
        confirmDelete: true,
      }),
    ).rejects.toMatchObject({ code: "SERVER_ROOT_MUTATION_FORBIDDEN" });
    await call("mutate_server_files", {
      serverId: s.id,
      operation: "delete",
      relativePath: "second.txt",
      confirmDelete: true,
    });
    expect(fs.existsSync(path.join(s.rootDir, "second.txt"))).toBe(false);
  });
  it("schedules weekdays in local time and executes the selected backup profile", async () => {
    const s = server();
    write(path.join(s.rootDir, "server.properties"), "custom data");
    const profile = call("create_backup_profile", {
      serverId: s.id,
      name: "Config",
      mode: "custom",
      includePaths: ["server.properties"],
      excludePaths: [],
    });
    const now = new Date();
    const weekday = (now.getDay() + 1) % 7;
    const task = call("create_scheduled_task", {
      serverId: s.id,
      name: "Weekly",
      kind: "world_backup",
      scheduleKind: "weekly",
      timeOfDay: "04:30",
      weekdays: [weekday],
      backupProfileId: profile.id,
    });
    const scheduled = new Date(task.nextRunAt);
    expect(scheduled.getDay()).toBe(weekday);
    expect(scheduled.getHours()).toBe(4);
    expect(scheduled.getMinutes()).toBe(30);
    database((db) =>
      db
        .prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), task.id),
    );
    expect((await backend.handle("run_due_scheduled_tasks"))[0].status).toBe(
      "completed",
    );
    expect(
      backend.handle("list_server_backups", { serverId: s.id })[0].profileId,
    ).toBe(profile.id);
  });
});

describe("server upstream discovery and recoverable upgrades", () => {
  it("discovers newer official Minecraft and loader releases without a supplied target", async () => {
    const s = server("paper", "paper");
    globalThis.fetch = vi.fn(async (url) =>
      String(url).endsWith("/builds")
        ? Response.json([{ id: 123, channel: "STABLE" }])
        : Response.json({ versions: { 1.21: ["1.21.5", "1.21.4"] } }),
    );
    const result = await call("check_server_update", { serverId: s.id });
    expect(result).toMatchObject({
      updateAvailable: true,
      targetVersion: "1.21.5",
      targetLoaderVersion: "123",
      installSupported: true,
    });
    expect(result.checks.find((check) => check.id === "java").status).toBe(
      "ready",
    );
  });
  it("upgrades a stopped server and restores its runtime, properties and world from history", async () => {
    const s = server("paper", "paper");
    const before = await jar(path.join(s.rootDir, "server.jar"), "before");
    const localContent = path.join(root, "plugin.jar");
    write(localContent, "plugin before");
    const installed = await call("import_local_content", {
      serverId: s.id,
      sourcePath: localContent,
    });
    write(path.join(s.rootDir, "world", "level.dat"), "old world");
    const source = path.join(root, "new.jar");
    await jar(source, "after");
    const history = await call("install_server_update", {
      serverId: s.id,
      confirm: true,
      serverJarPath: source,
      targetMinecraftVersion: "1.21.5",
      targetLoaderVersion: "123",
      acknowledgeWarnings: true,
    });
    expect(history.rollbackAvailable).toBe(true);
    write(path.join(s.rootDir, "world", "level.dat"), "new format");
    write(path.join(s.rootDir, "post-upgrade.txt"), "new data");
    call("uninstall_installed_content", {
      serverId: s.id,
      contentId: installed.id,
    });
    const restored = await call("rollback_server_update", {
      serverId: s.id,
      historyId: history.id,
      confirm: true,
    });
    expect(restored.status).toBe("rolled_back");
    expect(fs.readFileSync(path.join(s.rootDir, "server.jar"))).toEqual(before);
    expect(
      fs.readFileSync(path.join(s.rootDir, "world", "level.dat"), "utf8"),
    ).toBe("old world");
    expect(fs.existsSync(path.join(s.rootDir, "post-upgrade.txt"))).toBe(false);
    expect(backend.handle("list_server_profiles")[0].minecraftVersion).toBe(
      "1.21.4",
    );
    const contents = await backend.handle("list_installed_content", {
      serverId: s.id,
    });
    expect(contents[0].id).toBe(installed.id);
    expect(fs.readFileSync(contents[0].installedPath, "utf8")).toBe(
      "plugin before",
    );
  });
});

describe("marketplace provider contracts", () => {
  it("passes page offsets and server compatibility facets to Modrinth and BBSMC", async () => {
    const s = server();
    globalThis.fetch = vi.fn(async () => Response.json({ hits: [] }));
    const input = {
      serverId: s.id,
      query: "",
      projectType: "mod",
      loader: "fabric",
      minecraftVersion: "1.21.4",
      offset: 40,
      limit: 20,
    };
    await call("search_modrinth_projects", input);
    await call("search_bbsmc_projects", input);
    for (const [address] of globalThis.fetch.mock.calls) {
      const url = new URL(address);
      expect(url.searchParams.get("offset")).toBe("40");
      expect(JSON.parse(url.searchParams.get("facets"))).toEqual([
        ["project_type:mod"],
        ["categories:fabric"],
        ["versions:1.21.4"],
      ]);
    }
  });
  it("normalizes Hangar detail, versions and provider checksums for installation", async () => {
    const s = server("paper", "paper");
    const payload = "paper plugin";
    globalThis.fetch = vi.fn(async (address) => {
      const url = String(address);
      if (url.includes("/pages/main/")) return new Response("# Plugin guide");
      if (url.endsWith("/versions"))
        return Response.json({
          result: [
            {
              name: "1.0",
              createdAt: "2026-08-01T00:00:00Z",
              channel: { name: "Release" },
              platformDependencies: { PAPER: ["1.21.4"] },
              downloads: {
                PAPER: {
                  fileInfo: {
                    name: "plugin.jar",
                    sizeBytes: payload.length,
                    sha256Hash: hash(payload),
                  },
                  downloadUrl: "https://hangarcdn.papermc.io/plugin.jar",
                },
              },
              pluginDependencies: { PAPER: [] },
            },
          ],
        });
      if (url.includes("hangarcdn.papermc.io")) return new Response(payload);
      return Response.json({
        id: 123,
        name: "Plugin",
        namespace: { owner: "Owner", slug: "Plugin" },
        supportedPlatforms: { PAPER: ["1.21.4"] },
        stats: { downloads: 100 },
      });
    });
    const detail = await call("get_hangar_project", {
      projectId: "Owner/Plugin",
    });
    expect(detail).toMatchObject({
      id: "Owner/Plugin",
      title: "Plugin",
      projectType: "plugin",
      body: "# Plugin guide",
    });
    const versions = await call("list_hangar_versions", {
      serverId: s.id,
      projectId: detail.id,
    });
    expect(versions[0]).toMatchObject({
      id: "1.0",
      projectId: detail.id,
      loaders: ["paper"],
      gameVersions: ["1.21.4"],
      warnings: [],
    });
    const installed = await call("install_hangar_version", {
      serverId: s.id,
      projectId: detail.id,
      versionName: "1.0",
    });
    expect(fs.readFileSync(installed.installedPath, "utf8")).toBe(payload);
  });
});

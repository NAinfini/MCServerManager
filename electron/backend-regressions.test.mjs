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
function throughLinkedRoot(profile) {
  const alias = `${profile.rootDir}-alias`;
  fs.symlinkSync(
    profile.rootDir,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  database((db) =>
    db
      .prepare("UPDATE servers SET root_dir = ? WHERE id = ?")
      .run(alias, profile.id),
  );
  return { ...profile, rootDir: alias };
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
    await vi.advanceTimersByTimeAsync(120_000);
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
    const s = throughLinkedRoot(server());
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
    const s = throughLinkedRoot(server("paper", "paper"));
    const before = await jar(path.join(s.rootDir, "server.jar"), "before");
    const localContent = path.join(root, "plugin.jar");
    write(localContent, "plugin before");
    const installed = await call("import_local_content", {
      serverId: s.id,
      sourcePath: localContent,
    });
    // Persisted metadata can retain the user-selected alias of the same file.
    database((db) =>
      db
        .prepare("UPDATE installed_content SET installed_path = ? WHERE id = ?")
        .run(
          path.join(
            s.rootDir,
            "plugins",
            path.basename(installed.installedPath),
          ),
          installed.id,
        ),
    );
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

/* Process lifecycle: the harness injects `spawn` and drives a fake child, so
   nothing here launches Java or a Minecraft server. */
function fakeChild(pid = 44444) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn(() => child.emit("exit", 0));
  return child;
}
function spawningBackend(children, firstPid = 40000) {
  backend.close();
  backend = createBackend({
    getPath: () => path.join(root, "app"),
    checkPortAvailable: async () => true,
    collectProcessMetrics: async () => null,
    spawn: () => {
      const created = fakeChild(firstPid + children.length);
      children.push(created);
      return created;
    },
  });
}
async function managedServer(name = "server") {
  const children = [];
  spawningBackend(children);
  const s = server(name);
  write(path.join(s.rootDir, "server.jar"), "jar");
  await backend.handle("start_server", { serverId: s.id });
  return { s, children, child: children[0] };
}
const status = (s) =>
  backend.handle("get_server_process_status", { serverId: s.id });
const events = (s) =>
  backend
    .handle("list_process_events", { serverId: s.id })
    .map((event) => event.message);
const line = (child, text) => child.stdout.emit("data", `${text}\n`);

describe("hot backup save confirmation", () => {
  const confirmations = [
    [
      "Forge",
      "[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: Saved the game",
    ],
    [
      "NeoForge",
      "[12:00:00] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Saved the game",
    ],
    ["Fabric and vanilla", "[12:00:00] [Server thread/INFO]: Saved the game"],
    ["Paper", "[12:00:00 INFO]: Saved the game"],
    ["Fabric 26.x system chat", "[12:00:00] [Server thread/INFO]: System chat: Saved the game"],
    ["older versions", "[12:00:00] [Server thread/INFO]: Saved the world"],
  ];
  it.each(confirmations)("accepts the %s log format", async (_name, text) => {
    const { s, child } = await managedServer();
    write(path.join(s.rootDir, "world", "level.dat"), "data");
    const pending = call("create_world_backup", { serverId: s.id });
    line(child, text);
    await expect(pending).resolves.toMatchObject({ serverId: s.id });
  });
  const chat = [
    "[12:00:00] [Server thread/INFO]: <Player> Saved the game",
    "[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Player> Saved the game",
    "[12:00:00 INFO]: <Player> Saved the game",
    "[12:00:00] [Server thread/INFO]: System chat: <Player> Saved the game",
    "[12:00:00] [Server thread/INFO]: [Not Secure] <Player> Saved the game",
  ];
  it.each(chat)("rejects chat: %s", async (text) => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    const pending = call("create_world_backup", { serverId: s.id });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "BACKUP_SAVE_TIMEOUT",
    });
    line(child, text);
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
  });
  it("waits 120 seconds for large modded worlds", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    let settled = false;
    const pending = call("create_world_backup", { serverId: s.id });
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(119_000);
    expect(settled).toBe(false);
    const rejection = expect(pending).rejects.toMatchObject({
      code: "BACKUP_SAVE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(child.stdin.write).toHaveBeenLastCalledWith("save-on\n");
  });
});

describe("graceful stop", () => {
  const savedGrace = process.env.MCSM_SHUTDOWN_GRACE_MS;
  afterEach(() => {
    if (savedGrace === undefined) delete process.env.MCSM_SHUTDOWN_GRACE_MS;
    else process.env.MCSM_SHUTDOWN_GRACE_MS = savedGrace;
  });
  beforeEach(() => {
    delete process.env.MCSM_SHUTDOWN_GRACE_MS;
  });
  const stop = (s) => backend.handle("stop_server", { serverId: s.id });

  it("reports stopping, waits 180 seconds, and only writes stopped on real exit", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    stop(s);
    expect(child.stdin.write).toHaveBeenCalledWith("stop\n");
    expect(status(s).status).toBe("stopping");
    await vi.advanceTimersByTimeAsync(179_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(status(s)).toMatchObject({ status: "stopping", exitedAt: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(status(s).status).toBe("stopped");
  });
  it("stays stopping until the process exits by itself and never kills it", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    stop(s);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status(s).status).toBe("stopping");
    child.emit("exit", 0);
    expect(status(s)).toMatchObject({ status: "stopped", exitCode: 0 });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
  it("honours MCSM_SHUTDOWN_GRACE_MS", async () => {
    process.env.MCSM_SHUTDOWN_GRACE_MS = "2000";
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    stop(s);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it("does not stack timers or repeat stop when called twice", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    stop(s);
    const afterFirst = vi.getTimerCount();
    stop(s);
    expect(vi.getTimerCount()).toBe(afterFirst);
    expect(afterFirst).toBe(before + 1);
    expect(
      child.stdin.write.mock.calls.filter(([text]) => text === "stop\n"),
    ).toHaveLength(1);
  });
  it("force_stop_server kills immediately and still waits for the real exit", async () => {
    const { s, child } = await managedServer();
    child.kill = vi.fn();
    stop(s);
    backend.handle("force_stop_server", { serverId: s.id });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(status(s).status).toBe("stopping");
    child.emit("exit", null);
    expect(status(s).status).toBe("stopped");
  });
  it("force_stop_server works on a server that was never asked to stop", async () => {
    const { s, child } = await managedServer();
    backend.handle("force_stop_server", { serverId: s.id });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(status(s).status).toBe("stopped");
  });
  it("keeps the server counted and unstartable while stopping", async () => {
    const { s } = await managedServer();
    stop(s);
    await expect(
      backend.handle("start_server", { serverId: s.id }),
    ).rejects.toMatchObject({ code: "SERVER_ALREADY_RUNNING" });
    expect(backend.handle("get_process_summary").runningCount).toBe(1);
  });
  it("restart waits the full grace period for the old process", async () => {
    const { s, children, child } = await managedServer();
    vi.useFakeTimers();
    const restarted = backend.handle("restart_server", { serverId: s.id });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(children).toHaveLength(1);
    child.emit("exit", 0);
    await restarted;
    expect(children).toHaveLength(2);
  });
  it("restart gives up only after the grace period", async () => {
    process.env.MCSM_SHUTDOWN_GRACE_MS = "10000";
    const { s, child } = await managedServer();
    child.kill = vi.fn();
    vi.useFakeTimers();
    const restarted = backend.handle("restart_server", { serverId: s.id });
    const rejection = expect(restarted).rejects.toThrow(/did not exit/);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});

describe("crash detection", () => {
  const harmless = [
    "[12:00:00] [Server thread/INFO]: <Steve> watchdog",
    "[12:00:00] [Server thread/INFO]: <Steve> java.lang.OutOfMemoryError",
    "[12:00:00] [Server thread/INFO]: [Not Secure] <Steve> watchdog",
    "[12:00:00] [Server thread/INFO]: [Server] watchdog OutOfMemoryError",
    "[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> A single server tick took 60 seconds",
    "[12:00:00 INFO]: <Steve> The server has stopped responding",
    "[12:00:00] [Server thread/INFO]: Steve issued server command: /say watchdog OutOfMemoryError",
    "[12:00:00] [Server thread/INFO]: * Steve OutOfMemoryError",
    "[12:00:00] [Server thread/INFO]: Starting Watchdog helper",
    "[12:00:00] [Server thread/INFO]: A single server tick took 5.00 seconds",
    "<Steve> watchdog",
  ];
  it.each(harmless)("ignores %s", async (text) => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    line(child, text);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(events(s).some((message) => /crash/i.test(message))).toBe(false);
  });
  const real = [
    "[12:00:00] [Server Watchdog/FATAL]: A single server tick took 60.00 seconds (should be max 0.05)",
    "[12:00:00] [Server Watchdog/FATAL] [minecraft/Watchdog]: A single server tick took 60.00 seconds",
    "java.lang.OutOfMemoryError: Java heap space",
    "[12:00:00 ERROR]: The server has stopped responding! Please report this to https://example.invalid",
    "[12:00:00] [Server thread/ERROR]: Encountered an unexpected exception",
  ];
  it.each(real)("warns, then kills after 30 seconds: %s", async (text) => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    line(child, text);
    expect(child.kill).not.toHaveBeenCalled();
    expect(events(s).some((message) => /crash/i.test(message))).toBe(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(child.kill).not.toHaveBeenCalled();
    expect(status(s).status).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it("does not kill a process that exits by itself within the window", async () => {
    const { s, child } = await managedServer();
    vi.useFakeTimers();
    line(
      child,
      "[12:00:00] [Server Watchdog/FATAL]: A single server tick took 60.00 seconds",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    child.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(status(s).status).toBe("crashed");
  });
});

describe("crash restart counter", () => {
  it("still exhausts on a fast crash loop", async () => {
    const { s, children } = await managedServer();
    vi.useFakeTimers();
    for (let crash = 0; crash < 3; crash++) {
      children.at(-1).emit("exit", 1);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(children).toHaveLength(4);
    children.at(-1).emit("exit", 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(children).toHaveLength(4);
    expect(events(s).some((message) => /exhausted/.test(message))).toBe(true);
  });
  it("forgives crashes spread over time once the server stayed up 10 minutes", async () => {
    const { s, children } = await managedServer();
    vi.useFakeTimers();
    for (let crash = 0; crash < 5; crash++) {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      children.at(-1).emit("exit", 1);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(children).toHaveLength(6);
    expect(events(s).some((message) => /exhausted/.test(message))).toBe(false);
    expect(
      events(s).filter((message) => /attempt 1\/3/.test(message)),
    ).toHaveLength(5);
  });
});

describe("server readiness", () => {
  const ready = [
    '[12:00:00] [Server thread/INFO]: Done (12.345s)! For help, type "help"',
    '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done (45.1s)! For help, type "help"',
    '[12:00:00 INFO]: Done (3.210s)! For help, type "help"',
  ];
  it.each(ready)("detects %s", async (text) => {
    const { s, child } = await managedServer();
    expect(status(s)).toMatchObject({
      status: "running",
      ready: false,
      readyAt: null,
    });
    line(child, text);
    const after = status(s);
    expect(after.status).toBe("running");
    expect(after.ready).toBe(true);
    expect(Date.parse(after.readyAt)).not.toBeNaN();
    child.emit("exit", 0);
    expect(status(s)).toMatchObject({ ready: false, readyAt: null });
  });
  it("ignores chat that imitates the done line", async () => {
    const { s, child } = await managedServer();
    line(
      child,
      '[12:00:00] [Server thread/INFO]: <Steve> Done (1.0s)! For help, type "help"',
    );
    line(
      child,
      "[12:00:00] [Server thread/INFO]: [Not Secure] <Steve> Done (1.0s)! For help",
    );
    line(child, "<Steve> Done (1.0s)! For help");
    expect(status(s).ready).toBe(false);
  });
});

describe("auto start versus start after install", () => {
  it("start_auto_start_servers starts only flagged servers, staggered by 15 seconds", async () => {
    const children = [];
    spawningBackend(children, 50000);
    const flagged = ["a", "b", "c"].map((name) => {
      const s = server(name);
      write(path.join(s.rootDir, "server.jar"), "jar");
      return s;
    });
    const unflagged = server("manual");
    write(path.join(unflagged.rootDir, "server.jar"), "jar");
    database((db) =>
      db
        .prepare("UPDATE servers SET auto_start = 1 WHERE id IN (?, ?, ?)")
        .run(...flagged.map((s) => s.id)),
    );
    // Running servers may not share a port, so give each its own.
    database((db) =>
      flagged.forEach((s, index) =>
        db
          .prepare("UPDATE servers SET server_port = ? WHERE id = ?")
          .run(25570 + index, s.id),
      ),
    );
    vi.useFakeTimers();
    const settle = async () => {
      for (let tick = 0; tick < 10; tick++)
        await vi.advanceTimersByTimeAsync(0);
    };
    const all = backend.handle("start_auto_start_servers");
    await settle();
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    await settle();
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await settle();
    expect(children).toHaveLength(3);
    await all;
    expect(status(unflagged)).toBeNull();
    expect(flagged.map((s) => status(s).status)).toEqual([
      "running",
      "running",
      "running",
    ]);
  });
  it("logs a failure and continues with the next server", async () => {
    const children = [];
    spawningBackend(children, 51000);
    const broken = server("broken");
    const fine = server("fine");
    database((db) =>
      db.prepare("UPDATE servers SET server_port = 25580 WHERE id = ?").run(fine.id),
    );
    write(path.join(fine.rootDir, "server.jar"), "jar");
    database((db) => {
      db.prepare("UPDATE servers SET auto_start = 1").run();
      db.prepare("UPDATE servers SET created_at = ? WHERE id = ?").run(
        "2020-01-01T00:00:00.000Z",
        broken.id,
      );
      db.prepare("UPDATE servers SET launch_spec_json = ? WHERE id = ?").run(
        "{not json",
        broken.id,
      );
    });
    vi.useFakeTimers();
    const all = backend.handle("start_auto_start_servers");
    await vi.advanceTimersByTimeAsync(60_000);
    await all;
    expect(status(fine).status).toBe("running");
    expect(status(broken)).toBeNull();
    expect(events(broken).some((message) => /auto start failed/i.test(message))).toBe(
      true,
    );
  });
  it("provisioning starts on startAfterInstall without persisting auto_start", async () => {
    const children = [];
    spawningBackend(children, 52000);
    const run = async (name, profileExtras) => {
      const targetDir = path.join(root, name);
      const javaPath = path.join(root, `${name}-runtime`, "java.exe");
      write(javaPath, "java");
      write(path.join(targetDir, "server.jar"), "jar");
      const job = call("create_provisioning_job", {
        plan: {
          targetDir,
          useExistingTarget: true,
          source: { kind: "blank" },
          compatibilityWarnings: [],
          acknowledgedWarningCodes: [],
          eula: {
            accepted: true,
            termsUrl: "https://aka.ms/MinecraftEULA",
            acceptedAt: "2026-07-18T12:00:00.000Z",
          },
          configuration: {
            minMemoryMb: 1024,
            maxMemoryMb: 2048,
            serverPort: 25565 + children.length + 10,
          },
          javaRuntime: { path: javaPath, majorVersion: 21, validated: true },
          launchSpec: {
            executable: { kind: "java" },
            jvmArgs: ["-jar", "server.jar"],
            serverArgs: ["nogui"],
            workingDirectory: ".",
            validated: true,
          },
          profile: {
            name,
            loaderType: "paper",
            minecraftVersion: "1.21.4",
            loaderVersion: "1",
            ...profileExtras,
          },
        },
      });
      return call("run_provisioning_job", { jobId: job.id });
    };
    const autoStartOf = (id) =>
      backend.handle("list_server_profiles").find((p) => p.id === id).autoStart;
    const fresh = await run("fresh", { startAfterInstall: true });
    expect(children).toHaveLength(1);
    expect(autoStartOf(fresh.serverId)).toBe(false);
    const idle = await run("idle", { startAfterInstall: false });
    expect(children).toHaveLength(1);
    expect(autoStartOf(idle.serverId)).toBe(false);
    const legacy = await run("legacy", { autoStart: true });
    expect(children).toHaveLength(2);
    expect(autoStartOf(legacy.serverId)).toBe(false);
  });
});

describe("overdue scheduled tasks after downtime", () => {
  const task = (s, overrides = {}) =>
    call("create_scheduled_task", {
      serverId: s.id,
      name: "Hourly stop",
      kind: "stop",
      scheduleKind: "interval",
      intervalMinutes: 60,
      ...overrides,
    });
  const tasks = (s) => backend.handle("list_scheduled_tasks", { serverId: s.id });
  it("advances overdue tasks at startup instead of firing them", async () => {
    const s = server();
    const due = task(s);
    const disabled = task(s, { name: "Off", enabled: false });
    const overdue = new Date(Date.now() - 3 * 3600_000).toISOString();
    database((db) =>
      db.prepare("UPDATE scheduled_tasks SET next_run_at = ?").run(overdue),
    );
    backend.close();
    backend = createBackend({
      getPath: () => path.join(root, "app"),
      checkPortAvailable: async () => true,
    });
    const advanced = tasks(s).find((t) => t.id === due.id);
    expect(Date.parse(advanced.nextRunAt)).toBeGreaterThan(Date.now());
    expect(tasks(s).find((t) => t.id === disabled.id).nextRunAt).toBe(overdue);
    expect(await call("run_due_scheduled_tasks")).toEqual([]);
    const runs = backend.handle("list_scheduled_task_runs", { serverId: s.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      taskId: due.id,
      status: "skipped",
      scheduledFor: overdue,
    });
    expect(advanced.lastRunAt).toBeNull();
  });
  it("still runs tasks that become due while the app is open", async () => {
    const s = server();
    const due = task(s, { kind: "command", command: "list" });
    database((db) =>
      db
        .prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), due.id),
    );
    expect(await call("run_due_scheduled_tasks")).toHaveLength(1);
  });
});

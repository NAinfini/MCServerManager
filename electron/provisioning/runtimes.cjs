const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { extractZipArchive } = require("./archive.cjs");
const { provisioningError } = require("./contracts.cjs");
const {
  isTransientFsError,
  retryTransientFsOperation,
} = require("./fs-retry.cjs");

const TEMURIN_LICENSE_URL = "https://openjdk.org/legal/gplv2+ce.html";
const TEMURIN_DOWNLOAD_HOSTS = new Set([
  "api.adoptium.net",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function validateTemurinDownloadUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw provisioningError(
      "JAVA_DOWNLOAD_URL_BLOCKED",
      "Managed Java download URL is invalid.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !TEMURIN_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    throw provisioningError(
      "JAVA_DOWNLOAD_URL_BLOCKED",
      "Managed Java download URL is outside the trusted Temurin hosts.",
    );
  }
  return parsed.toString();
}

function requiredJavaMajorForMinecraft(minecraftVersion) {
  const match = String(minecraftVersion || "").match(
    /^(\d+)\.(\d+)(?:\.(\d+))?/,
  );
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3] || "0", 10);
  if (major >= 26) return 25;
  if (major > 1 || (minor === 20 && patch >= 5) || minor >= 21) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

/* The required major is a target, not a floor. Minecraft up to 1.16 boots
   through LegacyLauncher/ModLauncher, which cast the system class loader to
   `java.net.URLClassLoader` — true only through Java 8. A 1.7.10 Forge server
   started on Java 11 dies with `class jdk.internal.loader.ClassLoaders$
   AppClassLoader cannot be cast to class java.net.URLClassLoader` before it
   ever listens, which is exactly what "pick the newest Java installed" used to
   produce. Above 1.16 no ceiling is claimed, because none is established. */
function maxJavaMajorForMinecraft(minecraftVersion) {
  return requiredJavaMajorForMinecraft(minecraftVersion) === 8 ? 8 : null;
}

/* The lowest runtime inside the supported window, so a machine carrying both
   Java 8 and Java 21 runs an old server on 8 rather than on whichever entry
   the scan happened to list first. */
function selectJavaRuntime(runtimes, minMajorVersion, maxMajorVersion = null) {
  return (runtimes || [])
    .filter((runtime) => Number.isFinite(Number(runtime.majorVersion)))
    .filter((runtime) => Number(runtime.majorVersion) >= minMajorVersion)
    .filter(
      (runtime) =>
        maxMajorVersion === null ||
        maxMajorVersion === undefined ||
        Number(runtime.majorVersion) <= maxMajorVersion,
    )
    .sort(
      (left, right) => Number(left.majorVersion) - Number(right.majorVersion),
    )[0];
}

function adoptiumPlatform(platform) {
  const values = { win32: "windows", darwin: "mac", linux: "linux" };
  const value = values[platform];
  if (!value) {
    throw provisioningError(
      "JAVA_PLATFORM_UNSUPPORTED",
      `Managed Java is not available for platform ${platform}.`,
    );
  }
  return value;
}

function adoptiumArchitecture(arch) {
  const values = { x64: "x64", arm64: "aarch64", ia32: "x32" };
  const value = values[arch];
  if (!value) {
    throw provisioningError(
      "JAVA_ARCH_UNSUPPORTED",
      `Managed Java is not available for architecture ${arch}.`,
    );
  }
  return value;
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function findExecutable(root, executableName, maxEntries = 10_000) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      visited += 1;
      if (visited > maxEntries) {
        throw provisioningError(
          "JAVA_ARCHIVE_TOO_LARGE",
          "Managed Java archive contains too many files.",
        );
      }
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.toLowerCase() === executableName) {
        return target;
      }
    }
  }
  return null;
}

async function defaultDownload(url, target) {
  const validatedUrl = validateTemurinDownloadUrl(url);
  let response;
  try {
    response = await fetch(validatedUrl, { redirect: "follow" });
  } catch (error) {
    // fetch() rejects with a bare TypeError ("fetch failed") when the request
    // never reaches the server: offline, DNS failure, blocking proxy, TLS
    // error. Without a code that reaches the UI as untranslated English on the
    // one step the wizard cannot be finished without.
    const cause = error?.cause?.code || error?.code || error?.name;
    throw provisioningError(
      "NETWORK_UNREACHABLE",
      `Managed Java download failed: ${cause ? `${cause} ` : ""}${error?.message || error}`,
    );
  }
  if (!response.ok) {
    throw provisioningError(
      "JAVA_DOWNLOAD_FAILED",
      `Managed Java download failed: ${response.status}`,
    );
  }
  validateTemurinDownloadUrl(response.url || validatedUrl);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

function defaultInspectJava(javaPath) {
  const result = spawnSync(javaPath, ["-version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const version =
    output.match(/(?:openjdk|java)\s+version\s+"([^"]+)"/i)?.[1] ||
    output.match(/openjdk\s+([0-9][^\s]+)/i)?.[1];
  const majorMatch = version?.match(/^1\.(\d+)/) || version?.match(/^(\d+)/);
  if (!version || !majorMatch || result.status !== 0) {
    throw provisioningError(
      "JAVA_EXECUTABLE_INVALID",
      "The installed Java executable could not be validated.",
    );
  }
  return {
    path: javaPath,
    version,
    majorVersion: Number.parseInt(majorMatch[1], 10),
    vendor: /temurin|adoptium/i.test(output) ? "Eclipse Temurin" : "OpenJDK",
    architecture: process.arch,
  };
}

function createRuntimeManager(dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const arch = dependencies.arch || process.arch;
  const osName = adoptiumPlatform(platform);
  const architecture = adoptiumArchitecture(arch);
  const userDataDir = path.resolve(String(dependencies.userDataDir || ""));
  const fetchJson = dependencies.fetchJson;
  const download = dependencies.download || defaultDownload;
  const extractArchive = dependencies.extractArchive || extractZipArchive;
  const inspectJava = dependencies.inspectJava || defaultInspectJava;
  if (!dependencies.userDataDir || typeof fetchJson !== "function") {
    throw new Error(
      "runtime user-data directory and metadata client are required",
    );
  }

  return {
    async plan(input) {
      const majorVersion = Number(input?.majorVersion);
      if (!Number.isInteger(majorVersion) || majorVersion < 8) {
        throw provisioningError(
          "JAVA_VERSION_INVALID",
          "A supported Java major version is required.",
        );
      }
      const compatible = selectJavaRuntime(
        input.installedRuntimes,
        majorVersion,
        input?.maxMajorVersion ?? null,
      );
      if (compatible) {
        return { action: "reuse", majorVersion, runtime: compatible };
      }
      const query =
        `https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot` +
        `?architecture=${encodeURIComponent(architecture)}` +
        `&image_type=jre&os=${encodeURIComponent(osName)}` +
        "&archive_type=zip&vendor=eclipse&heap_size=normal&page_size=1";
      const assets = await fetchJson(query);
      const asset = Array.isArray(assets) ? assets[0] : null;
      const pkg = asset?.binary?.package;
      if (!pkg?.link || !pkg?.checksum) {
        throw provisioningError(
          "JAVA_ASSET_NOT_FOUND",
          `No Eclipse Temurin Java ${majorVersion} runtime is available for ${osName}-${architecture}.`,
        );
      }
      const downloadUrl = validateTemurinDownloadUrl(pkg.link);
      return {
        action: "install",
        vendor: "Eclipse Temurin",
        version: asset.version?.semver || String(majorVersion),
        majorVersion,
        platform: osName,
        architecture,
        url: downloadUrl,
        filename: pkg.name || `temurin-${majorVersion}.zip`,
        checksum: String(pkg.checksum).toLowerCase(),
        size: Number(pkg.size || 0),
        licenseUrl: TEMURIN_LICENSE_URL,
        managed: true,
        targetDir: path.join(
          userDataDir,
          "runtimes",
          "temurin",
          String(majorVersion),
          `${osName}-${architecture}`,
        ),
      };
    },

    async install(plan, options = {}) {
      if (plan?.action === "reuse") return plan.runtime;
      if (plan?.action !== "install") {
        throw provisioningError(
          "JAVA_PLAN_INVALID",
          "Managed Java plan is invalid.",
        );
      }
      if (options.consent !== true) {
        throw provisioningError(
          "JAVA_CONSENT_REQUIRED",
          "You must confirm the Temurin license and managed download before installation.",
        );
      }
      const downloadUrl = validateTemurinDownloadUrl(plan.url);
      const targetDir = path.resolve(plan.targetDir);
      const allowedRoot = path.join(userDataDir, "runtimes", "temurin");
      const relativeTarget = path.relative(allowedRoot, targetDir);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw provisioningError(
          "JAVA_TARGET_INVALID",
          "Managed Java target is outside the application data directory.",
        );
      }
      const parent = path.dirname(targetDir);
      fs.mkdirSync(parent, { recursive: true });
      const staging = `${targetDir}.installing-${randomUUID()}`;
      const extracted = path.join(staging, "runtime");
      const archivePath = path.join(staging, path.basename(plan.filename));
      fs.mkdirSync(staging, { recursive: true });
      try {
        await download(downloadUrl, archivePath);
        if (sha256File(archivePath) !== plan.checksum) {
          throw provisioningError(
            "JAVA_CHECKSUM_MISMATCH",
            "Managed Java download failed SHA-256 verification.",
          );
        }
        await extractArchive(archivePath, extracted);
        const executableName = platform === "win32" ? "java.exe" : "java";
        const stagedJavaPath = findExecutable(extracted, executableName);
        if (!stagedJavaPath) {
          throw provisioningError(
            "JAVA_EXECUTABLE_MISSING",
            "Managed Java archive does not contain a Java executable.",
          );
        }
        const inspected = inspectJava(stagedJavaPath);
        if (Number(inspected.majorVersion) < Number(plan.majorVersion)) {
          throw provisioningError(
            "JAVA_VERSION_MISMATCH",
            `Installed Java ${inspected.majorVersion} does not satisfy Java ${plan.majorVersion}.`,
          );
        }
        if (fs.existsSync(targetDir)) {
          throw provisioningError(
            "JAVA_TARGET_EXISTS",
            "Managed Java target already exists; rescan runtimes before retrying.",
          );
        }
        const relativeExecutable = path.relative(extracted, stagedJavaPath);
        try {
          await retryTransientFsOperation(
            () => fs.renameSync(extracted, targetDir),
            `commit managed Java runtime to ${targetDir}`,
          );
        } catch (caught) {
          if (isTransientFsError(caught)) {
            throw provisioningError(
              "JAVA_TARGET_LOCKED",
              `Managed Java could not be moved into place: ${caught.code} on ${caught.path || targetDir}. Another process (commonly antivirus real-time scanning) is holding the extracted runtime open.`,
            );
          }
          throw caught;
        }
        const javaPath = path.join(targetDir, relativeExecutable);
        return {
          ...inspected,
          path: javaPath,
          source: "Managed by MC Server Manager",
          vendor: "Eclipse Temurin",
          managed: true,
          licenseUrl: plan.licenseUrl,
          checksum: plan.checksum,
        };
      } finally {
        // Throwing from `finally` would replace whatever real failure brought us
        // here, so a staging directory we cannot reclaim is reported, not raised.
        try {
          await retryTransientFsOperation(
            () => fs.rmSync(staging, { recursive: true, force: true }),
            `remove Java staging directory ${staging}`,
          );
        } catch (caught) {
          console.error(
            `[provisioning] left behind staging directory ${staging}: ${caught?.code || caught}`,
          );
        }
      }
    },

    /* Only what this app put there. A Java found on PATH or installed by the
       user belongs to the machine, and a server manager deleting it would be a
       surprise no confirmation dialog makes acceptable. */
    async remove(javaPath) {
      const allowedRoot = path.resolve(
        path.join(userDataDir, "runtimes", "temurin"),
      );
      const relative = path.relative(
        allowedRoot,
        path.resolve(String(javaPath || "")),
      );
      const segments = relative.split(path.sep).filter(Boolean);
      if (
        !relative ||
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        segments.length < 3
      ) {
        throw provisioningError(
          "JAVA_NOT_MANAGED",
          `Only Java runtimes installed by this app can be removed: ${javaPath}`,
          { detail: String(javaPath || "") },
        );
      }
      /* `<major>/<os>-<arch>` is the directory install commits, so it is the
         unit that comes back out. Deleting the executable alone would leave a
         runtime the scan still finds and nothing can start. */
      const targetDir = path.join(allowedRoot, segments[0], segments[1]);
      if (!fs.existsSync(targetDir)) {
        throw provisioningError(
          "JAVA_RUNTIME_MISSING",
          `Managed Java runtime is no longer on disk: ${targetDir}`,
          { detail: targetDir },
        );
      }
      try {
        await retryTransientFsOperation(
          () => fs.rmSync(targetDir, { recursive: true, force: true }),
          `remove managed Java runtime ${targetDir}`,
        );
      } catch (caught) {
        if (isTransientFsError(caught)) {
          throw provisioningError(
            "JAVA_RUNTIME_LOCKED",
            `Managed Java could not be removed: ${caught.code} on ${caught.path || targetDir}. A running server or an antivirus scan is holding it open.`,
            { detail: targetDir },
          );
        }
        throw caught;
      }
      return { path: javaPath, removedDir: targetDir };
    },
  };
}

module.exports = {
  TEMURIN_LICENSE_URL,
  createRuntimeManager,
  maxJavaMajorForMinecraft,
  requiredJavaMajorForMinecraft,
  selectJavaRuntime,
};

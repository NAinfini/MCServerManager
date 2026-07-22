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
  const response = await fetch(validatedUrl, { redirect: "follow" });
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
    vendor: /temurin|adoptium/i.test(output)
      ? "Eclipse Temurin"
      : "OpenJDK",
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
    throw new Error("runtime user-data directory and metadata client are required");
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
      const compatible = (input.installedRuntimes || []).find(
        (runtime) => Number(runtime.majorVersion) >= majorVersion,
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
        throw provisioningError("JAVA_PLAN_INVALID", "Managed Java plan is invalid.");
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
  };
}

module.exports = {
  TEMURIN_LICENSE_URL,
  createRuntimeManager,
  requiredJavaMajorForMinecraft,
};

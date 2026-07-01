import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type { LoaderType } from "./types";

export interface DetectedServerInfo {
  loaderType: LoaderType | null;
  minecraftVersion: string | null;
  loaderVersion: string | null;
  serverJarName: string | null;
  hasEula: boolean;
  hasServerProperties: boolean;
  serverPort: number | null;
}

/**
 * Scan a server directory to auto-detect loader type, MC version, and configuration.
 * Used when importing an existing server folder.
 */
export function detectServerVersion(rootDir: string) {
  return invokeDesktopCommandWithErrorHandling<DetectedServerInfo>(
    "detect_server_version",
    { rootDir },
  );
}

/**
 * Detect Java installations available on this system.
 * Returns paths and version info for each found JRE/JDK.
 */
export interface DetectedJava {
  path: string;
  version: string;
  vendor: string | null;
  architecture: string | null;
}

export function detectSystemJava() {
  return invokeDesktopCommandWithErrorHandling<DetectedJava[]>(
    "detect_system_java",
  );
}

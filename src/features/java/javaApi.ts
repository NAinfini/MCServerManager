import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface JavaRuntime {
  path: string;
  source: string;
  version: string;
  majorVersion: number;
  vendor?: string | null;
  architecture?: string | null;
}

export interface JavaScanFailure {
  path: string;
  source: string;
  error: string;
}

export interface ServerJavaCompatibility {
  serverId: string;
  serverName: string;
  minecraftVersion?: string | null;
  configuredJavaPath?: string | null;
  requiredMajorVersion?: number | null;
  status: "compatible" | "warning" | "unknown" | string;
  message: string;
}

export interface JavaScanResult {
  runtimes: JavaRuntime[];
  failures: JavaScanFailure[];
  compatibility: ServerJavaCompatibility[];
}

export async function listJavaRuntimes() {
  return invokeDesktopCommandWithErrorHandling<JavaScanResult>("list_java_runtimes");
}

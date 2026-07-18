import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface JavaRuntime {
  path: string;
  source: string;
  version: string;
  majorVersion: number;
  vendor?: string | null;
  architecture?: string | null;
  managed?: boolean;
}

export interface ManagedJavaPlan {
  action: "reuse" | "install";
  majorVersion: number;
  runtime?: JavaRuntime;
  vendor?: string;
  version?: string;
  licenseUrl?: string;
  managed?: boolean;
  [key: string]: unknown;
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

export function planJavaRuntime(majorVersion: number) {
  return invokeDesktopCommandWithErrorHandling<ManagedJavaPlan>(
    "plan_java_runtime",
    { input: { majorVersion } },
  );
}

export function installJavaRuntime(plan: ManagedJavaPlan, consent: boolean) {
  return invokeDesktopCommandWithErrorHandling<JavaRuntime>(
    "install_java_runtime",
    { input: { plan, consent } },
  );
}

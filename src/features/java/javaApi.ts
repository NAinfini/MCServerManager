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

export type ManagedJavaRuntime = Pick<JavaRuntime, "path" | "majorVersion"> &
  Partial<Omit<JavaRuntime, "path" | "majorVersion">>;

export interface ManagedJavaPlan {
  action: "reuse" | "install";
  majorVersion: number;
  runtime?: ManagedJavaRuntime;
  vendor?: string;
  version?: string;
  licenseUrl?: string;
  managed?: boolean;
  [key: string]: unknown;
}

export type JavaRuntimePlan = ManagedJavaPlan;

export interface JavaScanFailure {
  path: string;
  source: string;
  /* The backend reports these inside a payload rather than by throwing, so the
     IPC error tagging never sees them and the view translates the code here. */
  code?: string | null;
  detail?: string;
  error: string;
}

export interface ServerJavaCompatibility {
  serverId: string;
  serverName: string;
  minecraftVersion?: string | null;
  configuredJavaPath?: string | null;
  requiredMajorVersion?: number | null;
  /* The highest Java this server can run on, or null when none is established.
     Minecraft up to 1.16 has one, so its required major is also its only
     option — a newer runtime is not an upgrade, it is a crash. */
  maxMajorVersion?: number | null;
  /* The major this server runs on today, and whether that build can address a
     large heap. Together they let the view name the real problem rather than
     restate the requirement. */
  configuredMajorVersion?: number | null;
  configuredArchitecture?: string | null;
  /* A runtime already on this machine that fits both the version window and the
     configured heap, or null if none does. The backend picks it so the rule is
     not re-derived here. */
  recommendedJavaPath?: string | null;
  reason?: "tooNew" | "tooOld" | "architecture" | null;
  status: "compatible" | "warning" | "unknown" | string;
  message: string;
}

export interface JavaScanResult {
  runtimes: JavaRuntime[];
  failures: JavaScanFailure[];
  compatibility: ServerJavaCompatibility[];
}

export async function listJavaRuntimes() {
  return invokeDesktopCommandWithErrorHandling<JavaScanResult>(
    "list_java_runtimes",
  );
}

export function planJavaRuntime(
  majorVersion: number,
  /* Null means no established ceiling. Minecraft up to 1.16 has one: it boots
     through a launcher that only works on Java 8, so a newer runtime already
     on the machine must not be reused for it. */
  maxMajorVersion: number | null = null,
) {
  return invokeDesktopCommandWithErrorHandling<ManagedJavaPlan>(
    "plan_java_runtime",
    { input: { majorVersion, maxMajorVersion } },
  );
}

export function installJavaRuntime(plan: ManagedJavaPlan, consent: boolean) {
  return invokeDesktopCommandWithErrorHandling<ManagedJavaRuntime>(
    "install_java_runtime",
    { input: { plan, consent } },
  );
}

/* Only runtimes this app installed. The backend refuses anything else and
   anything a server is still pointed at, so the button does not have to be the
   only thing standing between a user and a broken server. */
export function removeJavaRuntime(javaPath: string) {
  return invokeDesktopCommandWithErrorHandling<{ path: string }>(
    "remove_java_runtime",
    { input: { path: javaPath } },
  );
}

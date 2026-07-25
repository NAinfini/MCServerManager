export type LoaderType =
  | "vanilla"
  | "paper"
  | "forge"
  | "neoForge"
  | "fabric"
  | "quilt";

export interface ServerLaunchSpec {
  executable: { kind: "java" };
  workingDirectory: string;
  jvmArgs: string[];
  serverArgs: string[];
  validated?: boolean;
}

export interface CompatibilityWarning {
  code: string;
  message: string;
  acknowledged?: boolean;
  requiresAcknowledgement?: boolean;
}

export interface RestartPolicy {
  enabled: boolean;
  maxAttempts: number;
  cooldownSeconds: number;
}

export interface ServerProfile {
  id: string;
  name: string;
  rootDir: string;
  minecraftVersion?: string | null;
  loaderType: LoaderType;
  loaderVersion?: string | null;
  javaPath?: string | null;
  serverPort?: number | null;
  minMemoryMb?: number | null;
  maxMemoryMb?: number | null;
  autoStart: boolean;
  launchSpec?: ServerLaunchSpec | null;
  compatibilityWarnings?: CompatibilityWarning[];
  createdAt: string;
  updatedAt: string;
  restartPolicy: RestartPolicy;
}

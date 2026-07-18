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
}

export interface CompatibilityWarning {
  code: string;
  message: string;
  acknowledged?: boolean;
}

export type ServerCreationSourceKind =
  "blank" | "existingFolder" | "marketplaceModpack" | "localModpackFile";

export type ServerCreationSource =
  | { kind: "blank" }
  | { kind: "existingFolder" }
  | {
      kind: "marketplaceModpack";
      provider: string;
      projectId: string;
      versionId: string;
    }
  | { kind: "localModpackFile"; path: string };

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

export interface CreateServerProfileInput {
  source: ServerCreationSource;
  name: string;
  rootDir: string;
  loaderType: LoaderType;
  minecraftVersion?: string | null;
  loaderVersion?: string | null;
  javaPath?: string | null;
  serverPort?: number | null;
  minMemoryMb?: number | null;
  maxMemoryMb?: number | null;
  restartPolicy?: RestartPolicy;
}

export interface UpdateServerProfileInput {
  id: string;
  name?: string;
  rootDir?: string;
  minecraftVersion?: string | null;
  loaderType?: LoaderType;
  loaderVersion?: string | null;
  javaPath?: string | null;
  serverPort?: number | null;
  minMemoryMb?: number | null;
  maxMemoryMb?: number | null;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
}

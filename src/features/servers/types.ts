import type {
  LoaderType,
  RestartPolicy,
} from "../../domain/server";

export type {
  CompatibilityWarning,
  LoaderType,
  RestartPolicy,
  ServerLaunchSpec,
  ServerProfile,
} from "../../domain/server";

export interface GuidedServerConfiguration {
  serverPort: number;
  minMemoryMb: number;
  maxMemoryMb: number;
  gameMode?: string;
  difficulty?: string;
  maxPlayers?: number;
  motd?: string;
  onlineMode?: boolean;
  pvp?: boolean;
  whiteList?: boolean;
  viewDistance?: number;
  simulationDistance?: number;
}

export interface ExplicitEulaAcceptance {
  accepted: true;
  termsUrl: string;
  acceptedAt: string;
}

export interface ValidatedJavaRuntime {
  path: string;
  majorVersion: number;
  validated: true;
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

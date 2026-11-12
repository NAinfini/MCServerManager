import type { LoaderType } from "../../domain/server";

/* What electron/provisioning/pack-detect.cjs reports about a dropped file. The
   card shows these values and their evidence; nothing here is a default. */
export type PackKind =
  "serverPack" | "clientPack" | "mrpack" | "bareJar" | "unknown";

export interface PackEvidence {
  field: string;
  value: string;
  source: string;
  detail?: string;
}

export interface PackWarning {
  code: string;
  message: string;
  params?: Record<string, unknown>;
  requiresAcknowledgement?: boolean;
}

export interface PackDetection {
  kind: PackKind;
  jarRole?: string;
  name: string;
  root: string;
  loader: { type: LoaderType; version: string | null } | null;
  minecraftVersion: string | null;
  modCount: number;
  modCheck: { checked: number; incompatible: number };
  memory: {
    maxMb: number;
    minMb: number;
    source: "pack" | "recommended";
    statedSource: string | null;
    totalMb: number | null;
  } | null;
  javaMajor: number | null;
  port: { value: number; source: string } | null;
  packEulaAccepted?: boolean;
  clientOnlyMods: { file: string; name: string; declared: string | null }[];
  disabledMods: string[];
  missing: string[];
  unfetchable: {
    provider: string;
    projectId: string;
    fileId: string;
    reason: string;
  }[];
  warnings: PackWarning[];
  evidence: PackEvidence[];
  sizeBytes: number;
}

export const SUPPORTED_DROP_PATTERN = /\.(?:zip|mrpack|jar)$/i;

export function isPackFilePath(path: string) {
  return SUPPORTED_DROP_PATTERN.test(path);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(2)} ${units[unit]}`;
}

export function formatMemory(mb: number) {
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

export const MINECRAFT_VERSION_PATTERN = /^\d{1,2}(?:\.\d{1,2}){1,2}$/;
export const LOADER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function loaderLabel(type: string | null | undefined) {
  switch (type) {
    case "neoForge":
      return "NeoForge";
    case "forge":
      return "Forge";
    case "fabric":
      return "Fabric";
    case "quilt":
      return "Quilt";
    case "paper":
      return "Paper";
    case "vanilla":
      return "Vanilla";
    default:
      return type || "";
  }
}

import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";

export type CloseBehavior = "minimize" | "quit";
export type LogLevel = "debug" | "info" | "warning" | "error";
export type JavaStrategy = "auto" | "latest-lts" | "manual";
export type CompressionFormat = "zip" | "tar.gz";
export type BackupFrequency = "manual" | "daily" | "weekly";
export type MarketplaceProvider = "modrinth" | "bbsmc" | "hangar";
export type MotionStrength = "full" | "reduced" | "off";
export type FontSize = "small" | "medium" | "large";

export interface AppPreferences {
  closeBehavior: CloseBehavior;
  launchAtLogin: boolean;
  defaultServerDir: string;
  defaultBackupDir: string;
  cacheDir: string;
  appDataDir: string;
  logging: {
    retentionDays: number;
    maxSizeMb: number;
    level: LogLevel;
  };
  serverDefaults: {
    javaStrategy: JavaStrategy;
    minMemoryMb: number;
    maxMemoryMb: number;
  };
  backupDefaults: {
    compression: CompressionFormat;
    retentionDays: number;
    frequency: BackupFrequency;
  };
  marketplace: {
    defaultProvider: MarketplaceProvider;
    showIncompatible: boolean;
    autoInstallDependencies: boolean;
    cacheSizeMb: number;
  };
  appearance: {
    compactMode: boolean;
    motion: MotionStrength;
    fontSize: FontSize;
  };
  providers: {
    modrinth: boolean;
    hangar: boolean;
    bbsmc: boolean;
    curseforge: boolean;
  };
}

export const settingsKeys = queryKeys.settings;

export function getAppPreferences() {
  return invokeDesktopCommandWithErrorHandling<AppPreferences>(
    "get_app_preferences",
  );
}

export function saveAppPreferences(input: Partial<AppPreferences>) {
  return invokeDesktopCommandWithErrorHandling<AppPreferences>(
    "save_app_preferences",
    { input },
  );
}

export function resetAppPreferences() {
  return invokeDesktopCommandWithErrorHandling<AppPreferences>(
    "reset_app_preferences",
  );
}

export function importAppSettings(path: string) {
  return invokeDesktopCommandWithErrorHandling<AppPreferences>(
    "import_app_settings",
    { input: { path } },
  );
}

export function exportAppSettings(path: string) {
  return invokeDesktopCommandWithErrorHandling<void>("export_app_settings", {
    input: { path },
  });
}

export function clearAppCache() {
  return invokeDesktopCommandWithErrorHandling<void>("clear_app_cache");
}

export function exportDiagnosticPackage(path: string) {
  return invokeDesktopCommandWithErrorHandling<void>(
    "export_diagnostic_package",
    { input: { path } },
  );
}

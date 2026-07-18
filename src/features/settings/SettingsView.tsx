import { useEffect, useState } from "react";
import {
  Cog,
  Palette,
  Bell,
  Package,
  FolderOpen,
  Download,
  Info,
  ExternalLink,
  Archive,
  Database,
  FileText,
  Server,
  ShoppingBag,
} from "lucide-react";
import { useAppSettings } from "../../i18n";
import { Switch } from "../../components/ui/switch";
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { ThemeSettings } from "./ThemeSettings";
import { LocalizationSettings } from "./LocalizationSettings";
import { NotificationSettings } from "./NotificationSettings";
import { UpdateStatus } from "./UpdateStatus";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";

type SettingsSection =
  | "general"
  | "appearance"
  | "logging"
  | "serverDefaults"
  | "backupDefaults"
  | "marketplace"
  | "notifications"
  | "providers"
  | "paths"
  | "data"
  | "updates"
  | "about";

type CloseBehavior = "minimize" | "quit";
type LogLevel = "debug" | "info" | "warning" | "error";
type JavaStrategy = "auto" | "latest-lts" | "manual";
type CompressionFormat = "zip" | "tar.gz";
type BackupFrequency = "manual" | "daily" | "weekly";
type MarketplaceProvider = "modrinth" | "bbsmc" | "hangar";
type MotionStrength = "full" | "reduced" | "off";
type FontSize = "small" | "medium" | "large";

type AppPreferences = {
  closeBehavior: CloseBehavior;
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
};

const DEFAULT_PREFERENCES: AppPreferences = {
  closeBehavior: "minimize",
  defaultServerDir: "~/MCServers",
  defaultBackupDir: "~/MCServers/backups",
  cacheDir: "%APPDATA%/mc-server-manager/cache",
  appDataDir: "%APPDATA%/mc-server-manager",
  logging: {
    retentionDays: 14,
    maxSizeMb: 25,
    level: "info",
  },
  serverDefaults: {
    javaStrategy: "auto",
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
  },
  backupDefaults: {
    compression: "zip",
    retentionDays: 14,
    frequency: "daily",
  },
  marketplace: {
    defaultProvider: "modrinth",
    showIncompatible: false,
    autoInstallDependencies: true,
    cacheSizeMb: 1024,
  },
  appearance: {
    compactMode: false,
    motion: "full",
    fontSize: "medium",
  },
  providers: {
    modrinth: true,
    hangar: true,
    bbsmc: true,
    curseforge: true,
  },
};

function withPreferenceDefaults(input: Partial<AppPreferences>): AppPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...input,
    logging: {
      ...DEFAULT_PREFERENCES.logging,
      ...(input.logging ?? {}),
    },
    serverDefaults: {
      ...DEFAULT_PREFERENCES.serverDefaults,
      ...(input.serverDefaults ?? {}),
    },
    backupDefaults: {
      ...DEFAULT_PREFERENCES.backupDefaults,
      ...(input.backupDefaults ?? {}),
    },
    marketplace: {
      ...DEFAULT_PREFERENCES.marketplace,
      ...(input.marketplace ?? {}),
    },
    appearance: {
      ...DEFAULT_PREFERENCES.appearance,
      ...(input.appearance ?? {}),
    },
    providers: {
      ...DEFAULT_PREFERENCES.providers,
      ...(input.providers ?? {}),
    },
  };
}

const NAV_ITEMS: Array<{ key: SettingsSection; icon: typeof Cog; labelKey: string }> = [
  { key: "general", icon: Cog, labelKey: "settings.nav.general" },
  { key: "appearance", icon: Palette, labelKey: "settings.nav.appearance" },
  { key: "logging", icon: FileText, labelKey: "settings.nav.logging" },
  { key: "serverDefaults", icon: Server, labelKey: "settings.nav.serverDefaults" },
  { key: "backupDefaults", icon: Archive, labelKey: "settings.nav.backupDefaults" },
  { key: "marketplace", icon: ShoppingBag, labelKey: "settings.nav.marketplace" },
  { key: "notifications", icon: Bell, labelKey: "settings.nav.notifications" },
  { key: "providers", icon: Package, labelKey: "settings.nav.providers" },
  { key: "paths", icon: FolderOpen, labelKey: "settings.nav.paths" },
  { key: "data", icon: Database, labelKey: "settings.nav.data" },
  { key: "updates", icon: Download, labelKey: "settings.nav.updates" },
  { key: "about", icon: Info, labelKey: "settings.nav.about" },
];

type SettingsSectionProps = {
  preferences: AppPreferences;
  onUpdate: (patch: Partial<AppPreferences>) => Promise<void>;
  onError: (message: string) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function GeneralSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.nav.general")}</h2>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.general.launchAtLogin")}</strong>
          <span>{t("settings.general.launchAtLoginNote")}</span>
        </div>
        <Switch checked={false} disabled aria-label={t("settings.general.launchAtLogin")} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.general.closeBehavior")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.general.closeBehavior")}
          value={preferences.closeBehavior}
          options={[
            { value: "minimize", label: t("settings.general.closeMinimize") },
            { value: "quit", label: t("settings.general.closeQuit") },
          ]}
          onValueChange={(value) => {
            void onUpdate({ closeBehavior: value as CloseBehavior }).catch(
              (error: unknown) => onError(errorMessage(error)),
            );
          }}
        />
      </div>
    </div>
  );
}

function numberValue(value: number, fallback: number) {
  return Number.isFinite(value) ? String(value) : String(fallback);
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function AppearanceSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const appearance = preferences.appearance;

  return (
    <div>
      <ThemeSettings />
      <LocalizationSettings />
      <div className="settings-plain-section">
        <h2 className="settings-section-title">{t("settings.appearance.behavior")}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t("settings.appearance.compactMode")}</strong>
          </div>
          <Switch
            checked={appearance.compactMode}
            aria-label={t("settings.appearance.compactMode")}
            onCheckedChange={(checked) =>
              void onUpdate({
                appearance: { ...appearance, compactMode: checked },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t("settings.appearance.motion")}</strong>
          </div>
          <Select
            ariaLabel={t("settings.appearance.motion")}
            value={appearance.motion}
            options={[
              { value: "full", label: t("settings.appearance.motionFull") },
              { value: "reduced", label: t("settings.appearance.motionReduced") },
              { value: "off", label: t("settings.appearance.motionOff") },
            ]}
            onValueChange={(value) =>
              void onUpdate({
                appearance: { ...appearance, motion: value as MotionStrength },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t("settings.appearance.fontSize")}</strong>
          </div>
          <Select
            ariaLabel={t("settings.appearance.fontSize")}
            value={appearance.fontSize}
            options={[
              { value: "small", label: t("settings.appearance.fontSmall") },
              { value: "medium", label: t("settings.appearance.fontMedium") },
              { value: "large", label: t("settings.appearance.fontLarge") },
            ]}
            onValueChange={(value) =>
              void onUpdate({
                appearance: { ...appearance, fontSize: value as FontSize },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </div>
      </div>
    </div>
  );
}

function LoggingSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const logging = preferences.logging;
  const [diagnosticsExported, setDiagnosticsExported] = useState(false);

  const exportDiagnostics = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>("show_save_dialog", {
        defaultPath: "mc-server-manager-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.path) {
        return;
      }
      await invokeDesktopCommand("export_diagnostic_package", {
        input: { path: result.path },
      });
      setDiagnosticsExported(true);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.logging.title")}</h2>
      <p className="settings-section-description">{t("settings.logging.description")}</p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.level")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.logging.level")}
          value={logging.level}
          options={[
            { value: "debug", label: t("logger.level.debug") },
            { value: "info", label: t("logger.level.info") },
            { value: "warning", label: t("logger.level.warning") },
            { value: "error", label: t("logger.level.error") },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              logging: { ...logging, level: value as LogLevel },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.retentionDays")}</strong>
        </div>
        <TextField
          aria-label={t("settings.logging.retentionDays")}
          className="settings-number-input"
          min={1}
          type="number"
          value={numberValue(logging.retentionDays, 14)}
          onChange={(event) =>
            void onUpdate({
              logging: {
                ...logging,
                retentionDays: toPositiveInt(event.currentTarget.value, 14),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.maxSizeMb")}</strong>
        </div>
        <TextField
          aria-label={t("settings.logging.maxSizeMb")}
          className="settings-number-input"
          min={1}
          type="number"
          value={numberValue(logging.maxSizeMb, 25)}
          onChange={(event) =>
            void onUpdate({
              logging: {
                ...logging,
                maxSizeMb: toPositiveInt(event.currentTarget.value, 25),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.logsFolder")}</strong>
          {diagnosticsExported ? <span>{t("settings.logging.exported")}</span> : null}
        </div>
        <div className="settings-action-group">
          <Button
            variant="secondary"
            onClick={() =>
              void invokeDesktopCommand("open_app_logs_folder").catch(
                (error: unknown) => onError(errorMessage(error)),
              )
            }
          >
            {t("settings.logging.openLogFolder")}
          </Button>
          <Button variant="secondary" onClick={() => void exportDiagnostics()}>
            {t("settings.logging.exportDiagnostics")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ServerDefaultsSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const defaults = preferences.serverDefaults;

  const pickServerFolder = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result.path) {
        await onUpdate({ defaultServerDir: result.path });
      }
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.serverDefaults.title")}</h2>
      <p className="settings-section-description">{t("settings.serverDefaults.description")}</p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.serverDefault")}</strong>
          <span className="settings-path-value">{preferences.defaultServerDir}</span>
        </div>
        <Button variant="secondary" onClick={() => void pickServerFolder()}>
          {t("profileSettings.browse")}
        </Button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.serverDefaults.javaStrategy")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.serverDefaults.javaStrategy")}
          value={defaults.javaStrategy}
          options={[
            { value: "auto", label: t("settings.serverDefaults.javaAuto") },
            { value: "latest-lts", label: t("settings.serverDefaults.javaLatestLts") },
            { value: "manual", label: t("settings.serverDefaults.javaManual") },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              serverDefaults: { ...defaults, javaStrategy: value as JavaStrategy },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.serverDefaults.memoryRange")}</strong>
          <span>{t("settings.serverDefaults.memoryRangeNote")}</span>
        </div>
        <div className="settings-inline-fields">
          <TextField
            aria-label={t("settings.serverDefaults.minMemory")}
            className="settings-number-input"
            min={512}
            type="number"
            value={numberValue(defaults.minMemoryMb, 1024)}
            onChange={(event) =>
              void onUpdate({
                serverDefaults: {
                  ...defaults,
                  minMemoryMb: toPositiveInt(event.currentTarget.value, 1024),
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
          <TextField
            aria-label={t("settings.serverDefaults.maxMemory")}
            className="settings-number-input"
            min={512}
            type="number"
            value={numberValue(defaults.maxMemoryMb, 4096)}
            onChange={(event) =>
              void onUpdate({
                serverDefaults: {
                  ...defaults,
                  maxMemoryMb: toPositiveInt(event.currentTarget.value, 4096),
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </div>
      </div>
    </div>
  );
}

function BackupDefaultsSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const defaults = preferences.backupDefaults;

  const pickBackupFolder = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result.path) {
        await onUpdate({ defaultBackupDir: result.path });
      }
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.backupDefaults.title")}</h2>
      <p className="settings-section-description">{t("settings.backupDefaults.description")}</p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.backupDefault")}</strong>
          <span className="settings-path-value">{preferences.defaultBackupDir}</span>
        </div>
        <Button variant="secondary" onClick={() => void pickBackupFolder()}>
          {t("profileSettings.browse")}
        </Button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.backupDefaults.compression")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.backupDefaults.compression")}
          value={defaults.compression}
          options={[
            { value: "zip", label: "ZIP" },
            { value: "tar.gz", label: "tar.gz" },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              backupDefaults: {
                ...defaults,
                compression: value as CompressionFormat,
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.backupDefaults.frequency")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.backupDefaults.frequency")}
          value={defaults.frequency}
          options={[
            { value: "manual", label: t("settings.backupDefaults.frequencyManual") },
            { value: "daily", label: t("settings.backupDefaults.frequencyDaily") },
            { value: "weekly", label: t("settings.backupDefaults.frequencyWeekly") },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              backupDefaults: {
                ...defaults,
                frequency: value as BackupFrequency,
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.backupDefaults.retentionDays")}</strong>
        </div>
        <TextField
          aria-label={t("settings.backupDefaults.retentionDays")}
          className="settings-number-input"
          min={1}
          type="number"
          value={numberValue(defaults.retentionDays, 14)}
          onChange={(event) =>
            void onUpdate({
              backupDefaults: {
                ...defaults,
                retentionDays: toPositiveInt(event.currentTarget.value, 14),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
    </div>
  );
}

function MarketplaceSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const marketplace = preferences.marketplace;
  const [cacheCleared, setCacheCleared] = useState(false);

  const clearCache = async () => {
    try {
      await invokeDesktopCommand("clear_app_cache");
      setCacheCleared(true);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.marketplace.title")}</h2>
      <p className="settings-section-description">{t("settings.marketplace.description")}</p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.marketplace.defaultProvider")}</strong>
        </div>
        <Select
          ariaLabel={t("settings.marketplace.defaultProvider")}
          value={marketplace.defaultProvider}
          options={[
            { value: "modrinth", label: t("settings.providers.modrinth") },
            { value: "bbsmc", label: t("settings.providers.bbsmc") },
            { value: "hangar", label: t("settings.providers.hangar") },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              marketplace: {
                ...marketplace,
                defaultProvider: value as MarketplaceProvider,
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.marketplace.showIncompatible")}</strong>
        </div>
        <Switch
          checked={marketplace.showIncompatible}
          aria-label={t("settings.marketplace.showIncompatible")}
          onCheckedChange={(checked) =>
            void onUpdate({
              marketplace: { ...marketplace, showIncompatible: checked },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.marketplace.autoInstallDependencies")}</strong>
        </div>
        <Switch
          checked={marketplace.autoInstallDependencies}
          aria-label={t("settings.marketplace.autoInstallDependencies")}
          onCheckedChange={(checked) =>
            void onUpdate({
              marketplace: { ...marketplace, autoInstallDependencies: checked },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.marketplace.cacheSizeMb")}</strong>
          {cacheCleared ? <span>{t("settings.paths.cacheCleared")}</span> : null}
        </div>
        <div className="settings-action-group">
          <TextField
            aria-label={t("settings.marketplace.cacheSizeMb")}
            className="settings-number-input"
            min={1}
            type="number"
            value={numberValue(marketplace.cacheSizeMb, 1024)}
            onChange={(event) =>
              void onUpdate({
                marketplace: {
                  ...marketplace,
                  cacheSizeMb: toPositiveInt(event.currentTarget.value, 1024),
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
          <Button variant="secondary" onClick={() => void clearCache()}>
            {t("settings.paths.clearCache")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProvidersSection({ preferences, onUpdate, onError }: SettingsSectionProps) {
  const { t } = useAppSettings();
  const providers = preferences.providers;
  const updateProvider = (
    key: keyof AppPreferences["providers"],
    checked: boolean,
  ) =>
    onUpdate({
      providers: {
        ...providers,
        [key]: checked,
      },
    }).catch((error: unknown) => onError(errorMessage(error)));

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.providers.title")}</h2>
      <p className="settings-section-description">
        {t("settings.providers.title")}
      </p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.providers.modrinth")}</strong>
          <span>{t("settings.providers.alwaysEnabled")}</span>
        </div>
        <Switch checked disabled aria-label={t("settings.providers.modrinth")} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.providers.hangar")}</strong>
        </div>
        <Switch
          checked={providers.hangar}
          aria-label={t("settings.providers.hangar")}
          onCheckedChange={(checked) => void updateProvider("hangar", checked)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.providers.bbsmc")}</strong>
        </div>
        <Switch
          checked={providers.bbsmc}
          aria-label={t("settings.providers.bbsmc")}
          onCheckedChange={(checked) => void updateProvider("bbsmc", checked)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.providers.curseforge")}</strong>
          <span>{t("settings.providers.manualImportOnly")}</span>
        </div>
      </div>
    </div>
  );
}

function PathsSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();
  const [cacheCleared, setCacheCleared] = useState(false);
  const pickFolder = async (key: "defaultServerDir" | "defaultBackupDir") => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (!result.path) {
        return;
      }
      await onUpdate({ [key]: result.path });
      setCacheCleared(false);
    } catch (error) {
      onError(errorMessage(error));
    }
  };
  const clearCache = async () => {
    try {
      await invokeDesktopCommand("clear_app_cache");
      setCacheCleared(true);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.nav.paths")}</h2>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.appData")}</strong>
          <span className="settings-path-value">{preferences.appDataDir}</span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.serverDefault")}</strong>
          <span className="settings-path-value">
            {preferences.defaultServerDir}
          </span>
        </div>
        <Button
          variant="secondary"
          onClick={() => void pickFolder("defaultServerDir")}
        >
          {t("profileSettings.browse")}
        </Button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.backupDefault")}</strong>
          <span className="settings-path-value">
            {preferences.defaultBackupDir}
          </span>
        </div>
        <Button
          variant="secondary"
          onClick={() => void pickFolder("defaultBackupDir")}
        >
          {t("profileSettings.browse")}
        </Button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.cache")}</strong>
          <span className="settings-path-value">{preferences.cacheDir}</span>
          {cacheCleared ? (
            <span>{t("settings.paths.cacheCleared")}</span>
          ) : null}
        </div>
        <Button variant="secondary" onClick={() => void clearCache()}>
          {t("settings.paths.clearCache")}
        </Button>
      </div>
    </div>
  );
}

function DataManagementSection({
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();
  const [resetOpen, setResetOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const exportSettings = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>("show_save_dialog", {
        defaultPath: "mc-server-manager-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.path) {
        return;
      }
      await invokeDesktopCommand("export_app_settings", {
        input: { path: result.path },
      });
      setStatus(t("settings.data.exported"));
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  const importSettings = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>("show_open_dialog", {
        kind: "file",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.path) {
        return;
      }
      const importedPreferences = await invokeDesktopCommand<AppPreferences>(
        "import_app_settings",
        { input: { path: result.path } },
      );
      await onUpdate(importedPreferences);
      setStatus(t("settings.data.imported"));
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  const resetSettings = async () => {
    try {
      const resetPreferences = await invokeDesktopCommand<AppPreferences>(
        "reset_app_preferences",
      );
      await onUpdate(resetPreferences);
      setResetOpen(false);
      setStatus(t("settings.data.resetDone"));
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.data.title")}</h2>
      <p className="settings-section-description">{t("settings.data.description")}</p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.data.settingsFile")}</strong>
          {status ? <span>{status}</span> : null}
        </div>
        <div className="settings-action-group">
          <Button variant="secondary" onClick={() => void exportSettings()}>
            {t("settings.data.export")}
          </Button>
          <Button variant="secondary" onClick={() => void importSettings()}>
            {t("settings.data.import")}
          </Button>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.appData")}</strong>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            void invokeDesktopCommand("open_app_data_folder").catch(
              (error: unknown) => onError(errorMessage(error)),
            )
          }
        >
          {t("settings.data.openAppData")}
        </Button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.data.reset")}</strong>
          <span>{t("settings.data.resetNote")}</span>
        </div>
        <Button variant="danger" onClick={() => setResetOpen(true)}>
          {t("settings.data.reset")}
        </Button>
      </div>
      <ConfirmDangerDialog
        isOpen={resetOpen}
        title={t("settings.data.reset")}
        description={t("settings.data.resetConfirm")}
        confirmLabel={t("settings.data.reset")}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void resetSettings()}
      />
    </div>
  );
}

function AboutSection() {
  const { t } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.about.title")}</h2>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.version")}</strong>
        </div>
        <span>0.1.0-dev</span>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.license")}</strong>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.noTelemetry")}</strong>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.github")}</strong>
        </div>
        <a
          className="settings-link"
          href="https://github.com/NAinfini/MCServerManager"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink aria-hidden="true" size={14} />
          GitHub
        </a>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.system")}</strong>
        </div>
      </div>
      <div className="settings-about-system">
        <span>Electron: {window.navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? "N/A"}</span>
        <span>Platform: {window.navigator.platform}</span>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  embedded?: boolean;
}

export function SettingsView({ embedded = false }: SettingsViewProps) {
  const { t } = useAppSettings();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    invokeDesktopCommand<AppPreferences>("get_app_preferences")
      .then((loadedPreferences) => {
        if (!loadedPreferences || typeof loadedPreferences !== "object") {
          throw new Error("Invalid app preferences response.");
        }
        if (isMounted) {
          setPreferences(withPreferenceDefaults(loadedPreferences));
          setSettingsError(null);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setSettingsError(errorMessage(error));
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const updatePreferences = async (patch: Partial<AppPreferences>) => {
    const nextPreferences = await invokeDesktopCommand<AppPreferences>(
      "save_app_preferences",
      { input: patch },
    );
    setPreferences(withPreferenceDefaults(nextPreferences));
    setSettingsError(null);
  };

  return (
    <section
      aria-label={embedded ? t("settings.page.title") : undefined}
      aria-labelledby={embedded ? undefined : "settings-title"}
      className={embedded ? "settings-page settings-page-embedded" : "settings-page"}
    >
      {!embedded ? (
        <div className="page-header">
          <div>
            <p className="eyebrow">{t("settings.page.eyebrow")}</p>
            <h1 id="settings-title">{t("settings.page.title")}</h1>
          </div>
        </div>
      ) : null}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.page.title")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={
                  isActive
                    ? "settings-nav-item settings-nav-item-active"
                    : "settings-nav-item"
                }
                aria-current={isActive ? "true" : undefined}
                onClick={() => setActiveSection(item.key)}
              >
                <Icon aria-hidden="true" size={14} />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
        <div className="settings-content">
          {settingsError ? (
            <p className="settings-error" role="alert">
              {settingsError}
            </p>
          ) : null}
          {activeSection === "general" ? (
            <GeneralSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "appearance" ? (
            <AppearanceSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "logging" ? (
            <LoggingSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "serverDefaults" ? (
            <ServerDefaultsSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "backupDefaults" ? (
            <BackupDefaultsSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "marketplace" ? (
            <MarketplaceSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "notifications" ? <NotificationSettings /> : null}
          {activeSection === "providers" ? (
            <ProvidersSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "paths" ? (
            <PathsSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "data" ? (
            <DataManagementSection
              preferences={preferences}
              onUpdate={updatePreferences}
              onError={setSettingsError}
            />
          ) : null}
          {activeSection === "updates" ? <UpdateStatus /> : null}
          {activeSection === "about" ? <AboutSection /> : null}
        </div>
      </div>
    </section>
  );
}

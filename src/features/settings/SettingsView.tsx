import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cog,
  Palette,
  Bell,
  Download,
  Info,
  ExternalLink,
  Database,
  Server,
  ShoppingBag,
} from "lucide-react";
import { useAppSettings } from "../../i18n";
import { Switch } from "../../components/ui/switch";
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { TextField } from "../../components/ui/text-field";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { ThemeSettings } from "./ThemeSettings";
import { LocalizationSettings } from "./LocalizationSettings";
import { NotificationSettings } from "./NotificationSettings";
import { UpdateStatus } from "./UpdateStatus";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { errorMessage } from "../../lib/error-message";
import {
  clearAppCache,
  exportDiagnosticPackage,
  exportAppSettings,
  getAppPreferences,
  importAppSettings,
  resetAppPreferences,
  saveAppPreferences,
  settingsKeys,
  type AppPreferences,
  type BackupFrequency,
  type CloseBehavior,
  type CompressionFormat,
  type FontSize,
  type JavaStrategy,
  type LogLevel,
  type MarketplaceProvider,
  type MotionStrength,
} from "./api";

export type SettingsSection =
  | "general"
  | "appearance"
  | "defaults"
  | "marketplace"
  | "notifications"
  | "storage"
  | "updates"
  | "about";

const NAV_ITEMS: Array<{
  key: SettingsSection;
  icon: typeof Cog;
  labelKey: string;
  groupStart?: boolean;
}> = [
  { key: "general", icon: Cog, labelKey: "settings.nav.general" },
  { key: "appearance", icon: Palette, labelKey: "settings.nav.appearance" },
  {
    key: "defaults",
    icon: Server,
    labelKey: "settings.nav.defaults",
    groupStart: true,
  },
  {
    key: "marketplace",
    icon: ShoppingBag,
    labelKey: "settings.nav.marketplaceSources",
  },
  { key: "notifications", icon: Bell, labelKey: "settings.nav.notifications" },
  { key: "storage", icon: Database, labelKey: "settings.nav.storage" },
  {
    key: "updates",
    icon: Download,
    labelKey: "settings.nav.updates",
    groupStart: true,
  },
  { key: "about", icon: Info, labelKey: "settings.nav.about" },
];

type SettingsSectionProps = {
  preferences: AppPreferences;
  onUpdate: (patch: Partial<AppPreferences>) => Promise<void>;
  onError: (message: string) => void;
};

function GeneralSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.nav.general")}</h2>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.general.launchAtLogin")}</strong>
          <span>{t("settings.general.launchAtLoginNote")}</span>
        </div>
        <Switch
          checked={preferences.launchAtLogin}
          aria-label={t("settings.general.launchAtLogin")}
          onCheckedChange={(checked) => {
            void onUpdate({ launchAtLogin: checked }).catch((error: unknown) =>
              onError(errorMessage(error)),
            );
          }}
        />
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

function SettingsNumberField({
  ariaLabel,
  min,
  value,
  onCommit,
}: {
  ariaLabel: string;
  min: number;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  return (
    <TextField
      aria-label={ariaLabel}
      className="settings-number-input"
      min={min}
      type="number"
      value={draft}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) {
          onCommit(draft);
        }
      }}
      onChange={(event) => {
        setEditing(true);
        setDraft(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function AppearanceSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();
  const appearance = preferences.appearance;

  return (
    <div>
      <ThemeSettings />
      <LocalizationSettings />
      <div className="settings-plain-section">
        <h2 className="settings-section-title">
          {t("settings.appearance.behavior")}
        </h2>
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
              {
                value: "reduced",
                label: t("settings.appearance.motionReduced"),
              },
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

function LoggingSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();
  const logging = preferences.logging;
  const [diagnosticsExported, setDiagnosticsExported] = useState(false);

  const exportDiagnostics = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_save_dialog",
        {
          defaultPath: "mc-server-manager-diagnostics.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        },
      );
      if (!result.path) {
        return;
      }
      await exportDiagnosticPackage(result.path);
      setDiagnosticsExported(true);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.logging.title")}</h2>
      <p className="settings-section-description">
        {t("settings.logging.description")}
      </p>
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
        <SettingsNumberField
          ariaLabel={t("settings.logging.retentionDays")}
          min={1}
          value={numberValue(logging.retentionDays, 14)}
          onCommit={(value) =>
            void onUpdate({
              logging: {
                ...logging,
                retentionDays: toPositiveInt(value, 14),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.maxSizeMb")}</strong>
        </div>
        <SettingsNumberField
          ariaLabel={t("settings.logging.maxSizeMb")}
          min={1}
          value={numberValue(logging.maxSizeMb, 25)}
          onCommit={(value) =>
            void onUpdate({
              logging: {
                ...logging,
                maxSizeMb: toPositiveInt(value, 25),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.logging.logsFolder")}</strong>
          {diagnosticsExported ? (
            <span>{t("settings.logging.exported")}</span>
          ) : null}
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

function ServerDefaultsSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
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
      <h2 className="settings-section-title">
        {t("settings.serverDefaults.title")}
      </h2>
      <p className="settings-section-description">
        {t("settings.serverDefaults.description")}
      </p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.serverDefault")}</strong>
          <span className="settings-path-value">
            {preferences.defaultServerDir}
          </span>
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
            {
              value: "latest-lts",
              label: t("settings.serverDefaults.javaLatestLts"),
            },
            { value: "manual", label: t("settings.serverDefaults.javaManual") },
          ]}
          onValueChange={(value) =>
            void onUpdate({
              serverDefaults: {
                ...defaults,
                javaStrategy: value as JavaStrategy,
              },
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
          <SettingsNumberField
            ariaLabel={t("settings.serverDefaults.minMemory")}
            min={512}
            value={numberValue(defaults.minMemoryMb, 1024)}
            onCommit={(value) =>
              void onUpdate({
                serverDefaults: {
                  ...defaults,
                  minMemoryMb: toPositiveInt(value, 1024),
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
          <SettingsNumberField
            ariaLabel={t("settings.serverDefaults.maxMemory")}
            min={512}
            value={numberValue(defaults.maxMemoryMb, 4096)}
            onCommit={(value) =>
              void onUpdate({
                serverDefaults: {
                  ...defaults,
                  maxMemoryMb: toPositiveInt(value, 4096),
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </div>
      </div>
    </div>
  );
}

function BackupDefaultsSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
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
      <h2 className="settings-section-title">
        {t("settings.backupDefaults.title")}
      </h2>
      <p className="settings-section-description">
        {t("settings.backupDefaults.description")}
      </p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.paths.backupDefault")}</strong>
          <span className="settings-path-value">
            {preferences.defaultBackupDir}
          </span>
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
            {
              value: "manual",
              label: t("settings.backupDefaults.frequencyManual"),
            },
            {
              value: "daily",
              label: t("settings.backupDefaults.frequencyDaily"),
            },
            {
              value: "weekly",
              label: t("settings.backupDefaults.frequencyWeekly"),
            },
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
        <SettingsNumberField
          ariaLabel={t("settings.backupDefaults.retentionDays")}
          min={1}
          value={numberValue(defaults.retentionDays, 14)}
          onCommit={(value) =>
            void onUpdate({
              backupDefaults: {
                ...defaults,
                retentionDays: toPositiveInt(value, 14),
              },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </div>
    </div>
  );
}

function MarketplaceSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
  const { t } = useAppSettings();
  const marketplace = preferences.marketplace;
  const [cacheCleared, setCacheCleared] = useState(false);

  const clearCache = async () => {
    try {
      await clearAppCache();
      setCacheCleared(true);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">
        {t("settings.marketplace.title")}
      </h2>
      <p className="settings-section-description">
        {t("settings.marketplace.description")}
      </p>
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
          {cacheCleared ? (
            <span>{t("settings.paths.cacheCleared")}</span>
          ) : null}
        </div>
        <div className="settings-action-group">
          <SettingsNumberField
            ariaLabel={t("settings.marketplace.cacheSizeMb")}
            min={1}
            value={numberValue(marketplace.cacheSizeMb, 1024)}
            onCommit={(value) =>
              void onUpdate({
                marketplace: {
                  ...marketplace,
                  cacheSizeMb: toPositiveInt(value, 1024),
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

function ProvidersSection({
  preferences,
  onUpdate,
  onError,
}: SettingsSectionProps) {
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
      <h2 className="settings-section-title">
        {t("settings.providers.title")}
      </h2>
      <p className="settings-section-description">
        {t("settings.providers.title")}
      </p>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.providers.modrinth")}</strong>
          <span>{t("settings.providers.alwaysEnabled")}</span>
        </div>
        <span className="settings-static-state">
          {t("settings.providers.alwaysEnabled")}
        </span>
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
      await clearAppCache();
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
  onReplace,
  onError,
}: {
  onReplace: (preferences: AppPreferences) => void;
  onError: (message: string) => void;
}) {
  const { t } = useAppSettings();
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);

  const exportSettings = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_save_dialog",
        {
          defaultPath: "mc-server-manager-settings.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        },
      );
      if (!result.path) {
        return;
      }
      await exportAppSettings(result.path);
      setStatus(t("settings.data.exported"));
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  const importSettings = async () => {
    try {
      const result = await invokeDesktopCommand<{ path?: string }>(
        "show_open_dialog",
        {
          kind: "file",
          filters: [{ name: "JSON", extensions: ["json"] }],
        },
      );
      if (!result.path) {
        return;
      }
      setPendingImportPath(result.path);
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  const applyImportSettings = async (path: string) => {
    try {
      const importedPreferences = await importAppSettings(path);
      onReplace(importedPreferences);
      setPendingImportPath(null);
      setStatus(t("settings.data.imported"));
    } catch (error) {
      setPendingImportPath(null);
      onError(errorMessage(error));
    }
  };

  const resetSettings = async () => {
    try {
      const resetPreferences = await resetAppPreferences();
      onReplace(resetPreferences);
      setResetOpen(false);
      setStatus(t("settings.data.resetDone"));
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  return (
    <div>
      <h2 className="settings-section-title">{t("settings.data.title")}</h2>
      <p className="settings-section-description">
        {t("settings.data.description")}
      </p>
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
      <ConfirmDangerDialog
        isOpen={pendingImportPath !== null}
        title={t("settings.data.import")}
        description={t("settings.data.importConfirm", {
          path: pendingImportPath ?? "",
        })}
        confirmLabel={t("settings.data.import")}
        onCancel={() => setPendingImportPath(null)}
        onConfirm={() => {
          if (pendingImportPath) {
            void applyImportSettings(pendingImportPath);
          }
        }}
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
        <span>{__APP_VERSION__}</span>
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
          <strong>{t("settings.about.disclaimerTitle")}</strong>
          <span>{t("settings.about.disclaimer")}</span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>{t("settings.about.system")}</strong>
        </div>
      </div>
      <div className="settings-about-system">
        <span>
          {t("settings.about.electron")}:{" "}
          {window.navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ??
            t("common.notAvailable")}
        </span>
        <span>
          {t("settings.about.platform")}:{" "}
          {window.navigator.platform || t("common.notAvailable")}
        </span>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  activeSection?: string;
  onSectionChange?: (section: SettingsSection) => void;
}

const settingsSectionIds = new Set<string>(NAV_ITEMS.map((item) => item.key));

function canonicalSettingsSection(section?: string): SettingsSection | null {
  if (!section) return null;
  if (settingsSectionIds.has(section)) return section as SettingsSection;
  if (section === "serverDefaults" || section === "backupDefaults") {
    return "defaults";
  }
  if (section === "providers") return "marketplace";
  if (section === "logging" || section === "paths" || section === "data") {
    return "storage";
  }
  return null;
}

export function SettingsView({
  activeSection: controlledSection,
  onSectionChange,
}: SettingsViewProps) {
  const { t } = useAppSettings();
  const [uncontrolledSection, setUncontrolledSection] =
    useState<SettingsSection>("general");
  const activeSection =
    canonicalSettingsSection(controlledSection) ?? uncontrolledSection;
  const setActiveSection = (section: SettingsSection) => {
    if (onSectionChange) {
      onSectionChange(section);
      return;
    }
    setUncontrolledSection(section);
  };
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const saveSequence = useRef(0);
  const queryClient = useQueryClient();
  const navRef = useRef<HTMLElement>(null);
  const preferencesQuery = useQuery({
    queryKey: settingsKeys.preferences,
    queryFn: async () => {
      const preferences = await getAppPreferences();
      if (!preferences || typeof preferences !== "object") {
        throw new Error(t("settings.error.invalidPreferences"));
      }
      return preferences;
    },
  });
  const preferences = preferencesQuery.data;
  const visibleError =
    settingsError ??
    (preferencesQuery.error ? errorMessage(preferencesQuery.error) : null);

  useEffect(() => {
    const activeItem = navRef.current?.querySelector<HTMLElement>(
      `[data-settings-section="${activeSection}"]`,
    );
    activeItem?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeSection]);

  const updatePreferences = async (patch: Partial<AppPreferences>) => {
    const sequence = ++saveSequence.current;
    setSaveState("saving");
    try {
      const nextPreferences = await saveAppPreferences(patch);
      queryClient.setQueryData(settingsKeys.preferences, nextPreferences);
      setSettingsError(null);
      if (saveSequence.current === sequence) {
        setSaveState("saved");
        window.setTimeout(() => {
          if (saveSequence.current === sequence) setSaveState("idle");
        }, 1_800);
      }
    } catch (error) {
      if (saveSequence.current === sequence) setSaveState("idle");
      throw error;
    }
  };

  const replacePreferences = (nextPreferences: AppPreferences) => {
    queryClient.setQueryData(settingsKeys.preferences, nextPreferences);
    setSettingsError(null);
  };

  return (
    <section aria-labelledby="settings-title" className="settings-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">{t("settings.page.eyebrow")}</p>
          <h1 id="settings-title" tabIndex={-1}>
            {t("settings.page.title")}
          </h1>
        </div>
        <span className="settings-save-state" aria-live="polite">
          {saveState === "saving"
            ? t("settings.save.saving")
            : saveState === "saved"
              ? t("settings.save.saved")
              : ""}
        </span>
      </div>
      <div className="settings-layout">
        <div className="settings-nav-shell">
          <nav
            ref={navRef}
            className="settings-nav"
            aria-label={t("settings.page.title")}
            onKeyDown={(event) => {
              if (
                !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(
                  event.key,
                )
              )
                return;
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ".settings-nav-item",
                ),
              );
              const currentIndex = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (currentIndex < 0) return;
              const direction =
                event.key === "ArrowDown" || event.key === "ArrowRight"
                  ? 1
                  : -1;
              event.preventDefault();
              items[
                (currentIndex + direction + items.length) % items.length
              ]?.focus();
            }}
          >
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
                  data-nav-group-start={item.groupStart ? "true" : undefined}
                  data-settings-section={item.key}
                  onClick={() => setActiveSection(item.key)}
                >
                  <Icon aria-hidden="true" size={14} />
                  {t(item.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="settings-content">
          {visibleError ? (
            <div className="settings-error" role="alert">
              <div>
                <strong>{t("settings.error.title")}</strong>
                <span>{visibleError}</span>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setSettingsError(null);
                  void preferencesQuery.refetch();
                }}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {preferencesQuery.isLoading ? (
            <LoadingState message={t("settings.loading")} />
          ) : null}
          {preferences ? (
            <>
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
              {activeSection === "defaults" ? (
                <div className="settings-section-stack">
                  <ServerDefaultsSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                  <BackupDefaultsSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                </div>
              ) : null}
              {activeSection === "marketplace" ? (
                <div className="settings-section-stack">
                  <MarketplaceSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                  <ProvidersSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                </div>
              ) : null}
              {activeSection === "notifications" ? (
                <NotificationSettings />
              ) : null}
              {activeSection === "storage" ? (
                <div className="settings-section-stack">
                  <PathsSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                  <LoggingSection
                    preferences={preferences}
                    onUpdate={updatePreferences}
                    onError={setSettingsError}
                  />
                  <DataManagementSection
                    onReplace={replacePreferences}
                    onError={setSettingsError}
                  />
                </div>
              ) : null}
              {activeSection === "updates" ? <UpdateStatus /> : null}
              {activeSection === "about" ? <AboutSection /> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

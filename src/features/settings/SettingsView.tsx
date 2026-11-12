import { Fragment, useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Divider,
  Flex,
  Group,
  NavLink,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
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
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { SettingRow, SettingSection } from "../../components/ui/setting-row";
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
    <SettingSection title={t("settings.nav.general")}>
      <SettingRow
        label={t("settings.general.launchAtLogin")}
        description={t("settings.general.launchAtLoginNote")}
      >
        <Switch
          checked={preferences.launchAtLogin}
          aria-label={t("settings.general.launchAtLogin")}
          onChange={(event) => {
            void onUpdate({
              launchAtLogin: event.currentTarget.checked,
            }).catch((error: unknown) => onError(errorMessage(error)));
          }}
        />
      </SettingRow>
      <SettingRow label={t("settings.general.closeBehavior")}>
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
      </SettingRow>
    </SettingSection>
  );
}

function PathText({ children }: { children: string }) {
  return (
    <Text span inherit ff="monospace">
      {children}
    </Text>
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
    <TextInput
      aria-label={ariaLabel}
      w={110}
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
    <Stack gap="md">
      <ThemeSettings />
      <LocalizationSettings />
      <SettingSection title={t("settings.appearance.behavior")}>
        <SettingRow label={t("settings.appearance.compactMode")}>
          <Switch
            checked={appearance.compactMode}
            aria-label={t("settings.appearance.compactMode")}
            onChange={(event) =>
              void onUpdate({
                appearance: {
                  ...appearance,
                  compactMode: event.currentTarget.checked,
                },
              }).catch((error: unknown) => onError(errorMessage(error)))
            }
          />
        </SettingRow>
        <SettingRow label={t("settings.appearance.motion")}>
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
        </SettingRow>
        <SettingRow label={t("settings.appearance.fontSize")}>
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
        </SettingRow>
      </SettingSection>
    </Stack>
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
    <SettingSection
      title={t("settings.logging.title")}
      description={t("settings.logging.description")}
    >
      <SettingRow label={t("settings.logging.level")}>
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
      </SettingRow>
      <SettingRow label={t("settings.logging.retentionDays")}>
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
      </SettingRow>
      <SettingRow label={t("settings.logging.maxSizeMb")}>
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
      </SettingRow>
      <SettingRow
        label={t("settings.logging.logsFolder")}
        description={
          diagnosticsExported ? t("settings.logging.exported") : undefined
        }
      >
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
      </SettingRow>
    </SettingSection>
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
    <SettingSection
      title={t("settings.serverDefaults.title")}
      description={t("settings.serverDefaults.description")}
    >
      <SettingRow
        label={t("settings.paths.serverDefault")}
        description={<PathText>{preferences.defaultServerDir}</PathText>}
      >
        <Button variant="secondary" onClick={() => void pickServerFolder()}>
          {t("profileSettings.browse")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.serverDefaults.javaStrategy")}>
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
      </SettingRow>
      <SettingRow
        label={t("settings.serverDefaults.memoryRange")}
        description={t("settings.serverDefaults.memoryRangeNote")}
      >
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
      </SettingRow>
    </SettingSection>
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
    <SettingSection
      title={t("settings.backupDefaults.title")}
      description={t("settings.backupDefaults.description")}
    >
      <SettingRow
        label={t("settings.paths.backupDefault")}
        description={<PathText>{preferences.defaultBackupDir}</PathText>}
      >
        <Button variant="secondary" onClick={() => void pickBackupFolder()}>
          {t("profileSettings.browse")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.backupDefaults.compression")}>
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
      </SettingRow>
      <SettingRow label={t("settings.backupDefaults.frequency")}>
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
      </SettingRow>
      <SettingRow label={t("settings.backupDefaults.retentionDays")}>
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
      </SettingRow>
    </SettingSection>
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
    <SettingSection
      title={t("settings.marketplace.title")}
      description={t("settings.marketplace.description")}
    >
      <SettingRow label={t("settings.marketplace.defaultProvider")}>
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
      </SettingRow>
      <SettingRow label={t("settings.marketplace.showIncompatible")}>
        <Switch
          checked={marketplace.showIncompatible}
          aria-label={t("settings.marketplace.showIncompatible")}
          onChange={({ currentTarget: { checked } }) =>
            void onUpdate({
              marketplace: { ...marketplace, showIncompatible: checked },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </SettingRow>
      <SettingRow label={t("settings.marketplace.autoInstallDependencies")}>
        <Switch
          checked={marketplace.autoInstallDependencies}
          aria-label={t("settings.marketplace.autoInstallDependencies")}
          onChange={({ currentTarget: { checked } }) =>
            void onUpdate({
              marketplace: { ...marketplace, autoInstallDependencies: checked },
            }).catch((error: unknown) => onError(errorMessage(error)))
          }
        />
      </SettingRow>
      <SettingRow
        label={t("settings.marketplace.cacheSizeMb")}
        description={
          cacheCleared ? t("settings.paths.cacheCleared") : undefined
        }
      >
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
      </SettingRow>
    </SettingSection>
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
    <SettingSection title={t("settings.providers.title")}>
      <SettingRow label={t("settings.providers.modrinth")}>
        <Badge variant="light">{t("settings.providers.alwaysEnabled")}</Badge>
      </SettingRow>
      <SettingRow label={t("settings.providers.hangar")}>
        <Switch
          checked={providers.hangar}
          aria-label={t("settings.providers.hangar")}
          onChange={(event) =>
            void updateProvider("hangar", event.currentTarget.checked)
          }
        />
      </SettingRow>
      <SettingRow label={t("settings.providers.bbsmc")}>
        <Switch
          checked={providers.bbsmc}
          aria-label={t("settings.providers.bbsmc")}
          onChange={(event) =>
            void updateProvider("bbsmc", event.currentTarget.checked)
          }
        />
      </SettingRow>
      <SettingRow
        label={t("settings.providers.curseforge")}
        description={t("settings.providers.manualImportOnly")}
      />
    </SettingSection>
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
    <SettingSection title={t("settings.nav.paths")}>
      <SettingRow
        label={t("settings.paths.appData")}
        description={<PathText>{preferences.appDataDir}</PathText>}
      />
      <SettingRow
        label={t("settings.paths.serverDefault")}
        description={<PathText>{preferences.defaultServerDir}</PathText>}
      >
        <Button
          variant="secondary"
          onClick={() => void pickFolder("defaultServerDir")}
        >
          {t("profileSettings.browse")}
        </Button>
      </SettingRow>
      <SettingRow
        label={t("settings.paths.backupDefault")}
        description={<PathText>{preferences.defaultBackupDir}</PathText>}
      >
        <Button
          variant="secondary"
          onClick={() => void pickFolder("defaultBackupDir")}
        >
          {t("profileSettings.browse")}
        </Button>
      </SettingRow>
      <SettingRow
        label={t("settings.paths.cache")}
        description={
          <>
            <PathText>{preferences.cacheDir}</PathText>
            {cacheCleared ? (
              <Text span inherit display="block">
                {t("settings.paths.cacheCleared")}
              </Text>
            ) : null}
          </>
        }
      >
        <Button variant="secondary" onClick={() => void clearCache()}>
          {t("settings.paths.clearCache")}
        </Button>
      </SettingRow>
    </SettingSection>
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
    <SettingSection
      title={t("settings.data.title")}
      description={t("settings.data.description")}
    >
      <SettingRow
        label={t("settings.data.settingsFile")}
        description={status ?? undefined}
      >
        <Button variant="secondary" onClick={() => void exportSettings()}>
          {t("settings.data.export")}
        </Button>
        <Button variant="secondary" onClick={() => void importSettings()}>
          {t("settings.data.import")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.paths.appData")}>
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
      </SettingRow>
      <SettingRow
        label={t("settings.data.reset")}
        description={t("settings.data.resetNote")}
      >
        <Button variant="danger" onClick={() => setResetOpen(true)}>
          {t("settings.data.reset")}
        </Button>
      </SettingRow>
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
    </SettingSection>
  );
}

function AboutSection() {
  const { t } = useAppSettings();

  return (
    <SettingSection title={t("settings.about.title")}>
      <SettingRow label={t("settings.about.version")}>
        <Text size="sm" ff="monospace">
          {__APP_VERSION__}
        </Text>
      </SettingRow>
      <SettingRow label={t("settings.about.license")} />
      <SettingRow label={t("settings.about.noTelemetry")} />
      <SettingRow label={t("settings.about.github")}>
        <Anchor
          href="https://github.com/NAinfini/MCServerManager"
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
        >
          <Group gap={4} component="span">
            <ExternalLink aria-hidden="true" size={14} />
            GitHub
          </Group>
        </Anchor>
      </SettingRow>
      <SettingRow
        label={t("settings.about.disclaimerTitle")}
        description={t("settings.about.disclaimer")}
      />
      <SettingRow
        label={t("settings.about.system")}
        description={
          <Stack gap={2} component="span" ff="monospace">
            <span>
              {t("settings.about.electron")}:{" "}
              {window.navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ??
                t("common.notAvailable")}
            </span>
            <span>
              {t("settings.about.platform")}:{" "}
              {window.navigator.platform || t("common.notAvailable")}
            </span>
          </Stack>
        }
      />
    </SettingSection>
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
  const navRef = useRef<HTMLDivElement>(null);
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
    <Stack component="section" aria-labelledby="settings-title" gap="md">
      <Group justify="space-between" align="center">
        <Title order={1} id="settings-title" tabIndex={-1}>
          {t("settings.page.title")}
        </Title>
        <Text size="sm" c="dimmed" aria-live="polite">
          {saveState === "saving"
            ? t("settings.save.saving")
            : saveState === "saved"
              ? t("settings.save.saved")
              : ""}
        </Text>
      </Group>
      <Flex gap="lg" align="flex-start">
        <Stack
          component="nav"
          ref={navRef}
          aria-label={t("settings.page.title")}
          gap={2}
          w={200}
          pos="sticky"
          top={0}
          style={{ flexShrink: 0 }}
          onKeyDown={(event) => {
            if (
              !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(
                event.key,
              )
            )
              return;
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[data-settings-section]",
              ),
            );
            const currentIndex = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (currentIndex < 0) return;
            const direction =
              event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
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
              <Fragment key={item.key}>
                {item.groupStart ? <Divider my={6} /> : null}
                <NavLink
                  component="button"
                  type="button"
                  active={isActive}
                  aria-current={isActive ? "true" : undefined}
                  data-nav-group-start={item.groupStart ? "true" : undefined}
                  data-settings-section={item.key}
                  label={t(item.labelKey)}
                  leftSection={<Icon aria-hidden="true" size={16} />}
                  onClick={() => setActiveSection(item.key)}
                />
              </Fragment>
            );
          })}
        </Stack>
        <Stack gap="md" miw={0} maw={820} style={{ flex: 1 }}>
          {visibleError ? (
            <Alert color="red" role="alert" title={t("settings.error.title")}>
              <Group justify="space-between" gap="sm">
                <Text size="sm">{visibleError}</Text>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSettingsError(null);
                    void preferencesQuery.refetch();
                  }}
                >
                  {t("common.retry")}
                </Button>
              </Group>
            </Alert>
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
                <Stack gap="md">
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
                </Stack>
              ) : null}
              {activeSection === "marketplace" ? (
                <Stack gap="md">
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
                </Stack>
              ) : null}
              {activeSection === "notifications" ? (
                <NotificationSettings />
              ) : null}
              {activeSection === "storage" ? (
                <Stack gap="md">
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
                </Stack>
              ) : null}
              {activeSection === "updates" ? <UpdateStatus /> : null}
              {activeSection === "about" ? <AboutSection /> : null}
            </>
          ) : null}
        </Stack>
      </Flex>
    </Stack>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Cpu,
  FileArchive,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Info,
  Package,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Upload,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import {
  invokeDesktopCommand,
  isDesktopRuntimeAvailable,
} from "../../lib/desktop-runtime";
import { useAppSettings } from "../../i18n";
import { errorMessage } from "../../lib/error-message";
import {
  getDefaultServerRoot,
  listLoaderMinecraftVersions,
  listLoaderVersions,
  suggestServerPort,
  type LoaderVersionOption,
} from "./api";
import {
  CreateServerMarketplaceBrowser,
  type MarketplaceCreateSelection,
} from "./CreateServerMarketplaceBrowser";
import { ProvisioningProgress } from "./ProvisioningProgress";
import {
  cancelProvisioningJob,
  createProvisioningJob,
  getProvisioningJob,
  installJavaRuntime,
  listRecoverableProvisioningJobs,
  planJavaRuntime,
  planServerProvisioning,
  retryProvisioningJob,
  runProvisioningJob,
  type FinalProvisioningPlan,
  type JavaRuntimePlan,
  type ProvisioningJob,
  type SourceProvisioningPlan,
} from "./provisioningApi";
import type {
  GuidedServerConfiguration,
  LoaderType,
  ValidatedJavaRuntime,
} from "./types";
import { serverKeys } from "./queries";
import { createWorldBackup } from "../backups/backupApi";
import { startServer } from "../process/api";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;
type SourceView = "choices" | "blank" | "marketplace";
type ServerIntent = "vanilla" | "plugins" | "mods" | "advanced";
export type CreateServerWizardLifecycle = "draft" | "running" | "complete";

export interface CreateServerWizardProgress {
  steps: Array<{ label: string; description?: string }>;
  currentStep: number;
}

export type CreateServerCompletionAction =
  "overview" | "invite" | "content" | "backup";

interface CreateServerWizardProps {
  onCreated?: () => void;
  onLifecycleChange?: (lifecycle: CreateServerWizardLifecycle) => void;
  onHeaderBackChange?: (handler: (() => void) | null) => void;
  onHeaderHiddenChange?: (hidden: boolean) => void;
  onProgressChange?: (progress: CreateServerWizardProgress | null) => void;
  onRouteStateChange?: (state: {
    step: WizardStep;
    jobId?: string | null;
  }) => void;
  onCompletionAction?: (
    serverId: string,
    action: CreateServerCompletionAction,
  ) => void;
  showHeading?: boolean;
  initialSourcePath?: string | null;
  initialStep?: number;
  initialJobId?: string | null;
}

const loaders: LoaderType[] = [
  "vanilla",
  "paper",
  "forge",
  "neoForge",
  "fabric",
  "quilt",
];

/* Mirrors MAX_SERVER_NAME_LENGTH in electron/backend.cjs, which rejects longer
   names rather than letting them reach mkdir. Capping the input means the user
   is stopped while typing instead of at the end of a six-step wizard. */
const MAX_SERVER_NAME_LENGTH = 100;

const initialConfiguration: GuidedServerConfiguration = {
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  gameMode: "survival",
  difficulty: "normal",
  maxPlayers: 20,
  motd: "A Minecraft Server",
  onlineMode: true,
  pvp: true,
  whiteList: false,
  viewDistance: 10,
  simulationDistance: 10,
};

async function pick(kind: "file" | "folder") {
  const result = await invokeDesktopCommand<{ path: string | null }>(
    "show_open_dialog",
    kind === "folder"
      ? { kind: "folder" }
      : {
          kind: "file",
          filters: [
            {
              name: "Server pack or archive",
              extensions: ["zip", "mrpack", "jar"],
            },
          ],
        },
  );
  return result?.path || null;
}

export function CreateServerWizard({
  onCreated,
  onLifecycleChange,
  onHeaderBackChange,
  onHeaderHiddenChange,
  onProgressChange,
  onRouteStateChange,
  onCompletionAction,
  showHeading = true,
  initialSourcePath = null,
  initialJobId = null,
}: CreateServerWizardProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(0);
  const [sourceView, setSourceView] = useState<SourceView>("choices");
  const [sourcePlan, setSourcePlan] = useState<SourceProvisioningPlan | null>(
    null,
  );
  const [name, setName] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [loaderType, setLoaderType] = useState<LoaderType>("paper");
  const [serverIntent, setServerIntent] = useState<ServerIntent | null>(null);
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  /* Kept as the full options rather than bare strings so the newest stable
     release can be preselected and marked: the list runs back to 1.0 and a
     beginner has no basis for picking one out of a hundred. */
  const [minecraftOptions, setMinecraftOptions] = useState<
    LoaderVersionOption[]
  >([]);
  const [loaderOptions, setLoaderOptions] = useState<LoaderVersionOption[]>([]);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>(
    [],
  );
  const [javaPlan, setJavaPlan] = useState<JavaRuntimePlan | null>(null);
  const [javaRuntime, setJavaRuntime] = useState<ValidatedJavaRuntime | null>(
    null,
  );
  const [javaConsent, setJavaConsent] = useState(false);
  const [configuration, setConfiguration] =
    useState<GuidedServerConfiguration>(initialConfiguration);
  const [restartEnabled, setRestartEnabled] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [job, setJob] = useState<ProvisioningJob | null>(null);
  const [isRecoveredJob, setIsRecoveredJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Bumping this reruns the version lookups; the flag is what turns the error
     into something the user can act on rather than a dead end. */
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [metadataFailed, setMetadataFailed] = useState(false);
  /* Ports already claimed by another profile. Two servers may legitimately
     share one as long as they never run together, so this warns rather than
     blocks; what it prevents is silently proposing a colliding default. */
  const [takenPorts, setTakenPorts] = useState<number[]>([]);
  /* Both lists arrive newest first, so the first stable entry is the one worth
     marking. -1 when a list holds no stable release, which marks nothing. */
  const recommendedMinecraftIndex = minecraftOptions.findIndex(
    (option) => option.stable,
  );
  const recommendedLoaderIndex = loaderOptions.findIndex(
    (option) => option.stable,
  );
  const plannedInitialPath = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const recoveredJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);
  const lifecycle = useRef<CreateServerWizardLifecycle>("draft");
  const lifecycleCallback = useRef(onLifecycleChange);

  useEffect(() => {
    lifecycleCallback.current = onLifecycleChange;
    onLifecycleChange?.(lifecycle.current);
  }, [onLifecycleChange]);

  const publishLifecycle = useCallback((next: CreateServerWizardLifecycle) => {
    lifecycle.current = next;
    lifecycleCallback.current?.(next);
  }, []);

  /* The source step spans three full screens, so the counter alone sat at
     "Step 1 of 6" while the user made three decisions and read as no progress
     at all. Naming the current screen is what makes the movement visible. */
  const sourceStepDetail =
    sourceView === "marketplace"
      ? t("provisioning.wizard.step.sourceMarketplace")
      : sourceView === "blank"
        ? serverIntent === null
          ? t("provisioning.wizard.step.sourceIntent")
          : t("provisioning.wizard.step.sourceVersions")
        : t("provisioning.wizard.step.sourceChoice");

  const steps = useMemo(
    () => [
      {
        label: t("provisioning.wizard.step.source"),
        description: sourceStepDetail,
      },
      { label: t("provisioning.wizard.step.compatibility") },
      { label: t("provisioning.wizard.step.java") },
      { label: t("provisioning.wizard.step.configuration") },
      { label: t("provisioning.wizard.step.review") },
      { label: t("provisioning.wizard.step.install") },
    ],
    [sourceStepDetail, t],
  );

  useEffect(() => {
    onProgressChange?.({ steps, currentStep: step });
  }, [onProgressChange, step, steps]);

  useEffect(() => {
    onRouteStateChange?.({
      step,
      ...(step === 5 && job?.id ? { jobId: job.id } : {}),
    });
  }, [job?.id, onRouteStateChange, step]);

  useEffect(
    () => () => {
      onProgressChange?.(null);
    },
    [onProgressChange],
  );

  useEffect(() => {
    if (!isDesktopRuntimeAvailable()) return;
    let active = true;
    const loadJob = initialJobId
      ? getProvisioningJob(initialJobId).then((saved) =>
          saved ? [saved] : listRecoverableProvisioningJobs(),
        )
      : listRecoverableProvisioningJobs();
    loadJob
      .then((jobs) => {
        const recovered = jobs[0];
        if (active && recovered && recoveredJobIdRef.current !== recovered.id) {
          recoveredJobIdRef.current = recovered.id;
          setJob(recovered);
          setIsRecoveredJob(true);
          setStep(5);
          publishLifecycle(
            recovered.stage === "ready" ? "complete" : "running",
          );
        }
      })
      .catch((caught) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [initialJobId, publishLifecycle]);

  useEffect(() => {
    onHeaderHiddenChange?.(false);
    return () => onHeaderHiddenChange?.(false);
  }, [onHeaderHiddenChange]);

  useEffect(() => {
    if (!onHeaderBackChange) return;
    onHeaderBackChange(
      sourceView === "marketplace" ? () => setSourceView("choices") : null,
    );
    return () => onHeaderBackChange(null);
  }, [onHeaderBackChange, sourceView]);

  const needsRuntimeMetadata = Boolean(sourcePlan && !sourcePlan.launchSpec);
  const needsBlankMetadata = sourceView === "blank" && serverIntent !== null;

  useEffect(() => {
    let active = true;
    suggestServerPort()
      .then((suggestion) => {
        if (!active) return;
        setTakenPorts(suggestion.taken);
        setConfiguration((current) => ({
          ...current,
          serverPort: suggestion.port,
        }));
      })
      .catch((caught) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!needsBlankMetadata && !needsRuntimeMetadata) return;
    let active = true;
    listLoaderMinecraftVersions(loaderType)
      .then((options) => {
        if (!active) return;
        setMinecraftOptions(options);
        /* The list arrives newest first, so the first stable entry is the
           latest release. Preselecting it means the common case needs no
           decision at all instead of a choice out of a hundred versions. */
        const recommended = options.find((item) => item.stable);
        if (recommended) {
          setMinecraftVersion((current) => current || recommended.value);
        }
        setMetadataFailed(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(errorMessage(caught));
        /* Without this the version lists stay empty with no way forward: the
           lookup only reruns when the loader changes, which the user has no
           reason to do after a dropped connection. */
        setMetadataFailed(true);
      });
    return () => {
      active = false;
    };
  }, [loaderType, needsBlankMetadata, needsRuntimeMetadata, metadataAttempt]);

  useEffect(() => {
    if ((!needsBlankMetadata && !needsRuntimeMetadata) || !minecraftVersion)
      return;
    let active = true;
    listLoaderVersions(loaderType, minecraftVersion)
      .then((options) => {
        if (!active) return;
        const values = options.map((item) => item.value);
        setLoaderOptions(options);
        /* A loader version selected for a different loader/Minecraft pair has
           no matching <option>, so the select renders blank while the stale
           value is still submitted. Drop it instead of shipping a mismatch. */
        setLoaderVersion((current) =>
          current && !values.includes(current) ? "" : current,
        );
        const recommended = options.find((item) => item.stable);
        if (recommended) {
          setLoaderVersion((current) => current || recommended.value);
        }
        setMetadataFailed(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(errorMessage(caught));
        setMetadataFailed(true);
      });
    return () => {
      active = false;
    };
  }, [
    loaderType,
    minecraftVersion,
    needsBlankMetadata,
    needsRuntimeMetadata,
    metadataAttempt,
  ]);

  useEffect(() => {
    if (step !== 2 || !sourcePlan || javaRuntime || javaPlan) return;
    let active = true;
    setBusy(true);
    planJavaRuntime(sourcePlan.requiredJavaMajor || 21)
      .then((plan) => {
        if (!active) return;
        setJavaPlan(plan);
        if (plan.action === "reuse" && plan.runtime) {
          setJavaRuntime({ ...plan.runtime, validated: true });
        }
      })
      .catch((caught) => active && setError(errorMessage(caught)))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, [javaPlan, javaRuntime, sourcePlan, step]);

  const applyPlan = useCallback(
    async (plan: SourceProvisioningPlan, existingRoot?: string) => {
      setSourcePlan(plan);
      setAcknowledgedWarnings([]);
      setEulaAccepted(false);
      setJavaPlan(null);
      setJavaRuntime(null);
      setJavaConsent(false);
      const nextName = plan.pack?.name || name || "Minecraft Server";
      setName(nextName);
      if (plan.loaderType) setLoaderType(plan.loaderType);
      if (plan.minecraftVersion) setMinecraftVersion(plan.minecraftVersion);
      if (plan.loaderVersion) setLoaderVersion(plan.loaderVersion);
      setRootDir(existingRoot || (await getDefaultServerRoot(nextName)));
      setSourceView("choices");
      setStep(1);
    },
    [name],
  );

  const planSource = useCallback(
    async (
      input: Parameters<typeof planServerProvisioning>[0],
      existingRoot?: string,
    ) => {
      setError(null);
      setBusy(true);
      try {
        await applyPlan(
          await planServerProvisioning({ ...input, prepareInstall: true }),
          existingRoot,
        );
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [applyPlan],
  );

  const chooseLocalFile = async () => {
    const selected = await pick("file");
    if (selected) {
      await planSource({
        source: { kind: "localModpackFile", path: selected },
      });
    }
  };

  useEffect(() => {
    if (!initialSourcePath || plannedInitialPath.current === initialSourcePath)
      return;
    plannedInitialPath.current = initialSourcePath;
    void planSource({
      source: { kind: "localModpackFile", path: initialSourcePath },
    });
  }, [initialSourcePath, planSource]);

  const chooseExistingFolder = async () => {
    const selected = await pick("folder");
    if (selected) {
      await planSource(
        { source: { kind: "existingFolder" }, rootDir: selected },
        selected,
      );
    }
  };

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length !== 1) {
        setError(t("provisioning.wizard.dropSingle"));
        return;
      }
      const file = files[0] as File & { path?: string };
      await planSource({
        source: { kind: "localModpackFile", path: file.path || file.name },
      });
    },
    [planSource, t],
  );

  const handleMarketplaceSelect = async (
    selection: MarketplaceCreateSelection,
  ) => {
    await planSource({
      source: {
        kind: "marketplaceModpack",
        provider: selection.provider,
        projectId: selection.projectId,
        versionId: selection.versionId,
      },
      loaderType: selection.loaderType || undefined,
      minecraftVersion: selection.minecraftVersion || undefined,
      loaderVersion: selection.loaderVersion || undefined,
    });
  };

  const requiredWarnings =
    sourcePlan?.warnings.filter((warning) => warning.requiresAcknowledgement) ||
    [];
  const compatibilityReady =
    requiredWarnings.every((warning) =>
      acknowledgedWarnings.includes(warning.code),
    ) && Boolean(sourcePlan?.launchSpec);

  const prepareUnverifiedRuntime = async () => {
    if (!sourcePlan || !minecraftVersion) return;
    await planSource(
      {
        source: sourcePlan.source,
        name,
        rootDir:
          sourcePlan.source.kind === "existingFolder" ? rootDir : undefined,
        loaderType,
        minecraftVersion,
        loaderVersion: loaderVersion || undefined,
      },
      sourcePlan.source.kind === "existingFolder" ? rootDir : undefined,
    );
  };

  const installManagedJava = async () => {
    if (!javaPlan) return;
    setBusy(true);
    setError(null);
    try {
      const runtime = await installJavaRuntime(javaPlan, javaConsent);
      setJavaRuntime({ ...runtime, validated: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const setNumber = (key: keyof GuidedServerConfiguration, value: string) => {
    setConfiguration((current) => ({ ...current, [key]: Number(value) }));
  };

  const configurationReady =
    name.trim().length > 0 &&
    rootDir.trim().length > 0 &&
    configuration.serverPort >= 1 &&
    configuration.serverPort <= 65535 &&
    configuration.minMemoryMb >= 256 &&
    configuration.maxMemoryMb >= configuration.minMemoryMb;

  const executeJob = async (created: ProvisioningJob) => {
    setJob(created);
    setIsRecoveredJob(false);
    setStep(5);
    publishLifecycle("running");
    pollIntervalRef.current = window.setInterval(() => {
      getProvisioningJob(created.id)
        .then((current) => {
          if (current && isMountedRef.current) {
            setJob(current);
          }
        })
        .catch(() => undefined);
    }, 500);
    try {
      const completed = await runProvisioningJob(created.id);
      if (!isMountedRef.current) {
        return;
      }
      setJob(completed);
      if (completed.stage === "ready") {
        publishLifecycle("complete");
        await queryClient.invalidateQueries({ queryKey: serverKeys.profiles });
        onCreated?.();
      }
    } catch (caught) {
      if (!isMountedRef.current) {
        return;
      }
      setError(errorMessage(caught));
      try {
        setJob(await getProvisioningJob(created.id));
      } catch {
        // The command error remains visible if the persisted job cannot be reloaded.
      }
    } finally {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  };

  const installServer = async () => {
    if (!sourcePlan || !javaRuntime || !sourcePlan.launchSpec || !eulaAccepted)
      return;
    setBusy(true);
    setError(null);
    const finalPlan: FinalProvisioningPlan = {
      ...sourcePlan,
      targetDir: rootDir,
      profile: {
        name,
        loaderType,
        minecraftVersion,
        loaderVersion: loaderVersion || null,
        autoStart,
        restartPolicy: {
          enabled: restartEnabled,
          maxAttempts: 3,
          cooldownSeconds: 30,
        },
      },
      configuration,
      compatibilityWarnings: sourcePlan.warnings,
      acknowledgedWarningCodes: acknowledgedWarnings,
      eula: {
        accepted: true,
        termsUrl: "https://aka.ms/MinecraftEULA",
        acceptedAt: new Date().toISOString(),
      },
      javaRuntime,
      launchSpec: { ...sourcePlan.launchSpec, validated: true },
    };
    try {
      await executeJob(await createProvisioningJob(finalPlan));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const retryJob = async (jobId: string) => {
    setBusy(true);
    publishLifecycle("running");
    try {
      const completed = await retryProvisioningJob(jobId);
      setJob(completed);
      if (completed.stage === "ready") {
        publishLifecycle("complete");
        onCreated?.();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    setBusy(true);
    try {
      setJob(await cancelProvisioningJob(jobId));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (step === 0) return;
    if (step === 5 && job && job.stage !== "ready") return;
    setError(null);
    setStep((step - 1) as WizardStep);
  };

  const goToStep = (next: WizardStep) => {
    setError(null);
    setStep(next);
  };

  const startFreshDraft = () => {
    setJob(null);
    recoveredJobIdRef.current = null;
    setIsRecoveredJob(false);
    setError(null);
    setStep(0);
    setSourceView("choices");
    setServerIntent(null);
    publishLifecycle("draft");
  };

  const runCompletionAction = async (action: CreateServerCompletionAction) => {
    const serverId = job?.serverId;
    if (!serverId) return;
    setError(null);
    setBusy(true);
    try {
      if (action === "overview") {
        await startServer(serverId);
      }
      if (action === "backup") {
        await createWorldBackup({ serverId });
      }
      onCompletionAction?.(serverId, action);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const chooseServerIntent = (intent: ServerIntent) => {
    const recommendedLoader: Partial<Record<ServerIntent, LoaderType>> = {
      vanilla: "vanilla",
      plugins: "paper",
      mods: "fabric",
    };
    setServerIntent(intent);
    setLoaderType(recommendedLoader[intent] ?? "paper");
    setMinecraftVersion("");
    setLoaderVersion("");
  };

  return (
    <section
      aria-label={t("createServer.title")}
      className="create-server-panel"
    >
      {showHeading ? <h2>{t("createServer.title")}</h2> : null}

      <div className="wizard-step-content unified-provisioning-wizard">
        {step === 0 && sourceView === "choices" ? (
          <div className="wizard-pick-view">
            <button
              aria-label={t("provisioning.wizard.drop")}
              className="wizard-dropzone"
              data-testid="server-pack-drop-zone"
              disabled={busy}
              type="button"
              onClick={chooseLocalFile}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload aria-hidden="true" size={20} />
              <span className="wizard-dropzone-title">
                {t("provisioning.wizard.dropTitle")}
              </span>
              <span className="wizard-dropzone-hint">
                {t("provisioning.wizard.dropHint")}
              </span>
            </button>
            <p className="wizard-source-question">
              {t("provisioning.wizard.sourceQuestion")}
            </p>
            <div className="wizard-actions">
              {[
                {
                  key: "blank",
                  icon: Server,
                  label: t("createServer.newBlank"),
                  description: t("createServer.newBlank.description"),
                  onClick: () => {
                    setServerIntent(null);
                    setSourceView("blank");
                  },
                },
                {
                  key: "folder",
                  icon: FolderOpen,
                  label: t("createServer.importFolder"),
                  description: t("createServer.importFolder.description"),
                  onClick: chooseExistingFolder,
                },
                {
                  key: "marketplace",
                  icon: Package,
                  label: t("createServer.browseMarketplace"),
                  description: t("createServer.browseMarketplace.description"),
                  onClick: () => setSourceView("marketplace"),
                },
                {
                  key: "file",
                  icon: FileArchive,
                  label: t("createServer.openModpackFile"),
                  description: t("createServer.openModpackFile.description"),
                  onClick: chooseLocalFile,
                },
              ].map((choice) => (
                <button
                  aria-label={choice.label}
                  className="wizard-action"
                  key={choice.key}
                  type="button"
                  onClick={choice.onClick}
                >
                  <choice.icon
                    aria-hidden="true"
                    className="wizard-action-icon"
                    size={18}
                  />
                  <span className="wizard-action-title">{choice.label}</span>
                  <span className="wizard-action-description">
                    {choice.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 0 && sourceView === "marketplace" ? (
          <div className="wizard-marketplace-step">
            <CreateServerMarketplaceBrowser
              onDetailModeChange={onHeaderHiddenChange}
              onSelect={handleMarketplaceSelect}
            />
          </div>
        ) : null}

        {step === 0 && sourceView === "blank" ? (
          serverIntent === null ? (
            <div className="wizard-intent-picker">
              <div className="wizard-intent-heading">
                <h2>{t("createServer.intent.title")}</h2>
                <p>{t("createServer.intent.description")}</p>
              </div>
              <div className="wizard-intent-options">
                {[
                  {
                    key: "vanilla" as const,
                    icon: Gamepad2,
                    label: t("createServer.intent.vanilla"),
                    description: t("createServer.intent.vanilla.description"),
                  },
                  {
                    key: "plugins" as const,
                    icon: Package,
                    label: t("createServer.intent.plugins"),
                    description: t("createServer.intent.plugins.description"),
                    badge: t("createServer.intent.recommended"),
                  },
                  {
                    key: "mods" as const,
                    icon: Cpu,
                    label: t("createServer.intent.mods"),
                    description: t("createServer.intent.mods.description"),
                  },
                  {
                    key: "advanced" as const,
                    icon: ShieldCheck,
                    label: t("createServer.intent.advanced"),
                    description: t("createServer.intent.advanced.description"),
                  },
                ].map((intent) => (
                  <button
                    aria-label={intent.label}
                    className="wizard-intent-option"
                    key={intent.key}
                    type="button"
                    onClick={() => chooseServerIntent(intent.key)}
                  >
                    <intent.icon aria-hidden="true" size={19} />
                    <span className="wizard-intent-title">
                      <strong>{intent.label}</strong>
                      {intent.badge ? <em>{intent.badge}</em> : null}
                    </span>
                    <span>{intent.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="provisioning-source-shell">
              <div className="wizard-intent-summary">
                <div>
                  <span>{t("createServer.intent.selected")}</span>
                  <strong>{t(`createServer.intent.${serverIntent}`)}</strong>
                </div>
                <Button variant="ghost" onClick={() => setServerIntent(null)}>
                  {t("createServer.intent.change")}
                </Button>
              </div>
              <div className="form-grid provisioning-source-form">
                <label>
                  <span>{t("profileSettings.name")}</span>
                  <TextField
                    aria-label={t("profileSettings.name")}
                    maxLength={MAX_SERVER_NAME_LENGTH}
                    name="server-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {serverIntent === "advanced" ? (
                  <label>
                    <span>{t("profileSettings.loader")}</span>
                    <select
                      aria-label={t("profileSettings.loader")}
                      className="field-control"
                      name="server-loader"
                      value={loaderType}
                      onChange={(event) => {
                        setLoaderType(event.target.value as LoaderType);
                        setMinecraftVersion("");
                        setLoaderVersion("");
                      }}
                    >
                      {loaders.map((loader) => (
                        <option key={loader} value={loader}>
                          {loader}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  <span>{t("profileSettings.minecraftVersion")}</span>
                  <select
                    aria-label={t("profileSettings.minecraftVersion")}
                    className="field-control"
                    name="minecraft-version"
                    value={minecraftVersion}
                    onChange={(event) => {
                      setMinecraftVersion(event.target.value);
                      setLoaderVersion("");
                    }}
                  >
                    <option value="">{t("provisioning.wizard.select")}</option>
                    {minecraftOptions.map((option, index) => (
                      <option key={option.value} value={option.value}>
                        {index === recommendedMinecraftIndex
                          ? t("provisioning.wizard.recommendedOption", {
                              label: option.label,
                            })
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("profileSettings.loaderVersion")}</span>
                  <select
                    aria-label={t("profileSettings.loaderVersion")}
                    className="field-control"
                    name="loader-version"
                    value={loaderVersion}
                    onChange={(event) => setLoaderVersion(event.target.value)}
                  >
                    <option value="">{t("provisioning.wizard.select")}</option>
                    {loaderOptions.map((option, index) => (
                      <option key={option.value} value={option.value}>
                        {index === recommendedLoaderIndex
                          ? t("provisioning.wizard.recommendedOption", {
                              label: option.label,
                            })
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={
                    busy || !name || !minecraftVersion || !loaderVersion
                  }
                  onClick={() =>
                    planSource({
                      source: { kind: "blank" },
                      name,
                      loaderType,
                      minecraftVersion,
                      loaderVersion,
                    })
                  }
                >
                  {t("provisioning.wizard.analyze")}
                </Button>
              </div>
            </div>
          )
        ) : null}

        {step === 1 && sourcePlan ? (
          <div className="provisioning-compatibility">
            <h3>{t("provisioning.wizard.compatibilityTitle")}</h3>
            {!sourcePlan.launchSpec ? (
              <div className="form-grid provisioning-runtime-metadata">
                <p>{t("provisioning.wizard.runtimeMetadataRequired")}</p>
                <label>
                  <span>{t("profileSettings.loader")}</span>
                  <select
                    aria-label={t("profileSettings.loader")}
                    className="field-control"
                    value={loaderType}
                    onChange={(event) => {
                      setLoaderType(event.target.value as LoaderType);
                      setMinecraftVersion("");
                      setLoaderVersion("");
                    }}
                  >
                    {loaders.map((loader) => (
                      <option key={loader} value={loader}>
                        {loader}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("profileSettings.minecraftVersion")}</span>
                  <select
                    aria-label={t("profileSettings.minecraftVersion")}
                    className="field-control"
                    value={minecraftVersion}
                    onChange={(event) => {
                      setMinecraftVersion(event.target.value);
                      setLoaderVersion("");
                    }}
                  >
                    <option value="">{t("provisioning.wizard.select")}</option>
                    {minecraftOptions.map((option, index) => (
                      <option key={option.value} value={option.value}>
                        {index === recommendedMinecraftIndex
                          ? t("provisioning.wizard.recommendedOption", {
                              label: option.label,
                            })
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("profileSettings.loaderVersion")}</span>
                  <select
                    aria-label={t("profileSettings.loaderVersion")}
                    className="field-control"
                    value={loaderVersion}
                    onChange={(event) => setLoaderVersion(event.target.value)}
                  >
                    <option value="">
                      {t("provisioning.wizard.autoSelectLoader")}
                    </option>
                    {loaderOptions.map((option, index) => (
                      <option key={option.value} value={option.value}>
                        {index === recommendedLoaderIndex
                          ? t("provisioning.wizard.recommendedOption", {
                              label: option.label,
                            })
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={busy || !minecraftVersion}
                  onClick={prepareUnverifiedRuntime}
                >
                  {t("provisioning.wizard.prepareRuntime")}
                </Button>
              </div>
            ) : null}
            <dl className="provisioning-detected">
              <div>
                <dt>{t("profileSettings.loader")}</dt>
                <dd>{sourcePlan.loaderType ?? loaderType}</dd>
              </div>
              <div>
                <dt>{t("profileSettings.minecraftVersion")}</dt>
                <dd>
                  {sourcePlan.minecraftVersion ||
                    minecraftVersion ||
                    t("provisioning.wizard.detectedUnknown")}
                </dd>
              </div>
              <div>
                <dt>{t("profileSettings.loaderVersion")}</dt>
                <dd>
                  {sourcePlan.loaderVersion ||
                    loaderVersion ||
                    t("provisioning.wizard.detectedUnknown")}
                </dd>
              </div>
              <div>
                <dt>{t("provisioning.wizard.detectedJava")}</dt>
                <dd>
                  {sourcePlan.requiredJavaMajor
                    ? `Java ${sourcePlan.requiredJavaMajor}`
                    : t("provisioning.wizard.detectedUnknown")}
                </dd>
              </div>
            </dl>
            {sourcePlan.warnings.length === 0 ? (
              <p className="provisioning-all-clear">
                <ShieldCheck aria-hidden="true" size={16} />
                {t("provisioning.wizard.noWarnings")}
              </p>
            ) : (
              sourcePlan.warnings.map((warning) => (
                <label
                  className="provisioning-warning"
                  data-blocking={
                    warning.requiresAcknowledgement ? "true" : "false"
                  }
                  key={warning.code}
                >
                  <span className="provisioning-warning-message">
                    {warning.requiresAcknowledgement ? (
                      <AlertTriangle aria-hidden="true" size={15} />
                    ) : (
                      <Info aria-hidden="true" size={15} />
                    )}
                    {warning.message}
                  </span>
                  {warning.requiresAcknowledgement ? (
                    <span className="checkbox-row">
                      <input
                        aria-label={t("provisioning.wizard.acceptWarning")}
                        checked={acknowledgedWarnings.includes(warning.code)}
                        type="checkbox"
                        onChange={(event) =>
                          setAcknowledgedWarnings((current) =>
                            event.target.checked
                              ? [...current, warning.code]
                              : current.filter((code) => code !== warning.code),
                          )
                        }
                      />
                      {t("provisioning.wizard.acceptWarning")}
                    </span>
                  ) : null}
                </label>
              ))
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="provisioning-java-step">
            <h3>
              {t("provisioning.wizard.javaTitle", {
                version: sourcePlan?.requiredJavaMajor || 21,
              })}
            </h3>
            {busy && !javaRuntime ? (
              <p className="provisioning-step-hint">
                {t("provisioning.wizard.javaPlanning")}
              </p>
            ) : null}
            {javaRuntime ? (
              <div className="provisioning-java-ready">
                <ShieldCheck aria-hidden="true" size={16} />
                <div>
                  <strong>{t("provisioning.wizard.javaReady")}</strong>
                  <code>{javaRuntime.path}</code>
                </div>
              </div>
            ) : null}
            {javaPlan?.action === "install" && !javaRuntime ? (
              <div className="provisioning-java-install">
                <p>{t("provisioning.wizard.javaDownload")}</p>
                <dl className="provisioning-detected">
                  <div>
                    <dt>{t("provisioning.wizard.javaVendor")}</dt>
                    <dd>{javaPlan.vendor || "-"}</dd>
                  </div>
                  <div>
                    <dt>{t("provisioning.wizard.javaVersion")}</dt>
                    <dd>
                      {javaPlan.version || `Java ${javaPlan.majorVersion}`}
                    </dd>
                  </div>
                </dl>
                {javaPlan.licenseUrl ? (
                  <a
                    className="provisioning-java-license"
                    href={javaPlan.licenseUrl}
                  >
                    {t("provisioning.wizard.javaLicense")}
                  </a>
                ) : null}
                <label className="checkbox-row">
                  <input
                    aria-label={t("provisioning.wizard.javaConsent")}
                    checked={javaConsent}
                    type="checkbox"
                    onChange={(event) => setJavaConsent(event.target.checked)}
                  />
                  {t("provisioning.wizard.javaConsent")}
                </label>
                <Button
                  disabled={!javaConsent || busy}
                  onClick={installManagedJava}
                >
                  {t("provisioning.wizard.installJava", {
                    version: javaPlan.majorVersion,
                  })}
                </Button>
                {/* Both this button and Next start disabled, and nothing else on
                    the step says which action unlocks which. Without this the
                    user reads it as the wizard being broken. */}
                <p className="provisioning-step-hint">
                  {javaConsent
                    ? t("provisioning.wizard.javaInstallHint")
                    : t("provisioning.wizard.javaConsentHint")}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="provisioning-configuration-step">
            <ConfigSection
              icon={Server}
              title={t("provisioning.config.section.identity")}
            >
              <label className="field-span-2">
                <span>{t("profileSettings.name")}</span>
                <TextField
                  aria-label={t("profileSettings.name")}
                  maxLength={MAX_SERVER_NAME_LENGTH}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </ConfigSection>
            <ConfigSection
              icon={Gamepad2}
              title={t("provisioning.config.section.gameplay")}
            >
              <label>
                <span>{t("provisioning.config.difficulty")}</span>
                <select
                  aria-label={t("provisioning.config.difficulty")}
                  className="field-control"
                  value={configuration.difficulty}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      difficulty: event.target.value,
                    }))
                  }
                >
                  <option value="peaceful">
                    {t("provisioning.config.difficulty.peaceful")}
                  </option>
                  <option value="easy">
                    {t("provisioning.config.difficulty.easy")}
                  </option>
                  <option value="normal">
                    {t("provisioning.config.difficulty.normal")}
                  </option>
                  <option value="hard">
                    {t("provisioning.config.difficulty.hard")}
                  </option>
                </select>
              </label>
              <BooleanField
                label={t("provisioning.config.whiteList")}
                checked={configuration.whiteList === true}
                onChange={(checked) =>
                  setConfiguration((current) => ({
                    ...current,
                    whiteList: checked,
                  }))
                }
              />
            </ConfigSection>

            <details className="provisioning-advanced-settings">
              <summary>{t("provisioning.config.advanced")}</summary>
              <p>{t("provisioning.config.advancedDescription")}</p>
              <ConfigSection
                icon={HardDrive}
                title={t("provisioning.config.section.location")}
              >
                <label className="field-span-2">
                  <span>{t("profileSettings.serverFolder")}</span>
                  <TextField
                    aria-label={t("profileSettings.serverFolder")}
                    value={rootDir}
                    onChange={(event) => setRootDir(event.target.value)}
                  />
                </label>
              </ConfigSection>
              <ConfigSection
                icon={Cpu}
                title={t("provisioning.config.section.resources")}
              >
                <NumberField
                  label={t("profileSettings.minMemoryMb")}
                  value={configuration.minMemoryMb}
                  onChange={(value) => setNumber("minMemoryMb", value)}
                />
                <NumberField
                  label={t("profileSettings.maxMemoryMb")}
                  value={configuration.maxMemoryMb}
                  onChange={(value) => setNumber("maxMemoryMb", value)}
                />
                <label className="field-span-2 provisioning-port-field">
                  <NumberField
                    label={t("profileSettings.port")}
                    value={configuration.serverPort}
                    onChange={(value) => setNumber("serverPort", value)}
                  />
                  {takenPorts.includes(configuration.serverPort) ? (
                    <small role="status">
                      {t("provisioning.config.portTaken")}
                    </small>
                  ) : null}
                </label>
                <NumberField
                  label={t("provisioning.config.maxPlayers")}
                  value={configuration.maxPlayers || 20}
                  onChange={(value) => setNumber("maxPlayers", value)}
                />
                <NumberField
                  label={t("provisioning.config.viewDistance")}
                  value={configuration.viewDistance || 10}
                  onChange={(value) => setNumber("viewDistance", value)}
                />
                <NumberField
                  label={t("provisioning.config.simulationDistance")}
                  value={configuration.simulationDistance || 10}
                  onChange={(value) => setNumber("simulationDistance", value)}
                />
              </ConfigSection>
              <ConfigSection
                icon={Gamepad2}
                title={t("provisioning.config.advancedGameplay")}
              >
                <label className="field-span-2">
                  <span>{t("provisioning.config.motd")}</span>
                  <TextField
                    aria-label={t("provisioning.config.motd")}
                    value={configuration.motd}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        motd: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{t("provisioning.config.gameMode")}</span>
                  <select
                    aria-label={t("provisioning.config.gameMode")}
                    className="field-control"
                    value={configuration.gameMode}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        gameMode: event.target.value,
                      }))
                    }
                  >
                    <option value="survival">
                      {t("provisioning.config.gameMode.survival")}
                    </option>
                    <option value="creative">
                      {t("provisioning.config.gameMode.creative")}
                    </option>
                    <option value="adventure">
                      {t("provisioning.config.gameMode.adventure")}
                    </option>
                    <option value="spectator">
                      {t("provisioning.config.gameMode.spectator")}
                    </option>
                  </select>
                </label>
                <BooleanField
                  label={t("provisioning.config.onlineMode")}
                  checked={configuration.onlineMode !== false}
                  onChange={(checked) =>
                    setConfiguration((current) => ({
                      ...current,
                      onlineMode: checked,
                    }))
                  }
                />
                <BooleanField
                  label={t("provisioning.config.pvp")}
                  checked={configuration.pvp !== false}
                  onChange={(checked) =>
                    setConfiguration((current) => ({
                      ...current,
                      pvp: checked,
                    }))
                  }
                />
              </ConfigSection>
              <ConfigSection
                icon={RefreshCw}
                title={t("provisioning.config.section.lifecycle")}
              >
                <BooleanField
                  label={t("provisioning.config.restart")}
                  checked={restartEnabled}
                  onChange={setRestartEnabled}
                />
                <BooleanField
                  label={t("provisioning.config.autoStart")}
                  checked={autoStart}
                  onChange={setAutoStart}
                />
              </ConfigSection>
            </details>
          </div>
        ) : null}
        {step === 3 && !configurationReady ? (
          <p className="provisioning-step-hint" role="status">
            {t("provisioning.wizard.configurationHint")}
          </p>
        ) : null}

        {step === 4 && sourcePlan ? (
          <div className="wizard-review-step">
            <h3>{t("provisioning.wizard.reviewTitle")}</h3>
            <div className="wizard-review-groups">
              <ConfigSection
                icon={Server}
                title={t("provisioning.config.section.identity")}
              >
                <dl className="wizard-review-fields">
                  <div>
                    <dt>{t("profileSettings.name")}</dt>
                    <dd>{name}</dd>
                  </div>
                  <div>
                    <dt>{t("profileSettings.loader")}</dt>
                    <dd>
                      {loaderType} {loaderVersion}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("profileSettings.minecraftVersion")}</dt>
                    <dd>{minecraftVersion}</dd>
                  </div>
                </dl>
              </ConfigSection>
              <ConfigSection
                icon={HardDrive}
                title={t("provisioning.config.section.location")}
              >
                <dl className="wizard-review-fields">
                  <div>
                    <dt>{t("profileSettings.serverFolder")}</dt>
                    <dd>
                      <code>{rootDir}</code>
                    </dd>
                  </div>
                  {javaRuntime ? (
                    <div>
                      <dt>{t("provisioning.wizard.detectedJava")}</dt>
                      <dd>
                        <code>{javaRuntime.path}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </ConfigSection>
              <ConfigSection
                icon={Cpu}
                title={t("provisioning.config.section.resources")}
              >
                <dl className="wizard-review-fields">
                  <div>
                    <dt>{t("profileSettings.maxMemoryMb")}</dt>
                    <dd>{configuration.maxMemoryMb} MB</dd>
                  </div>
                  <div>
                    <dt>{t("profileSettings.port")}</dt>
                    <dd>{configuration.serverPort}</dd>
                  </div>
                  <div>
                    <dt>{t("provisioning.config.maxPlayers")}</dt>
                    <dd>{configuration.maxPlayers || 20}</dd>
                  </div>
                </dl>
              </ConfigSection>
            </div>
            <label className="provisioning-eula checkbox-row">
              <input
                aria-label={t("provisioning.wizard.eulaAccept")}
                checked={eulaAccepted}
                type="checkbox"
                onChange={(event) => setEulaAccepted(event.target.checked)}
              />
              <span>
                {t("provisioning.wizard.eulaAccept")}{" "}
                <a href="https://aka.ms/MinecraftEULA">
                  {t("provisioning.wizard.eulaLink")}
                </a>
              </span>
            </label>
          </div>
        ) : null}

        {step === 5 && job ? (
          <>
            <ProvisioningProgress
              busy={busy}
              job={job}
              onCancel={cancelJob}
              onRetry={retryJob}
            />
            {isRecoveredJob && !busy && job.stage !== "ready" ? (
              <Button variant="ghost" onClick={startFreshDraft}>
                {t("provisioning.wizard.startFresh")}
              </Button>
            ) : null}
            {job.stage === "ready" && job.serverId ? (
              <section
                aria-label={t("provisioning.complete.aria")}
                className="provisioning-complete-actions"
              >
                <div>
                  <h3>{t("provisioning.complete.title")}</h3>
                  <p>{t("provisioning.complete.description")}</p>
                </div>
                <div className="provisioning-complete-action-grid">
                  <Button
                    disabled={busy}
                    onClick={() => void runCompletionAction("overview")}
                  >
                    <Rocket aria-hidden="true" size={15} />
                    {t("provisioning.complete.start")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("invite")}
                  >
                    <UsersRound aria-hidden="true" size={15} />
                    {t("provisioning.complete.invite")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("content")}
                  >
                    <Boxes aria-hidden="true" size={15} />
                    {t("provisioning.complete.content")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("backup")}
                  >
                    <Archive aria-hidden="true" size={15} />
                    {t("provisioning.complete.backup")}
                  </Button>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {/* ProvisioningProgress already reports a failed job, so the wizard-level
            error would repeat the same sentence directly beneath it. */}
        {error && !job?.error ? (
          <div className="form-error" role="alert">
            <span>{error}</span>
            {metadataFailed ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setMetadataFailed(false);
                  setMetadataAttempt((attempt) => attempt + 1);
                }}
              >
                {t("common.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {step === 0 && sourceView === "marketplace" ? null : (
        <div className="wizard-nav-bar">
          {step > 0 && !(step === 5 && job?.stage !== "ready") ? (
            <Button variant="ghost" onClick={goBack}>
              {t("wizard.nav.back")}
            </Button>
          ) : sourceView !== "choices" && step === 0 ? (
            <Button variant="ghost" onClick={() => setSourceView("choices")}>
              {t("wizard.nav.back")}
            </Button>
          ) : null}
          <div className="wizard-nav-spacer" />
          {step === 1 ? (
            <Button disabled={!compatibilityReady} onClick={() => goToStep(2)}>
              {t("wizard.nav.next")}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button disabled={!javaRuntime || busy} onClick={() => goToStep(3)}>
              {t("wizard.nav.next")}
            </Button>
          ) : null}
          {step === 3 ? (
            <Button disabled={!configurationReady} onClick={() => goToStep(4)}>
              {t("wizard.nav.next")}
            </Button>
          ) : null}
          {step === 4 ? (
            <Button disabled={!eulaAccepted || busy} onClick={installServer}>
              {t("provisioning.wizard.install")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ConfigSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="wizard-form-section">
      <h4>
        <Icon aria-hidden="true" size={14} />
        {title}
      </h4>
      <div className="form-grid">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <TextField
        aria-label={label}
        min={1}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function BooleanField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-row">
      <input
        aria-label={label}
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

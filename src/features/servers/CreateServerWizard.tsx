import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Card,
  Checkbox,
  Grid,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
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
  Network,
  Package,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { getLoaderBranding } from "../loaders/loaderBranding";
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
import { droppedFilePath } from "../../lib/dropped-files";
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

type WizardStep = 0 | 1 | 2;
type SourceView = "choices" | "blank" | "marketplace";
type ServerIntent = "vanilla" | "plugins" | "mods" | "advanced";
export type CreateServerWizardLifecycle = "draft" | "running" | "complete";

export interface CreateServerWizardProgress {
  steps: Array<{ label: string; description?: string }>;
  currentStep: number;
}

export type CreateServerCompletionAction =
  "overview" | "network" | "content" | "backup";

interface CreateServerWizardProps {
  onCreated?: () => void;
  onLifecycleChange?: (lifecycle: CreateServerWizardLifecycle) => void;
  onHeaderBackChange?: (handler: (() => void) | null) => void;
  onHeaderHiddenChange?: (hidden: boolean) => void;
  /* Rendered inside the marketplace detail bar while the wizard header is
     hidden, so the flow keeps an exit. */
  marketplaceDetailAction?: ReactNode;
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
  /* Set when the user pressed "Import Server" rather than "Create Server".
     Both used to land on this same chooser, which made the two buttons
     indistinguishable. */
  openFolderPickerOnMount?: boolean;
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
  marketplaceDetailAction,
  onProgressChange,
  onRouteStateChange,
  onCompletionAction,
  showHeading = true,
  initialSourcePath = null,
  initialJobId = null,
  openFolderPickerOnMount = false,
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
  const [startAfterInstall, setStartAfterInstall] = useState(false);
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
  const markRecommended = (
    options: LoaderVersionOption[],
    recommendedIndex: number,
  ) =>
    options.map((option, index) => ({
      value: option.value,
      label:
        index === recommendedIndex
          ? t("provisioning.wizard.recommendedOption", { label: option.label })
          : option.label,
    }));
  const minecraftSelectOptions = markRecommended(
    minecraftOptions,
    recommendedMinecraftIndex,
  );
  const loaderSelectOptions = markRecommended(
    loaderOptions,
    recommendedLoaderIndex,
  );
  const loaderTypeOptions = loaders.map((loader) => {
    const branding = getLoaderBranding(loader);
    return {
      value: loader,
      label: branding.label,
      iconSrc: branding.iconSrc,
      iconText: branding.shortLabel,
    };
  });
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

  /* Three decisions, not six screens. Compatibility, the Java runtime and the
     final review are checks the user cannot act on when they pass, so they are
     status rows on the setup step instead of steps of their own. */
  const steps = useMemo(
    () => [
      {
        label: t("provisioning.wizard.step.source"),
        description: sourceStepDetail,
      },
      { label: t("provisioning.wizard.step.setup") },
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
      ...(step === 2 && job?.id ? { jobId: job.id } : {}),
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
          setStep(2);
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
    if (step !== 1 || !sourcePlan || javaRuntime || javaPlan) return;
    let active = true;
    setBusy(true);
    planJavaRuntime(
      sourcePlan.requiredJavaMajor || 21,
      sourcePlan.maxJavaMajor ?? null,
    )
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

  // Fires once. Cancelling the picker leaves the chooser on screen, which is
  // the right place to land anyway.
  const folderPickerOpened = useRef(false);
  useEffect(() => {
    if (!openFolderPickerOnMount || folderPickerOpened.current) return;
    folderPickerOpened.current = true;
    void chooseExistingFolder();
  }, [openFolderPickerOnMount]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length !== 1) {
        setError(t("provisioning.wizard.dropSingle"));
        return;
      }
      const file = files[0];
      await planSource({
        source: {
          kind: "localModpackFile",
          path: droppedFilePath(file) || file.name,
        },
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

  /* The three facts that decide whether the pack can run at all, on one line so
     the setup step can state them without spending a screen on them. */
  const runtimeSummary = [
    [
      sourcePlan?.loaderType ?? loaderType,
      sourcePlan?.loaderVersion || loaderVersion,
    ]
      .filter(Boolean)
      .join(" "),
    sourcePlan?.minecraftVersion || minecraftVersion,
    sourcePlan?.requiredJavaMajor ? `Java ${sourcePlan.requiredJavaMajor}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  /* Exactly one reason, in the order the user would fix them, so the nav bar
     never has to say "something is wrong". */
  const blockedReason = !compatibilityReady
    ? t("provisioning.wizard.blocked.compatibility")
    : !javaRuntime
      ? t("provisioning.wizard.blocked.java")
      : !configurationReady
        ? t("provisioning.wizard.configurationHint")
        : !eulaAccepted
          ? t("provisioning.wizard.blocked.eula")
          : null;

  const executeJob = async (created: ProvisioningJob) => {
    setJob(created);
    setIsRecoveredJob(false);
    setStep(2);
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
        startAfterInstall,
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
    if (step === 2 && job && job.stage !== "ready") return;
    setError(null);
    setStep((step - 1) as WizardStep);
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

  /* The loader and version pickers appear on the blank-server form and again
     when a dropped pack lacks runtime metadata; both read and reset the same
     state. */
  const loaderTypeSelect = (
    <SelectField
      label={t("profileSettings.loader")}
      name="server-loader"
      options={loaderTypeOptions}
      value={loaderType}
      onValueChange={(value) => {
        setLoaderType(value as LoaderType);
        setMinecraftVersion("");
        setLoaderVersion("");
      }}
    />
  );
  const minecraftVersionSelect = (
    <SelectField
      label={t("profileSettings.minecraftVersion")}
      name="minecraft-version"
      options={minecraftSelectOptions}
      placeholder={t("provisioning.wizard.select")}
      value={minecraftVersion}
      onValueChange={(value) => {
        setMinecraftVersion(value);
        setLoaderVersion("");
      }}
    />
  );
  const loaderVersionSelect = (emptyLabel: string, emptyIsChoice: boolean) => (
    <SelectField
      label={t("profileSettings.loaderVersion")}
      name="loader-version"
      options={
        emptyIsChoice
          ? [{ value: "", label: emptyLabel }, ...loaderSelectOptions]
          : loaderSelectOptions
      }
      placeholder={emptyLabel}
      value={loaderVersion}
      onValueChange={setLoaderVersion}
    />
  );

  const choiceCard = (choice: {
    key: string;
    icon: LucideIcon;
    label: string;
    description: string;
    badge?: string;
    onClick: () => void;
  }) => (
    <Card
      aria-label={choice.label}
      component="button"
      key={choice.key}
      ta="left"
      type="button"
      withBorder
      onClick={choice.onClick}
    >
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <ThemeIcon size="lg" variant="light">
          <choice.icon aria-hidden="true" size={18} />
        </ThemeIcon>
        <Stack gap={2} miw={0}>
          <Group gap="xs">
            <Text fw={600} size="sm">
              {choice.label}
            </Text>
            {choice.badge ? (
              <Badge size="xs" variant="light">
                {choice.badge}
              </Badge>
            ) : null}
          </Group>
          <Text c="dimmed" size="xs">
            {choice.description}
          </Text>
        </Stack>
      </Group>
    </Card>
  );

  return (
    <Stack aria-label={t("createServer.title")} component="section" gap="md">
      {showHeading ? <Title order={2}>{t("createServer.title")}</Title> : null}

      <Stack gap="md">
        {step === 0 && sourceView === "choices" ? (
          <Stack gap="md">
            <UnstyledButton
              aria-label={t("provisioning.wizard.drop")}
              data-testid="server-pack-drop-zone"
              disabled={busy}
              p="xl"
              style={{
                border: "1px dashed var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-md)",
              }}
              onClick={chooseLocalFile}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <Stack align="center" gap={6}>
                <ThemeIcon radius="xl" size="xl" variant="light">
                  <Upload aria-hidden="true" size={20} />
                </ThemeIcon>
                <Text fw={600}>{t("provisioning.wizard.dropTitle")}</Text>
                <Text c="dimmed" size="sm" ta="center">
                  {t("provisioning.wizard.dropHint")}
                </Text>
              </Stack>
            </UnstyledButton>
            <Text c="dimmed" size="sm">
              {t("provisioning.wizard.sourceQuestion")}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
              ].map(choiceCard)}
            </SimpleGrid>
          </Stack>
        ) : null}

        {step === 0 && sourceView === "marketplace" ? (
          <CreateServerMarketplaceBrowser
            detailAction={marketplaceDetailAction}
            onDetailModeChange={onHeaderHiddenChange}
            onSelect={handleMarketplaceSelect}
          />
        ) : null}

        {step === 0 && sourceView === "blank" ? (
          serverIntent === null ? (
            <Stack gap="md">
              <div>
                <Title order={2}>{t("createServer.intent.title")}</Title>
                <Text c="dimmed" size="sm">
                  {t("createServer.intent.description")}
                </Text>
              </div>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {(
                  [
                    {
                      key: "vanilla",
                      icon: Gamepad2,
                      label: t("createServer.intent.vanilla"),
                      description: t("createServer.intent.vanilla.description"),
                    },
                    {
                      key: "plugins",
                      icon: Package,
                      label: t("createServer.intent.plugins"),
                      description: t("createServer.intent.plugins.description"),
                      badge: t("createServer.intent.recommended"),
                    },
                    {
                      key: "mods",
                      icon: Cpu,
                      label: t("createServer.intent.mods"),
                      description: t("createServer.intent.mods.description"),
                    },
                    {
                      key: "advanced",
                      icon: ShieldCheck,
                      label: t("createServer.intent.advanced"),
                      description: t(
                        "createServer.intent.advanced.description",
                      ),
                    },
                  ] as const
                ).map((intent) =>
                  choiceCard({
                    ...intent,
                    onClick: () => chooseServerIntent(intent.key),
                  }),
                )}
              </SimpleGrid>
            </Stack>
          ) : (
            <Paper maw={560} p="md">
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text c="dimmed" size="xs">
                      {t("createServer.intent.selected")}
                    </Text>
                    <Text fw={600}>
                      {t(`createServer.intent.${serverIntent}`)}
                    </Text>
                  </div>
                  <Button variant="ghost" onClick={() => setServerIntent(null)}>
                    {t("createServer.intent.change")}
                  </Button>
                </Group>
                <TextInput
                  aria-label={t("profileSettings.name")}
                  label={t("profileSettings.name")}
                  maxLength={MAX_SERVER_NAME_LENGTH}
                  name="server-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                {serverIntent === "advanced" ? loaderTypeSelect : null}
                {minecraftVersionSelect}
                {loaderVersionSelect(t("provisioning.wizard.select"), false)}
                <Group justify="flex-end">
                  <Button
                    disabled={
                      busy || !name || !minecraftVersion || !loaderVersion
                    }
                    variant="primary"
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
                </Group>
              </Stack>
            </Paper>
          )
        ) : null}

        {step === 1 && sourcePlan ? (
          <Grid gap="md">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Stack gap="md">
                {/* Compatibility and Java used to be screens of their own, which
                    made the user click through two pages that say "fine" in the
                    overwhelming majority of runs. They are status rows now and
                    only open up when they actually block the install. */}
                <Stack
                  aria-label={t("provisioning.wizard.readinessAria")}
                  component="section"
                  gap="sm"
                >
                  <ReadinessStrip
                    detail={runtimeSummary}
                    title={t("provisioning.wizard.compatibilityTitle")}
                    tone={compatibilityReady ? "ok" : "warn"}
                  >
                    {!sourcePlan.launchSpec ? (
                      <Stack gap="sm">
                        <Text size="sm">
                          {t("provisioning.wizard.runtimeMetadataRequired")}
                        </Text>
                        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                          {loaderTypeSelect}
                          {minecraftVersionSelect}
                          {loaderVersionSelect(
                            t("provisioning.wizard.autoSelectLoader"),
                            true,
                          )}
                        </SimpleGrid>
                        <Group>
                          <Button
                            disabled={busy || !minecraftVersion}
                            variant="primary"
                            onClick={prepareUnverifiedRuntime}
                          >
                            {t("provisioning.wizard.prepareRuntime")}
                          </Button>
                        </Group>
                      </Stack>
                    ) : null}
                    {sourcePlan.warnings.map((warning) => (
                      <Alert
                        color={
                          warning.requiresAcknowledgement ? "yellow" : "gray"
                        }
                        icon={
                          warning.requiresAcknowledgement ? (
                            <AlertTriangle aria-hidden="true" size={16} />
                          ) : (
                            <Info aria-hidden="true" size={16} />
                          )
                        }
                        key={warning.code}
                        role="note"
                        variant="light"
                      >
                        <Stack gap="xs">
                          <Text size="sm">{warning.message}</Text>
                          {warning.requiresAcknowledgement ? (
                            <Checkbox
                              checked={acknowledgedWarnings.includes(
                                warning.code,
                              )}
                              label={t("provisioning.wizard.acceptWarning")}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setAcknowledgedWarnings((current) =>
                                  checked
                                    ? [...current, warning.code]
                                    : current.filter(
                                        (code) => code !== warning.code,
                                      ),
                                );
                              }}
                            />
                          ) : null}
                        </Stack>
                      </Alert>
                    ))}
                  </ReadinessStrip>

                  <ReadinessStrip
                    detail={
                      javaRuntime
                        ? javaRuntime.path
                        : javaPlan?.action === "install"
                          ? t("provisioning.wizard.javaDownload")
                          : t("provisioning.wizard.javaPlanning")
                    }
                    title={t("provisioning.wizard.javaTitle", {
                      version: sourcePlan.requiredJavaMajor || 21,
                    })}
                    tone={javaRuntime ? "ok" : javaPlan ? "warn" : "pending"}
                  >
                    {javaPlan?.action === "install" && !javaRuntime ? (
                      <Stack gap="sm">
                        <SimpleGrid cols={2} spacing="sm">
                          <div>
                            <Text c="dimmed" size="xs">
                              {t("provisioning.wizard.javaVendor")}
                            </Text>
                            <Text size="sm">{javaPlan.vendor || "-"}</Text>
                          </div>
                          <div>
                            <Text c="dimmed" size="xs">
                              {t("provisioning.wizard.javaVersion")}
                            </Text>
                            <Text ff="monospace" size="sm">
                              {javaPlan.version ||
                                `Java ${javaPlan.majorVersion}`}
                            </Text>
                          </div>
                        </SimpleGrid>
                        {javaPlan.licenseUrl ? (
                          <Anchor href={javaPlan.licenseUrl} size="sm">
                            {t("provisioning.wizard.javaLicense")}
                          </Anchor>
                        ) : null}
                        <Checkbox
                          checked={javaConsent}
                          label={t("provisioning.wizard.javaConsent")}
                          onChange={(event) =>
                            setJavaConsent(event.currentTarget.checked)
                          }
                        />
                        <Group gap="sm">
                          <Button
                            disabled={!javaConsent || busy}
                            variant="primary"
                            onClick={installManagedJava}
                          >
                            {t("provisioning.wizard.installJava", {
                              version: javaPlan.majorVersion,
                            })}
                          </Button>
                          {/* The install button and the primary action both
                              start disabled, and nothing else says which
                              unlocks which. */}
                          <Text c="dimmed" size="xs">
                            {javaConsent
                              ? t("provisioning.wizard.javaInstallHint")
                              : t("provisioning.wizard.javaConsentHint")}
                          </Text>
                        </Group>
                      </Stack>
                    ) : null}
                  </ReadinessStrip>
                </Stack>

                <ConfigSection
                  icon={Server}
                  title={t("provisioning.config.section.identity")}
                >
                  <TextInput
                    aria-label={t("profileSettings.name")}
                    label={t("profileSettings.name")}
                    maxLength={MAX_SERVER_NAME_LENGTH}
                    style={{ gridColumn: "1 / -1" }}
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </ConfigSection>
                <ConfigSection
                  icon={Gamepad2}
                  title={t("provisioning.config.section.gameplay")}
                >
                  <SelectField
                    label={t("provisioning.config.difficulty")}
                    options={["peaceful", "easy", "normal", "hard"].map(
                      (value) => ({
                        value,
                        label: t(`provisioning.config.difficulty.${value}`),
                      }),
                    )}
                    value={configuration.difficulty ?? "normal"}
                    onValueChange={(value) =>
                      setConfiguration((current) => ({
                        ...current,
                        difficulty: value,
                      }))
                    }
                  />
                  <NumberField
                    label={t("provisioning.config.maxPlayers")}
                    value={configuration.maxPlayers || 20}
                    onChange={(value) => setNumber("maxPlayers", value)}
                  />
                  <NumberField
                    label={t("profileSettings.maxMemoryMb")}
                    step={512}
                    value={configuration.maxMemoryMb}
                    onChange={(value) => setNumber("maxMemoryMb", value)}
                  />
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

                <Accordion variant="contained">
                  <Accordion.Item value="advanced">
                    <Accordion.Control>
                      {t("provisioning.config.advanced")}
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        <Text c="dimmed" size="sm">
                          {t("provisioning.config.advancedDescription")}
                        </Text>
                        <ConfigSection
                          icon={HardDrive}
                          title={t("provisioning.config.section.location")}
                        >
                          <TextInput
                            aria-label={t("profileSettings.serverFolder")}
                            ff="monospace"
                            label={t("profileSettings.serverFolder")}
                            style={{ gridColumn: "1 / -1" }}
                            value={rootDir}
                            onChange={(event) =>
                              setRootDir(event.currentTarget.value)
                            }
                          />
                        </ConfigSection>
                        <ConfigSection
                          icon={Cpu}
                          title={t("provisioning.config.section.resources")}
                        >
                          <NumberField
                            label={t("profileSettings.minMemoryMb")}
                            step={512}
                            value={configuration.minMemoryMb}
                            onChange={(value) =>
                              setNumber("minMemoryMb", value)
                            }
                          />
                          <NumberField
                            description={
                              takenPorts.includes(configuration.serverPort) ? (
                                <Text
                                  c="yellow"
                                  component="span"
                                  inherit
                                  role="status"
                                >
                                  {t("provisioning.config.portTaken")}
                                </Text>
                              ) : undefined
                            }
                            label={t("profileSettings.port")}
                            value={configuration.serverPort}
                            onChange={(value) => setNumber("serverPort", value)}
                          />
                          <NumberField
                            label={t("provisioning.config.viewDistance")}
                            value={configuration.viewDistance || 10}
                            onChange={(value) =>
                              setNumber("viewDistance", value)
                            }
                          />
                          <NumberField
                            label={t("provisioning.config.simulationDistance")}
                            value={configuration.simulationDistance || 10}
                            onChange={(value) =>
                              setNumber("simulationDistance", value)
                            }
                          />
                        </ConfigSection>
                        <ConfigSection
                          icon={Gamepad2}
                          title={t("provisioning.config.advancedGameplay")}
                        >
                          <TextInput
                            aria-label={t("provisioning.config.motd")}
                            label={t("provisioning.config.motd")}
                            style={{ gridColumn: "1 / -1" }}
                            value={configuration.motd}
                            onChange={(event) => {
                              const motd = event.currentTarget.value;
                              setConfiguration((current) => ({
                                ...current,
                                motd,
                              }));
                            }}
                          />
                          <SelectField
                            label={t("provisioning.config.gameMode")}
                            options={[
                              "survival",
                              "creative",
                              "adventure",
                              "spectator",
                            ].map((value) => ({
                              value,
                              label: t(`provisioning.config.gameMode.${value}`),
                            }))}
                            value={configuration.gameMode ?? "survival"}
                            onValueChange={(value) =>
                              setConfiguration((current) => ({
                                ...current,
                                gameMode: value,
                              }))
                            }
                          />
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
                            checked={startAfterInstall}
                            onChange={setStartAfterInstall}
                          />
                        </ConfigSection>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>

                <Checkbox
                  aria-label={t("provisioning.wizard.eulaAccept")}
                  checked={eulaAccepted}
                  label={
                    <>
                      {t("provisioning.wizard.eulaAccept")}{" "}
                      <Anchor href="https://aka.ms/MinecraftEULA" inherit>
                        {t("provisioning.wizard.eulaLink")}
                      </Anchor>
                    </>
                  }
                  onChange={(event) =>
                    setEulaAccepted(event.currentTarget.checked)
                  }
                />
              </Stack>
            </Grid.Col>

            {/* Replaces the review step: the same facts, shown while they are
                still editable instead of one screen after. */}
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Paper
                aria-label={t("provisioning.wizard.summaryTitle")}
                component="aside"
                p="md"
              >
                <Title mb="sm" order={3}>
                  {t("provisioning.wizard.summaryTitle")}
                </Title>
                <Stack gap="xs">
                  {[
                    [t("profileSettings.name"), name, false],
                    [t("profileSettings.loader"), runtimeSummary, false],
                    [t("profileSettings.serverFolder"), rootDir, true],
                    [t("profileSettings.port"), configuration.serverPort, true],
                    [
                      t("profileSettings.maxMemoryMb"),
                      `${configuration.maxMemoryMb} MB`,
                      true,
                    ],
                    [
                      t("provisioning.config.maxPlayers"),
                      configuration.maxPlayers || 20,
                      true,
                    ],
                    ...(javaRuntime
                      ? [
                          [
                            t("provisioning.wizard.detectedJava"),
                            javaRuntime.path,
                            true,
                          ] as const,
                        ]
                      : []),
                  ].map(([label, value, mono]) => (
                    <div key={String(label)}>
                      <Text c="dimmed" size="xs">
                        {label}
                      </Text>
                      <Text
                        ff={mono ? "monospace" : undefined}
                        size="sm"
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {value}
                      </Text>
                    </div>
                  ))}
                </Stack>
              </Paper>
            </Grid.Col>
          </Grid>
        ) : null}

        {step === 2 && job ? (
          <>
            <Paper p="md">
              <ProvisioningProgress
                busy={busy}
                job={job}
                onCancel={cancelJob}
                onRetry={retryJob}
              />
            </Paper>
            {isRecoveredJob && !busy && job.stage !== "ready" ? (
              <Group>
                <Button variant="ghost" onClick={startFreshDraft}>
                  {t("provisioning.wizard.startFresh")}
                </Button>
              </Group>
            ) : null}
            {job.stage === "ready" && job.serverId ? (
              <Paper
                aria-label={t("provisioning.complete.aria")}
                component="section"
                p="md"
              >
                <Title order={3}>{t("provisioning.complete.title")}</Title>
                <Text c="dimmed" mb="md" size="sm">
                  {t("provisioning.complete.description")}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <Button
                    disabled={busy}
                    variant="primary"
                    onClick={() => void runCompletionAction("overview")}
                  >
                    <Rocket aria-hidden="true" size={16} />
                    {t("provisioning.complete.start")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("network")}
                  >
                    <Network aria-hidden="true" size={16} />
                    {t("provisioning.complete.network")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("content")}
                  >
                    <Boxes aria-hidden="true" size={16} />
                    {t("provisioning.complete.content")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void runCompletionAction("backup")}
                  >
                    <Archive aria-hidden="true" size={16} />
                    {t("provisioning.complete.backup")}
                  </Button>
                </SimpleGrid>
              </Paper>
            ) : null}
          </>
        ) : null}

        {/* ProvisioningProgress already reports a failed job, so the wizard-level
            error would repeat the same sentence directly beneath it. */}
        {error && !job?.error ? (
          <Alert
            color="red"
            icon={<AlertTriangle aria-hidden="true" size={16} />}
            variant="light"
          >
            <Group gap="sm" justify="space-between">
              <Text size="sm">{error}</Text>
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
            </Group>
          </Alert>
        ) : null}
      </Stack>

      {step === 0 && sourceView === "marketplace" ? null : (
        <Group gap="sm" wrap="nowrap">
          {step > 0 && !(step === 2 && job?.stage !== "ready") ? (
            <Button variant="ghost" onClick={goBack}>
              {t("wizard.nav.back")}
            </Button>
          ) : sourceView !== "choices" && step === 0 ? (
            <Button variant="ghost" onClick={() => setSourceView("choices")}>
              {t("wizard.nav.back")}
            </Button>
          ) : null}
          <Box flex={1} />
          {step === 1 ? (
            <>
              {/* A disabled primary with no explanation reads as a broken
                  wizard, so the bar names the one thing still missing. */}
              {blockedReason ? (
                <Text c="dimmed" role="status" size="sm" ta="right">
                  {blockedReason}
                </Text>
              ) : null}
              <Button
                disabled={Boolean(blockedReason) || busy}
                variant="primary"
                onClick={installServer}
              >
                {t("provisioning.wizard.install")}
              </Button>
            </>
          ) : null}
        </Group>
      )}
    </Stack>
  );
}

/* A readiness check that reads at a glance when it passes and expands into the
   controls that fix it when it does not. */
function ReadinessStrip({
  tone,
  title,
  detail,
  children,
}: {
  tone: "ok" | "warn" | "pending";
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  const Icon =
    tone === "ok" ? ShieldCheck : tone === "warn" ? AlertTriangle : Info;
  return (
    <Paper p="md">
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon
            color={
              tone === "ok" ? "green" : tone === "warn" ? "yellow" : "gray"
            }
            size="md"
            variant="light"
          >
            <Icon aria-hidden="true" size={16} />
          </ThemeIcon>
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Text c="dimmed" ff="monospace" size="xs" truncate>
            {detail}
          </Text>
        </Group>
        {children}
      </Stack>
    </Paper>
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
    <Paper component="section" p="md">
      <Group gap={6} mb="sm">
        <Icon aria-hidden="true" size={14} />
        <Title order={4}>{title}</Title>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="sm">
        {children}
      </SimpleGrid>
    </Paper>
  );
}

function SelectField({
  label,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Select>, "ariaLabel">) {
  return (
    <Stack gap={4}>
      <Text fw={500} size="sm">
        {label}
      </Text>
      <Select ariaLabel={label} {...props} />
    </Stack>
  );
}

function NumberField({
  label,
  description,
  step,
  value,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  step?: number;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <NumberInput
      aria-label={label}
      description={description}
      ff="monospace"
      inputWrapperOrder={["label", "input", "description"]}
      label={label}
      min={1}
      step={step}
      value={value}
      onChange={(next) => onChange(String(next))}
    />
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
    <Checkbox
      checked={checked}
      label={label}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileArchive, FolderOpen, Package, Server, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { useAppSettings } from "../../i18n";
import { getDefaultServerRoot, listLoaderMinecraftVersions, listLoaderVersions } from "./api";
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
import type { GuidedServerConfiguration, LoaderType, ValidatedJavaRuntime } from "./types";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;
type SourceView = "choices" | "blank" | "marketplace";
export type CreateServerWizardLifecycle = "draft" | "running" | "complete";

export interface CreateServerWizardProgress {
  steps: Array<{ label: string; description?: string }>;
  currentStep: number;
}

interface CreateServerWizardProps {
  onCreated?: () => void;
  onLifecycleChange?: (lifecycle: CreateServerWizardLifecycle) => void;
  onHeaderBackChange?: (handler: (() => void) | null) => void;
  onHeaderHiddenChange?: (hidden: boolean) => void;
  onProgressChange?: (progress: CreateServerWizardProgress | null) => void;
  showHeading?: boolean;
  initialSourcePath?: string | null;
}

const loaders: LoaderType[] = [
  "vanilla",
  "paper",
  "forge",
  "neoForge",
  "fabric",
  "quilt",
];

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function CreateServerWizard({
  onCreated,
  onLifecycleChange,
  onHeaderBackChange,
  onHeaderHiddenChange,
  onProgressChange,
  showHeading = true,
  initialSourcePath = null,
}: CreateServerWizardProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(0);
  const [sourceView, setSourceView] = useState<SourceView>("choices");
  const [sourcePlan, setSourcePlan] = useState<SourceProvisioningPlan | null>(null);
  const [name, setName] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [loaderType, setLoaderType] = useState<LoaderType>("paper");
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [minecraftOptions, setMinecraftOptions] = useState<string[]>([]);
  const [loaderOptions, setLoaderOptions] = useState<string[]>([]);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([]);
  const [javaPlan, setJavaPlan] = useState<JavaRuntimePlan | null>(null);
  const [javaRuntime, setJavaRuntime] = useState<ValidatedJavaRuntime | null>(null);
  const [javaConsent, setJavaConsent] = useState(false);
  const [configuration, setConfiguration] =
    useState<GuidedServerConfiguration>(initialConfiguration);
  const [restartEnabled, setRestartEnabled] = useState(true);
  const [autoStart, setAutoStart] = useState(true);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [job, setJob] = useState<ProvisioningJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plannedInitialPath = useRef<string | null>(null);
  const lifecycle = useRef<CreateServerWizardLifecycle>("draft");
  const lifecycleCallback = useRef(onLifecycleChange);

  useEffect(() => {
    lifecycleCallback.current = onLifecycleChange;
    onLifecycleChange?.(lifecycle.current);
  }, [onLifecycleChange]);

  const publishLifecycle = useCallback(
    (next: CreateServerWizardLifecycle) => {
      lifecycle.current = next;
      lifecycleCallback.current?.(next);
    },
    [],
  );

  const steps = useMemo(
    () => [
      { label: t("provisioning.wizard.step.source") },
      { label: t("provisioning.wizard.step.compatibility") },
      { label: t("provisioning.wizard.step.java") },
      { label: t("provisioning.wizard.step.configuration") },
      { label: t("provisioning.wizard.step.review") },
      { label: t("provisioning.wizard.step.install") },
    ],
    [t],
  );

  useEffect(() => {
    onProgressChange?.({ steps, currentStep: step });
  }, [onProgressChange, step, steps]);

  useEffect(
    () => () => {
      onProgressChange?.(null);
    },
    [onProgressChange],
  );

  useEffect(() => {
    let active = true;
    listRecoverableProvisioningJobs()
      .then((jobs) => {
        if (active && jobs[0]) {
          setJob(jobs[0]);
          setStep(5);
          publishLifecycle(jobs[0].stage === "ready" ? "complete" : "running");
        }
      })
      .catch((caught) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [publishLifecycle]);

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

  useEffect(() => {
    if (sourceView !== "blank" && !needsRuntimeMetadata) return;
    let active = true;
    listLoaderMinecraftVersions(loaderType)
      .then((options) => active && setMinecraftOptions(options.map((item) => item.value)))
      .catch((caught) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [loaderType, needsRuntimeMetadata, sourceView]);

  useEffect(() => {
    if ((sourceView !== "blank" && !needsRuntimeMetadata) || !minecraftVersion) return;
    let active = true;
    listLoaderVersions(loaderType, minecraftVersion)
      .then((options) => active && setLoaderOptions(options.map((item) => item.value)))
      .catch((caught) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [loaderType, minecraftVersion, needsRuntimeMetadata, sourceView]);

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

  const applyPlan = useCallback(async (plan: SourceProvisioningPlan, existingRoot?: string) => {
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
  }, [name]);

  const planSource = useCallback(
    async (input: Parameters<typeof planServerProvisioning>[0], existingRoot?: string) => {
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
      await planSource({ source: { kind: "localModpackFile", path: selected } });
    }
  };

  useEffect(() => {
    if (!initialSourcePath || plannedInitialPath.current === initialSourcePath) return;
    plannedInitialPath.current = initialSourcePath;
    void planSource({
      source: { kind: "localModpackFile", path: initialSourcePath },
    });
  }, [initialSourcePath, planSource]);

  const chooseExistingFolder = async () => {
    const selected = await pick("folder");
    if (selected) {
      await planSource({ source: { kind: "existingFolder" }, rootDir: selected }, selected);
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

  const handleMarketplaceSelect = async (selection: MarketplaceCreateSelection) => {
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

  const requiredWarnings = sourcePlan?.warnings.filter(
    (warning) => warning.requiresAcknowledgement,
  ) || [];
  const compatibilityReady = requiredWarnings.every((warning) =>
    acknowledgedWarnings.includes(warning.code),
  ) && Boolean(sourcePlan?.launchSpec);

  const prepareUnverifiedRuntime = async () => {
    if (!sourcePlan || !minecraftVersion) return;
    await planSource(
      {
        source: sourcePlan.source,
        name,
        rootDir: sourcePlan.source.kind === "existingFolder" ? rootDir : undefined,
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
    setStep(5);
    publishLifecycle("running");
    const poll = window.setInterval(() => {
      getProvisioningJob(created.id)
        .then((current) => current && setJob(current))
        .catch(() => undefined);
    }, 500);
    try {
      const completed = await runProvisioningJob(created.id);
      setJob(completed);
      if (completed.stage === "ready") {
        publishLifecycle("complete");
        await queryClient.invalidateQueries({ queryKey: ["serverProfiles"] });
        onCreated?.();
      }
    } catch (caught) {
      setError(errorMessage(caught));
      try {
        setJob(await getProvisioningJob(created.id));
      } catch {
        // The command error remains visible if the persisted job cannot be reloaded.
      }
    } finally {
      window.clearInterval(poll);
    }
  };

  const installServer = async () => {
    if (!sourcePlan || !javaRuntime || !sourcePlan.launchSpec || !eulaAccepted) return;
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
    setStep((step - 1) as WizardStep);
  };

  return (
    <section aria-label={t("createServer.title")} className="create-server-panel">
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
              <Upload aria-hidden="true" size={22} />
              <span>{t("provisioning.wizard.drop")}</span>
            </button>
            <div className="wizard-actions">
              <button className="wizard-action" type="button" onClick={() => setSourceView("blank")}>
                <Server aria-hidden="true" size={24} />
                <span>{t("createServer.newBlank")}</span>
              </button>
              <button className="wizard-action" type="button" onClick={chooseExistingFolder}>
                <FolderOpen aria-hidden="true" size={24} />
                <span>{t("createServer.importFolder")}</span>
              </button>
              <button className="wizard-action" type="button" onClick={() => setSourceView("marketplace")}>
                <Package aria-hidden="true" size={24} />
                <span>{t("createServer.browseMarketplace")}</span>
              </button>
              <button className="wizard-action" type="button" onClick={chooseLocalFile}>
                <FileArchive aria-hidden="true" size={24} />
                <span>{t("createServer.openModpackFile")}</span>
              </button>
            </div>
          </div>
        ) : null}

        {step === 0 && sourceView === "marketplace" ? (
          <CreateServerMarketplaceBrowser
            onDetailModeChange={onHeaderHiddenChange}
            onSelect={handleMarketplaceSelect}
          />
        ) : null}

        {step === 0 && sourceView === "blank" ? (
          <div className="form-grid provisioning-source-form">
            <label>
              <span>{t("profileSettings.name")}</span>
              <TextField aria-label={t("profileSettings.name")} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>{t("profileSettings.loader")}</span>
              <select aria-label={t("profileSettings.loader")} className="field-control" value={loaderType} onChange={(event) => setLoaderType(event.target.value as LoaderType)}>
                {loaders.map((loader) => <option key={loader} value={loader}>{loader}</option>)}
              </select>
            </label>
            <label>
              <span>{t("profileSettings.minecraftVersion")}</span>
              <select aria-label={t("profileSettings.minecraftVersion")} className="field-control" value={minecraftVersion} onChange={(event) => setMinecraftVersion(event.target.value)}>
                <option value="">{t("provisioning.wizard.select")}</option>
                {minecraftOptions.map((version) => <option key={version}>{version}</option>)}
              </select>
            </label>
            <label>
              <span>{t("profileSettings.loaderVersion")}</span>
              <select aria-label={t("profileSettings.loaderVersion")} className="field-control" value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
                <option value="">{t("provisioning.wizard.select")}</option>
                {loaderOptions.map((version) => <option key={version}>{version}</option>)}
              </select>
            </label>
            <Button
              disabled={busy || !name || !minecraftVersion || !loaderVersion}
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
        ) : null}

        {step === 1 && sourcePlan ? (
          <div className="provisioning-compatibility">
            <h3>{t("provisioning.wizard.compatibilityTitle")}</h3>
            {!sourcePlan.launchSpec ? (
              <div className="form-grid provisioning-runtime-metadata">
                <p>{t("provisioning.wizard.runtimeMetadataRequired")}</p>
                <label>
                  <span>{t("profileSettings.loader")}</span>
                  <select aria-label={t("profileSettings.loader")} className="field-control" value={loaderType} onChange={(event) => { setLoaderType(event.target.value as LoaderType); setMinecraftVersion(""); setLoaderVersion(""); }}>
                    {loaders.map((loader) => <option key={loader} value={loader}>{loader}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("profileSettings.minecraftVersion")}</span>
                  <select aria-label={t("profileSettings.minecraftVersion")} className="field-control" value={minecraftVersion} onChange={(event) => { setMinecraftVersion(event.target.value); setLoaderVersion(""); }}>
                    <option value="">{t("provisioning.wizard.select")}</option>
                    {minecraftOptions.map((version) => <option key={version}>{version}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("profileSettings.loaderVersion")}</span>
                  <select aria-label={t("profileSettings.loaderVersion")} className="field-control" value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
                    <option value="">{t("provisioning.wizard.autoSelectLoader")}</option>
                    {loaderOptions.map((version) => <option key={version}>{version}</option>)}
                  </select>
                </label>
                <Button disabled={busy || !minecraftVersion} onClick={prepareUnverifiedRuntime}>
                  {t("provisioning.wizard.prepareRuntime")}
                </Button>
              </div>
            ) : null}
            {sourcePlan.warnings.length === 0 ? (
              <p>{t("provisioning.wizard.noWarnings")}</p>
            ) : (
              sourcePlan.warnings.map((warning) => (
                <label className="provisioning-warning" key={warning.code}>
                  <span>{warning.message}</span>
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
            <h3>{t("provisioning.wizard.javaTitle", { version: sourcePlan?.requiredJavaMajor || 21 })}</h3>
            {javaRuntime ? <p>{t("provisioning.wizard.javaReady", { path: javaRuntime.path })}</p> : null}
            {javaPlan?.action === "install" && !javaRuntime ? (
              <>
                <p>{t("provisioning.wizard.javaDownload")}</p>
                {javaPlan.licenseUrl ? <a href={javaPlan.licenseUrl}>{t("provisioning.wizard.javaLicense")}</a> : null}
                <label className="checkbox-row">
                  <input
                    aria-label={t("provisioning.wizard.javaConsent")}
                    checked={javaConsent}
                    type="checkbox"
                    onChange={(event) => setJavaConsent(event.target.checked)}
                  />
                  {t("provisioning.wizard.javaConsent")}
                </label>
                <Button disabled={!javaConsent || busy} onClick={installManagedJava}>
                  {t("provisioning.wizard.installJava", { version: javaPlan.majorVersion })}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="form-grid provisioning-configuration-step">
            <label><span>{t("profileSettings.name")}</span><TextField aria-label={t("profileSettings.name")} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>{t("profileSettings.serverFolder")}</span><TextField aria-label={t("profileSettings.serverFolder")} value={rootDir} onChange={(event) => setRootDir(event.target.value)} /></label>
            <NumberField label={t("profileSettings.minMemoryMb")} value={configuration.minMemoryMb} onChange={(value) => setNumber("minMemoryMb", value)} />
            <NumberField label={t("profileSettings.maxMemoryMb")} value={configuration.maxMemoryMb} onChange={(value) => setNumber("maxMemoryMb", value)} />
            <NumberField label={t("profileSettings.port")} value={configuration.serverPort} onChange={(value) => setNumber("serverPort", value)} />
            <NumberField label={t("provisioning.config.maxPlayers")} value={configuration.maxPlayers || 20} onChange={(value) => setNumber("maxPlayers", value)} />
            <label><span>{t("provisioning.config.motd")}</span><TextField aria-label={t("provisioning.config.motd")} value={configuration.motd} onChange={(event) => setConfiguration((current) => ({ ...current, motd: event.target.value }))} /></label>
            <label><span>{t("provisioning.config.gameMode")}</span><select aria-label={t("provisioning.config.gameMode")} className="field-control" value={configuration.gameMode} onChange={(event) => setConfiguration((current) => ({ ...current, gameMode: event.target.value }))}><option value="survival">{t("provisioning.config.gameMode.survival")}</option><option value="creative">{t("provisioning.config.gameMode.creative")}</option><option value="adventure">{t("provisioning.config.gameMode.adventure")}</option><option value="spectator">{t("provisioning.config.gameMode.spectator")}</option></select></label>
            <label><span>{t("provisioning.config.difficulty")}</span><select aria-label={t("provisioning.config.difficulty")} className="field-control" value={configuration.difficulty} onChange={(event) => setConfiguration((current) => ({ ...current, difficulty: event.target.value }))}><option value="peaceful">{t("provisioning.config.difficulty.peaceful")}</option><option value="easy">{t("provisioning.config.difficulty.easy")}</option><option value="normal">{t("provisioning.config.difficulty.normal")}</option><option value="hard">{t("provisioning.config.difficulty.hard")}</option></select></label>
            <NumberField label={t("provisioning.config.viewDistance")} value={configuration.viewDistance || 10} onChange={(value) => setNumber("viewDistance", value)} />
            <NumberField label={t("provisioning.config.simulationDistance")} value={configuration.simulationDistance || 10} onChange={(value) => setNumber("simulationDistance", value)} />
            <BooleanField label={t("provisioning.config.onlineMode")} checked={configuration.onlineMode !== false} onChange={(checked) => setConfiguration((current) => ({ ...current, onlineMode: checked }))} />
            <BooleanField label={t("provisioning.config.pvp")} checked={configuration.pvp !== false} onChange={(checked) => setConfiguration((current) => ({ ...current, pvp: checked }))} />
            <BooleanField label={t("provisioning.config.whiteList")} checked={configuration.whiteList === true} onChange={(checked) => setConfiguration((current) => ({ ...current, whiteList: checked }))} />
            <BooleanField label={t("provisioning.config.restart")} checked={restartEnabled} onChange={setRestartEnabled} />
            <BooleanField label={t("provisioning.config.autoStart")} checked={autoStart} onChange={setAutoStart} />
          </div>
        ) : null}

        {step === 4 && sourcePlan ? (
          <div className="wizard-review-step">
            <h3>{t("provisioning.wizard.reviewTitle")}</h3>
            <dl className="wizard-review-fields">
              <div><dt>{t("profileSettings.name")}</dt><dd>{name}</dd></div>
              <div><dt>{t("profileSettings.loader")}</dt><dd>{loaderType} {loaderVersion}</dd></div>
              <div><dt>{t("profileSettings.minecraftVersion")}</dt><dd>{minecraftVersion}</dd></div>
              <div><dt>{t("profileSettings.serverFolder")}</dt><dd>{rootDir}</dd></div>
              <div><dt>{t("profileSettings.maxMemoryMb")}</dt><dd>{configuration.maxMemoryMb} MB</dd></div>
            </dl>
            <label className="provisioning-eula checkbox-row">
              <input
                aria-label={t("provisioning.wizard.eulaAccept")}
                checked={eulaAccepted}
                type="checkbox"
                onChange={(event) => setEulaAccepted(event.target.checked)}
              />
              <span>
                {t("provisioning.wizard.eulaAccept")} {" "}
                <a href="https://aka.ms/MinecraftEULA">{t("provisioning.wizard.eulaLink")}</a>
              </span>
            </label>
          </div>
        ) : null}

        {step === 5 && job ? (
          <ProvisioningProgress
            busy={busy}
            job={job}
            onCancel={cancelJob}
            onRetry={retryJob}
          />
        ) : null}

        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>

      <div className="wizard-nav-bar">
        {step > 0 && !(step === 5 && job?.stage !== "ready") ? (
          <Button variant="ghost" onClick={goBack}>{t("wizard.nav.back")}</Button>
        ) : sourceView !== "choices" && step === 0 ? (
          <Button variant="ghost" onClick={() => setSourceView("choices")}>{t("wizard.nav.back")}</Button>
        ) : null}
        <div className="wizard-nav-spacer" />
        {step === 1 ? <Button disabled={!compatibilityReady} onClick={() => setStep(2)}>{t("wizard.nav.next")}</Button> : null}
        {step === 2 ? <Button disabled={!javaRuntime || busy} onClick={() => setStep(3)}>{t("wizard.nav.next")}</Button> : null}
        {step === 3 ? <Button disabled={!configurationReady} onClick={() => setStep(4)}>{t("wizard.nav.next")}</Button> : null}
        {step === 4 ? <Button disabled={!eulaAccepted || busy} onClick={installServer}>{t("provisioning.wizard.install")}</Button> : null}
      </div>
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
      <TextField aria-label={label} min={1} type="number" value={value} onChange={(event) => onChange(event.target.value)} />
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
      <input aria-label={label} checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

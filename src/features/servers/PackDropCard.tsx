import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { ServerCover } from "../../components/ui/server-cover";
import { useAppSettings } from "../../i18n";
import { errorMessage } from "../../lib/error-message";
import type { LoaderType } from "../../domain/server";
import { getDefaultServerRoot, suggestServerPort } from "./api";
import {
  LOADER_VERSION_PATTERN,
  MINECRAFT_VERSION_PATTERN,
  formatBytes,
  formatMemory,
  loaderLabel,
  type PackDetection,
  type PackWarning,
} from "./packDetection";
import {
  createProvisioningJob,
  getProvisioningJob,
  installJavaRuntime,
  planJavaRuntime,
  planServerProvisioning,
  retryProvisioningJob,
  runProvisioningJob,
  cancelProvisioningJob,
  type FinalProvisioningPlan,
  type JavaRuntimePlan,
  type ProvisioningJob,
  type SourceProvisioningPlan,
} from "./provisioningApi";
import { ProvisioningProgress } from "./ProvisioningProgress";
import { serverKeys } from "./queries";
import type {
  GuidedServerConfiguration,
  ValidatedJavaRuntime,
} from "./types";
import "../../styles/pack-drop.css";

const MINECRAFT_EULA_URL = "https://aka.ms/MinecraftEULA";

/* Warnings that have their own wording in both languages. Anything else falls
   back to the backend's message rather than a missing-key marker. */
const LOCALISED_WARNINGS = new Set([
  "PACK_VERSION_CONFLICT",
  "PACK_LOADER_CONFLICT",
  "PACK_LOADER_VERSION_CONFLICT",
  "PACK_VERSION_INFERRED",
  "PACK_NO_VERSION",
  "PACK_MODS_INCOMPATIBLE",
  "PACK_MODS_LOADER_MISMATCH",
  "PACK_CLIENT_ONLY_MODS",
  "PACK_MEMORY_CAPPED",
  "PACK_JAVA_CONFLICT",
  "PACK_LOADER_VERSION_UNSTATED",
  "PACK_MODS_UNINSPECTED",
  "PACK_CLIENT_PACK",
  "PACK_MODS_NOT_FETCHABLE",
  "PACK_UNVERIFIED",
  "PACK_UNRECOGNIZED",
  "PACK_BARE_JAR",
  "PACK_BARE_JAR_MOD",
]);

const BASE_CONFIGURATION: GuidedServerConfiguration = {
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  gameMode: "survival",
  difficulty: "normal",
  maxPlayers: 20,
  onlineMode: true,
  pvp: true,
  whiteList: false,
  viewDistance: 10,
  simulationDistance: 10,
};

type Phase = "reading" | "review" | "installing" | "failed";
type EditableField = "minecraft" | "loader" | "memory" | "port" | "automation";

interface PackDropCardProps {
  /** The dropped file. The card is closed while this is null. */
  path: string | null;
  onClose: () => void;
  /** Hands the same file to the guided setup, for what the card cannot edit. */
  onOpenWizard: (path: string) => void;
  /** Called once the server exists, so the app can show it. */
  onCreated: (serverId: string | null) => void;
}

function detectionOf(plan: SourceProvisioningPlan | null) {
  return (plan?.detection as PackDetection | undefined) ?? null;
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function PackDropCard({
  path,
  onClose,
  onOpenWizard,
  onCreated,
}: PackDropCardProps) {
  const { t, language } = useAppSettings();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("reading");
  const [plan, setPlan] = useState<SourceProvisioningPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [javaPlan, setJavaPlan] = useState<JavaRuntimePlan | null>(null);
  const [javaRuntime, setJavaRuntime] = useState<ValidatedJavaRuntime | null>(
    null,
  );
  const [javaDownloading, setJavaDownloading] = useState(false);
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [memoryChosen, setMemoryChosen] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const [portChosen, setPortChosen] = useState(false);
  const [takenPorts, setTakenPorts] = useState<number[]>([]);
  const [restartOnCrash, setRestartOnCrash] = useState(true);
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [expandedWarning, setExpandedWarning] = useState<string | null>(null);
  const [job, setJob] = useState<ProvisioningJob | null>(null);
  const mounted = useRef(true);
  const changeButtons = useRef<Partial<Record<EditableField, HTMLElement>>>({});
  const pollTimer = useRef<number | null>(null);
  const planRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, []);

  const detection = detectionOf(plan);

  const loadJava = useCallback(async (next: SourceProvisioningPlan) => {
    setJavaPlan(null);
    setJavaRuntime(null);
    if (!next.requiredJavaMajor) return;
    try {
      const planned = await planJavaRuntime(
        next.requiredJavaMajor,
        next.maxJavaMajor ?? null,
      );
      if (!mounted.current) return;
      setJavaPlan(planned);
      if (planned.action === "reuse" && planned.runtime) {
        setJavaRuntime({ ...planned.runtime, validated: true });
      }
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    }
  }, []);

  /* Plans the pack. Re-run with overrides when the user edits the Minecraft or
     loader version, so the install plan and Java requirement follow it. */
  const planPack = useCallback(
    async (
      sourcePath: string,
      overrides?: { minecraftVersion?: string; loaderVersion?: string },
      loaderType?: LoaderType,
    ) => {
      const request = ++planRequest.current;
      const next = await planServerProvisioning({
        source: { kind: "localModpackFile", path: sourcePath },
        prepareInstall: true,
        ...(overrides?.minecraftVersion
          ? {
              minecraftVersion: overrides.minecraftVersion,
              loaderType,
              loaderVersion: overrides.loaderVersion || undefined,
            }
          : {}),
      });
      if (!mounted.current || request !== planRequest.current) return null;
      setPlan(next);
      setMinecraftVersion(next.minecraftVersion ?? "");
      setLoaderVersion(next.loaderVersion ?? "");
      await loadJava(next);
      return next;
    },
    [loadJava],
  );

  useEffect(() => {
    if (!path) return;
    let active = true;
    setPhase("reading");
    setPlan(null);
    setError(null);
    setJob(null);
    setEditing(null);
    setMemoryChosen(false);
    setPortChosen(false);
    setShowEvidence(false);
    setExpandedWarning(null);
    void (async () => {
      try {
        const [next, suggestion] = await Promise.all([
          planPack(path),
          suggestServerPort().catch(() => null),
        ]);
        if (!active || !next) return;
        const found = detectionOf(next);
        const taken = suggestion?.taken ?? [];
        setTakenPorts(taken);
        /* A port the pack states is kept if it is free; otherwise the first
           free one, so the card never proposes a collision. */
        const stated = found?.port?.value ?? null;
        setPort(
          stated && !taken.includes(stated)
            ? stated
            : (suggestion?.port ?? stated ?? 25565),
        );
        setMemoryMb(found?.memory?.maxMb ?? BASE_CONFIGURATION.maxMemoryMb);
        setPhase("review");
      } catch (caught) {
        if (!active) return;
        setError(errorMessage(caught));
        setPhase("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [path, planPack]);

  const open = path !== null;
  const warnings: PackWarning[] =
    (plan?.warnings as PackWarning[] | undefined) ?? [];
  const kind = detection?.kind ?? "unknown";
  const blockedReason: string | null = !detection
    ? null
    : kind === "bareJar"
      ? detection.jarRole === "mod"
        ? "packDrop.blocked.bareJarMod"
        : "packDrop.blocked.bareJar"
      : kind === "unknown"
        ? "packDrop.blocked.unknown"
        : kind === "clientPack" && detection.unfetchable.length > 0
          ? "packDrop.blocked.clientPack"
          : null;
  const loaderType = (plan?.loaderType ?? detection?.loader?.type) as
    | LoaderType
    | undefined;
  const canConfirm =
    phase === "review" &&
    !busy &&
    !blockedReason &&
    Boolean(plan?.launchSpec) &&
    Boolean(loaderType) &&
    MINECRAFT_VERSION_PATTERN.test(minecraftVersion) &&
    port !== null &&
    memoryMb !== null &&
    javaPlan !== null &&
    (javaPlan.action === "install" || javaRuntime !== null);

  const startEdit = (field: EditableField) => {
    setDraftError(null);
    if (field === "minecraft") setDraft(minecraftVersion);
    if (field === "loader") setDraft(loaderVersion);
    if (field === "memory") setDraft(String((memoryMb ?? 4096) / 1024));
    if (field === "port") setDraft(String(port ?? 25565));
    setEditing(field);
  };

  const stopEdit = (field: EditableField) => {
    setEditing(null);
    // Focus goes back to the control that opened the editor.
    window.setTimeout(() => changeButtons.current[field]?.focus(), 0);
  };

  const applyEdit = async (field: EditableField) => {
    const value = draft.trim();
    if (field === "memory") {
      const gb = Number(value);
      const totalMb = detection?.memory?.totalMb ?? null;
      const mb = Math.round(gb * 1024);
      if (
        !Number.isFinite(gb) ||
        mb < 1024 ||
        mb > (totalMb ?? 131072)
      ) {
        setDraftError(
          t("packDrop.invalid.memory", {
            max: formatMemory(totalMb ?? 131072),
          }),
        );
        return;
      }
      setMemoryMb(mb);
      setMemoryChosen(true);
    } else if (field === "port") {
      const next = Number(value);
      if (!Number.isInteger(next) || next < 1024 || next > 65535) {
        setDraftError(t("packDrop.invalid.port"));
        return;
      }
      setPort(next);
      setPortChosen(true);
    } else if (field === "minecraft" || field === "loader") {
      const pattern =
        field === "minecraft" ? MINECRAFT_VERSION_PATTERN : LOADER_VERSION_PATTERN;
      if (!pattern.test(value)) {
        setDraftError(
          t(
            field === "minecraft"
              ? "packDrop.invalid.minecraft"
              : "packDrop.invalid.loader",
          ),
        );
        return;
      }
      if (!path || !loaderType) return;
      setBusy(true);
      setError(null);
      try {
        await planPack(
          path,
          field === "minecraft"
            ? { minecraftVersion: value }
            : { minecraftVersion, loaderVersion: value },
          loaderType,
        );
      } catch (caught) {
        if (mounted.current) setError(errorMessage(caught));
        setBusy(false);
        return;
      }
      if (mounted.current) setBusy(false);
    }
    stopEdit(field);
  };

  const editorKeys = (field: EditableField) => (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Closing the editor must not also close the card.
      event.preventDefault();
      event.stopPropagation();
      stopEdit(field);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void applyEdit(field);
    }
  };

  const pollJob = (jobId: string) => {
    pollTimer.current = window.setInterval(() => {
      getProvisioningJob(jobId)
        .then((current) => {
          if (current && mounted.current) setJob(current);
        })
        .catch(() => undefined);
    }, 500);
  };

  const finishJob = async (completed: ProvisioningJob) => {
    if (!mounted.current) return;
    setJob(completed);
    if (completed.stage === "ready") {
      await queryClient.invalidateQueries({ queryKey: serverKeys.profiles });
      onCreated(completed.serverId);
    }
  };

  const driveJob = async (work: () => Promise<ProvisioningJob>, id: string) => {
    pollJob(id);
    try {
      await finishJob(await work());
    } catch (caught) {
      if (!mounted.current) return;
      setError(errorMessage(caught));
      try {
        setJob(await getProvisioningJob(id));
      } catch {
        /* The command error above stays on screen. */
      }
    } finally {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      if (mounted.current) setBusy(false);
    }
  };

  /* The only place in the app flow where the EULA is accepted for a pack: the
     user pressed the button whose label and neighbouring text say so. */
  const packEula = detection?.packEulaAccepted === true;
  const agreeAndStart = async () => {
    if (!canConfirm || !plan || !loaderType || !plan.launchSpec) return;
    if (port === null || memoryMb === null || !javaPlan) return;
    setBusy(true);
    setError(null);
    setPhase("installing");
    try {
      let runtime = javaRuntime;
      if (!runtime) {
        setJavaDownloading(true);
        runtime = {
          ...(await installJavaRuntime(javaPlan, true)),
          validated: true,
        } as ValidatedJavaRuntime;
        if (mounted.current) {
          setJavaRuntime(runtime);
          setJavaDownloading(false);
        }
      }
      const name = detection?.name || plan.pack?.name || "Minecraft Server";
      const finalPlan: FinalProvisioningPlan = {
        ...plan,
        targetDir: await getDefaultServerRoot(name),
        profile: {
          name,
          loaderType,
          minecraftVersion,
          loaderVersion: loaderVersion || null,
          startAfterInstall: true,
          restartPolicy: {
            enabled: restartOnCrash,
            maxAttempts: 3,
            cooldownSeconds: 30,
          },
        },
        configuration: {
          ...BASE_CONFIGURATION,
          motd: name,
          serverPort: port,
          minMemoryMb: Math.min(1024, memoryMb),
          maxMemoryMb: memoryMb,
        },
        compatibilityWarnings: warnings,
        // Every warning is on screen in this card; confirming acknowledges them.
        acknowledgedWarningCodes: warnings
          .filter((warning) => warning.requiresAcknowledgement)
          .map((warning) => warning.code),
        keepPackSettings: true,
        eula: {
          accepted: true,
          termsUrl: MINECRAFT_EULA_URL,
          acceptedAt: new Date().toISOString(),
          ...(packEula ? { source: "pack" as const } : {}),
        },
        javaRuntime: runtime,
        launchSpec: { ...plan.launchSpec, validated: true },
      };
      const created = await createProvisioningJob(finalPlan);
      if (!mounted.current) return;
      setJob(created);
      await driveJob(() => runProvisioningJob(created.id), created.id);
    } catch (caught) {
      if (!mounted.current) return;
      setJavaDownloading(false);
      setError(errorMessage(caught));
      setBusy(false);
      setPhase("review");
    }
  };

  const retry = async (jobId: string) => {
    setBusy(true);
    setError(null);
    await driveJob(() => retryProvisioningJob(jobId), jobId);
  };

  const cancelJob = async (jobId: string) => {
    try {
      setJob(await cancelProvisioningJob(jobId));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const installing = phase === "installing";
  const requestClose = (next: boolean) => {
    if (next) return;
    // A running install is cancelled from its own button, not by Escape.
    if (installing && job?.stage !== "failed") return;
    onClose();
  };

  const listSeparator = language === "zh-CN" ? "、" : ", ";
  const warningText = (warning: PackWarning) => {
    if (!LOCALISED_WARNINGS.has(warning.code)) return warning.message;
    const params = warning.params ?? {};
    const others = Array.isArray(params.others)
      ? (params.others as { value: string; source: string }[])
          .map((other) => `${other.value} (${other.source})`)
          .join(listSeparator)
      : "";
    const list = (value: unknown) =>
      Array.isArray(value) ? value.slice(0, 5).join(listSeparator) : "";
    return t(`packDrop.warning.${warning.code}`, {
      chosen: params.chosen as string,
      chosenSource: params.chosenSource as string,
      others,
      value: params.value as string,
      source: params.source as string,
      version: params.version as string,
      count: params.count as number,
      checked: params.checked as number,
      inspected: params.inspected as number,
      total: params.total as number,
      loader: params.loader as string,
      wantMb: params.wantMb ? formatMemory(params.wantMb as number) : undefined,
      maxMb: params.maxMb ? formatMemory(params.maxMb as number) : undefined,
      totalMb: params.totalMb
        ? formatMemory(params.totalMb as number)
        : undefined,
      stated: params.stated as number,
      required: params.required as number,
      names: list(params.names),
      examples: list(params.examples),
      modCount: params.modCount as number,
    });
  };

  const header = (title: ReactNode, description: ReactNode) => (
    <header className="pack-drop-header">
      <ServerCover loaderType={loaderType} size={56} />
      <div>
        {title}
        {description}
      </div>
    </header>
  );

  const sizeLabel = formatBytes(detection?.sizeBytes ?? 0);
  const subtitle =
    phase === "reading"
      ? t("packDrop.reading")
      : detection
        ? t("packDrop.recognized", {
            kind: t(`packDrop.kind.${kind}`),
            size: sizeLabel,
          })
        : t("packDrop.readFailed");

  const row = (
    field: EditableField | "mods" | "java",
    label: string,
    value: ReactNode,
    options: { changeable?: boolean; onChange?: () => void } = {},
  ) => (
    <div className="pack-drop-row" key={field}>
      <dt>{label}</dt>
      <dd>
        {editing === field ? (
          <span className="pack-drop-editor">{editorFor(field as EditableField)}</span>
        ) : (
          <>
            <span className="pack-drop-value">{value}</span>
            {options.changeable ? (
              <button
                aria-label={`${t("packDrop.change")}: ${label}`}
                className="pack-drop-change"
                ref={(node) => {
                  if (node && field !== "mods" && field !== "java") {
                    changeButtons.current[field] = node;
                  }
                }}
                type="button"
                onClick={options.onChange}
              >
                {t("packDrop.change")}
              </button>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );

  const editorFor = (field: EditableField) => {
    if (field === "automation") {
      return (
        <>
          <label className="checkbox-row pack-drop-check">
            <input
              autoFocus
              checked={restartOnCrash}
              type="checkbox"
              onChange={(event) => setRestartOnCrash(event.target.checked)}
              onKeyDown={editorKeys(field)}
            />
            <span>{t("packDrop.automation.restartOn")}</span>
          </label>
          <Button variant="secondary" onClick={() => stopEdit(field)}>
            {t("packDrop.done")}
          </Button>
        </>
      );
    }
    const labelKey = {
      minecraft: "packDrop.row.minecraft",
      loader: "packDrop.edit.loaderVersion",
      memory: "packDrop.edit.memoryGb",
      port: "packDrop.row.port",
    }[field];
    return (
      <>
        <input
          aria-describedby={draftError ? "pack-drop-draft-error" : undefined}
          aria-invalid={draftError ? true : undefined}
          aria-label={t(labelKey)}
          autoFocus
          className="pack-drop-input"
          inputMode={field === "memory" || field === "port" ? "decimal" : "text"}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          onKeyDown={editorKeys(field)}
        />
        <Button
          disabled={busy}
          variant="secondary"
          onClick={() => void applyEdit(field)}
        >
          {t("packDrop.apply")}
        </Button>
        <Button variant="ghost" onClick={() => stopEdit(field)}>
          {t("common.cancel")}
        </Button>
        {draftError ? (
          <span className="pack-drop-field-error" id="pack-drop-draft-error" role="alert">
            {draftError}
          </span>
        ) : null}
      </>
    );
  };

  const modsValue = detection
    ? [
        t("packDrop.mods.count", { count: detection.modCount }),
        detection.modCheck.checked === 0
          ? t("packDrop.mods.unchecked")
          : detection.modCheck.incompatible === 0
            ? t("packDrop.mods.allMatch")
            : t("packDrop.mods.someMismatch", {
                count: detection.modCheck.incompatible,
                checked: detection.modCheck.checked,
                version: minecraftVersion,
              }),
      ].join(language === "zh-CN" ? "，" : ", ")
    : "";

  const javaValue = javaPlan
    ? javaPlan.action === "reuse"
      ? t("packDrop.java.have", { major: javaPlan.majorVersion })
      : t("packDrop.java.install", {
          major: javaPlan.majorVersion,
          vendor: javaPlan.vendor ?? "",
        })
    : plan?.requiredJavaMajor
      ? t("packDrop.java.pending")
      : t("packDrop.java.unknown");

  const memoryValue =
    memoryMb === null
      ? ""
      : memoryChosen
        ? t("packDrop.memory.chosen", { size: formatMemory(memoryMb) })
        : detection?.memory?.source === "pack"
          ? t("packDrop.memory.pack", {
              size: formatMemory(memoryMb),
              source: detection.memory.statedSource ?? "",
            })
          : t("packDrop.memory.recommended", {
              size: formatMemory(memoryMb),
              count: detection?.modCount ?? 0,
              total: detection?.memory?.totalMb
                ? formatMemory(detection.memory.totalMb)
                : "?",
            });

  const portValue =
    port === null
      ? ""
      : takenPorts.includes(port)
        ? t("packDrop.port.taken", { port })
        : portChosen
          ? t("packDrop.port.chosen", { port })
          : t("packDrop.port.free", { port });

  const evidence = detection?.evidence ?? [];
  const clientOnlyNames = detection?.clientOnlyMods.map((mod) => mod.name) ?? [];

  const body = (
    <div className="pack-drop-body">
      {phase === "reading" ? (
        <p className="pack-drop-status" role="status">
          {t("packDrop.reading")}
        </p>
      ) : null}
      {phase === "failed" ? (
        <div className="pack-drop-notice pack-drop-notice-danger" role="alert">
          <strong>{t("packDrop.readFailed")}</strong>
          <span>{error}</span>
          <span>{t("packDrop.readFailedNext")}</span>
        </div>
      ) : null}
      {phase === "review" && detection ? (
        <>
          <dl className="pack-drop-list">
            {row("minecraft", t("packDrop.row.minecraft"), (
              <span className="pack-drop-mono">
                {minecraftVersion || t("packDrop.unknown")}
              </span>
            ), {
              changeable: kind !== "bareJar",
              onChange: () => startEdit("minecraft"),
            })}
            {row("loader", t("packDrop.row.loader"), (
              <span className="pack-drop-mono">
                {loaderType
                  ? [loaderLabel(loaderType), loaderVersion].filter(Boolean).join(" ")
                  : t("packDrop.unknown")}
              </span>
            ), {
              changeable: Boolean(loaderType) && kind !== "bareJar",
              onChange: () => startEdit("loader"),
            })}
            {row("mods", t("packDrop.row.mods"), modsValue)}
            {row("java", t("packDrop.row.java"), javaValue, {
              changeable: Boolean(path),
              onChange: () => path && onOpenWizard(path),
            })}
            {row("memory", t("packDrop.row.memory"), memoryValue, {
              changeable: memoryMb !== null,
              onChange: () => startEdit("memory"),
            })}
            {row("port", t("packDrop.row.port"), portValue, {
              changeable: port !== null,
              onChange: () => startEdit("port"),
            })}
            {row(
              "automation",
              t("packDrop.row.automation"),
              restartOnCrash
                ? t("packDrop.automation.restartOn")
                : t("packDrop.automation.restartOff"),
              { changeable: true, onChange: () => startEdit("automation") },
            )}
          </dl>

          {evidence.length > 0 ? (
            <div className="pack-drop-evidence">
              <button
                aria-expanded={showEvidence}
                className="pack-drop-change"
                type="button"
                onClick={() => setShowEvidence((current) => !current)}
              >
                {t("packDrop.evidence.toggle", { count: evidence.length })}
              </button>
              {showEvidence ? (
                <ul>
                  {evidence.map((item, index) => (
                    <li key={`${item.field}-${item.source}-${index}`}>
                      <span>{t(`packDrop.evidence.field.${item.field}`)}</span>
                      <span className="pack-drop-mono">{item.value}</span>
                      <span>
                        {item.source}
                        {item.detail ? ` (${item.detail})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {blockedReason ? (
            <div className="pack-drop-notice pack-drop-notice-danger" role="alert">
              <span>{t(blockedReason)}</span>
              {detection.unfetchable.length > 0 ? (
                <ul className="pack-drop-missing">
                  {detection.unfetchable.slice(0, 8).map((mod) => (
                    <li key={`${mod.projectId}-${mod.fileId}`}>
                      {t("packDrop.unfetchable.item", {
                        project: mod.projectId,
                        file: mod.fileId,
                      })}
                    </li>
                  ))}
                  {detection.unfetchable.length > 8 ? (
                    <li>
                      {t("packDrop.unfetchable.more", {
                        count: detection.unfetchable.length - 8,
                      })}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}

          {warnings
            .filter((warning) => !(blockedReason && warning.code === "PACK_BARE_JAR"))
            .map((warning) => (
              <div className="pack-drop-notice pack-drop-notice-warning" key={warning.code}>
                <div>
                  <span>{warningText(warning)}</span>
                  {warning.code === "PACK_CLIENT_ONLY_MODS" ? (
                    <button
                      aria-expanded={expandedWarning === warning.code}
                      className="pack-drop-change"
                      type="button"
                      onClick={() =>
                        setExpandedWarning((current) =>
                          current === warning.code ? null : warning.code,
                        )
                      }
                    >
                      {t("packDrop.warning.view")}
                    </button>
                  ) : null}
                </div>
                {warning.code === "PACK_CLIENT_ONLY_MODS" &&
                expandedWarning === warning.code ? (
                  <ul className="pack-drop-missing">
                    {clientOnlyNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
        </>
      ) : null}

      {installing ? (
        <>
          {javaDownloading ? (
            <p className="pack-drop-status" role="status">
              {t("packDrop.javaDownloading", {
                major: javaPlan?.majorVersion ?? "",
              })}
            </p>
          ) : null}
          {job ? (
            <ProvisioningProgress
              busy={busy}
              job={job}
              onCancel={(jobId) => void cancelJob(jobId)}
              onRetry={(jobId) => void retry(jobId)}
            />
          ) : null}
          {job?.stage === "failed" ? (
            <p className="pack-drop-status">{t("packDrop.failedNext")}</p>
          ) : null}
        </>
      ) : null}

      {error && phase === "review" ? (
        <div className="pack-drop-notice pack-drop-notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      {error && installing ? (
        <div className="pack-drop-notice pack-drop-notice-danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );

  const showConsent = phase === "review" && !blockedReason;
  const footer = (
    <>
      {showConsent ? (
        <span className="pack-drop-eula">
          {packEula ? (
            t("packDrop.eula.fromPack")
          ) : (
            <>
              {t("packDrop.eula.before")}{" "}
              <a href={MINECRAFT_EULA_URL}>{t("packDrop.eula.link")}</a>
              {t("packDrop.eula.after")}
            </>
          )}
          {javaPlan?.action === "install" && !javaRuntime
            ? ` ${t("packDrop.eula.javaNote", { major: javaPlan.majorVersion })}`
            : ""}
        </span>
      ) : (
        <span className="pack-drop-eula" />
      )}
      {installing && job?.stage !== "failed" ? null : (
        <Button variant="secondary" onClick={onClose}>
          {installing ? t("common.close") : t("common.cancel")}
        </Button>
      )}
      {(phase === "failed" || blockedReason) && path ? (
        <Button variant="secondary" onClick={() => onOpenWizard(path)}>
          {t("packDrop.openWizard")}
        </Button>
      ) : null}
      {showConsent ? (
        <Button
          className="pack-drop-confirm"
          disabled={!canConfirm}
          variant="primary"
          onClick={() => void agreeAndStart()}
        >
          {packEula ? t("packDrop.confirmFromPack") : t("packDrop.confirm")}
        </Button>
      ) : null}
    </>
  );

  return (
    <DialogSurface
      className="pack-drop-dialog"
      description={subtitle}
      footer={footer}
      footerClassName="pack-drop-footer"
      header={({ title, description }) => header(title, description)}
      open={open}
      title={detection?.name || (path ? basename(path) : "")}
      onOpenChange={requestClose}
    >
      {body}
    </DialogSurface>
  );
}

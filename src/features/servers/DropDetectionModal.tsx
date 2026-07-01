import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FileArchive, FolderOpen, Package, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import { detectServerVersion, type DetectedServerInfo } from "./detectApi";
import type { CreateServerProfileInput, ServerProfile } from "./types";

type DetectionState = "analyzing" | "detected" | "failed";
type DetectedType =
  | "serverJar"
  | "modpack"
  | "plugin"
  | "serverFolder"
  | "zip"
  | "unknown";
type Confidence = "high" | "medium" | "low";

interface DetectionResult {
  type: DetectedType;
  loader: string | null;
  minecraftVersion: string | null;
  confidence: Confidence;
  fileName: string;
  isDirectory: boolean;
  serverInfo: DetectedServerInfo | null;
}

interface DropDetectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  droppedPaths: string[];
  servers: ServerProfile[];
  onCreateServer: (prefilledData: Partial<CreateServerProfileInput>) => void;
  onInstallContent: (serverId: string, filePath: string) => void;
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function inferTypeFromFilename(filename: string): {
  type: DetectedType;
  loader: string | null;
  confidence: Confidence;
} {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".mrpack")) {
    return { type: "modpack", loader: "fabric", confidence: "high" };
  }

  if (lower.endsWith(".jar")) {
    if (lower.includes("paper")) {
      return { type: "serverJar", loader: "paper", confidence: "high" };
    }
    if (lower.includes("spigot")) {
      return { type: "serverJar", loader: "paper", confidence: "medium" };
    }
    if (lower.includes("forge") && !lower.includes("neoforge")) {
      return { type: "serverJar", loader: "forge", confidence: "high" };
    }
    if (lower.includes("neoforge")) {
      return { type: "serverJar", loader: "neoForge", confidence: "high" };
    }
    if (lower.includes("fabric")) {
      return { type: "serverJar", loader: "fabric", confidence: "high" };
    }
    if (lower.includes("server") || lower.includes("vanilla")) {
      return { type: "serverJar", loader: "vanilla", confidence: "medium" };
    }
    return { type: "plugin", loader: null, confidence: "medium" };
  }

  if (lower.endsWith(".zip")) {
    return { type: "zip", loader: null, confidence: "low" };
  }

  // No extension likely means a directory
  return { type: "serverFolder", loader: null, confidence: "low" };
}

function extractVersionFromFilename(filename: string): string | null {
  const match = filename.match(
    /(\d+\.\d+(?:\.\d+)?)/,
  );
  return match?.[1] ?? null;
}

export function DropDetectionModal({
  open,
  onOpenChange,
  droppedPaths,
  servers,
  onCreateServer,
  onInstallContent,
}: DropDetectionModalProps) {
  const { t } = useAppSettings();
  const [state, setState] = useState<DetectionState>("analyzing");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [installTarget, setInstallTarget] = useState<string>("");

  const filePath = droppedPaths[0] ?? "";
  const fileName = getFileName(filePath);
  const isLikelyDirectory = !fileName.includes(".");

  const detectionQuery = useQuery({
    queryKey: ["detectServer", filePath],
    queryFn: () => detectServerVersion(filePath),
    enabled: open && isLikelyDirectory && filePath.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (!open || !filePath) return;

    if (isLikelyDirectory) {
      if (detectionQuery.isLoading) {
        setState("analyzing");
        return;
      }
      if (detectionQuery.data) {
        const info = detectionQuery.data;
        setResult({
          type: "serverFolder",
          loader: info.loaderType,
          minecraftVersion: info.minecraftVersion,
          confidence: info.hasServerProperties ? "high" : "medium",
          fileName,
          isDirectory: true,
          serverInfo: info,
        });
        setState("detected");
        return;
      }
      if (detectionQuery.error) {
        const inferred = inferTypeFromFilename(fileName);
        setResult({
          type: inferred.type,
          loader: inferred.loader,
          minecraftVersion: extractVersionFromFilename(fileName),
          confidence: "low",
          fileName,
          isDirectory: true,
          serverInfo: null,
        });
        setState("detected");
        return;
      }
    } else {
      const inferred = inferTypeFromFilename(fileName);
      setResult({
        type: inferred.type,
        loader: inferred.loader,
        minecraftVersion: extractVersionFromFilename(fileName),
        confidence: inferred.confidence,
        fileName,
        isDirectory: false,
        serverInfo: null,
      });
      setState("detected");
    }
  }, [open, filePath, isLikelyDirectory, detectionQuery.isLoading, detectionQuery.data, detectionQuery.error, fileName]);

  useEffect(() => {
    if (!open) {
      setState("analyzing");
      setResult(null);
      setInstallTarget("");
    }
  }, [open]);

  const typeLabel = result
    ? t(`drop.detect.type.${result.type}`)
    : "";
  const confidenceLabel = result
    ? t(`drop.detect.confidence.${result.confidence}`)
    : "";

  const isContentFile = result?.type === "plugin";
  const isServerSource =
    result?.type === "serverJar" ||
    result?.type === "serverFolder" ||
    result?.type === "modpack";

  const handleCreate = () => {
    if (!result) return;
    onCreateServer({
      source: result.isDirectory
        ? { kind: "existingFolder" }
        : result.type === "modpack"
          ? { kind: "localModpackFile", path: filePath }
          : { kind: "blank" },
      name: fileName.replace(/\.[^.]+$/, ""),
      rootDir: result.isDirectory ? filePath : "",
      loaderType: (result.loader as CreateServerProfileInput["loaderType"]) ?? "vanilla",
      minecraftVersion: result.minecraftVersion,
    });
    onOpenChange(false);
  };

  const handleInstall = () => {
    if (!installTarget || !filePath) return;
    onInstallContent(installTarget, filePath);
    onOpenChange(false);
  };

  const serverOptions: SelectOption[] = servers.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const TypeIcon = result?.isDirectory
    ? FolderOpen
    : result?.type === "modpack"
      ? Package
      : FileArchive;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="modal-dialog drop-detect-dialog">
          <div className="drop-detect-header">
            <Dialog.Title className="drop-detect-title">
              {t("drop.detect.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button aria-label={t("common.close")} variant="ghost" className="icon-button">
                <X aria-hidden="true" size={16} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="drop-detect-body">
            {state === "analyzing" ? (
              <div className="drop-detect-analyzing">
                <div className="loading-spinner">
                  <svg width="24" height="24" viewBox="0 0 24 24">
                    <rect className="spinner-block spinner-block-1" x="1" y="1" width="10" height="10" rx="2" />
                    <rect className="spinner-block spinner-block-2" x="13" y="1" width="10" height="10" rx="2" />
                    <rect className="spinner-block spinner-block-3" x="1" y="13" width="10" height="10" rx="2" />
                    <rect className="spinner-block spinner-block-4" x="13" y="13" width="10" height="10" rx="2" />
                  </svg>
                </div>
                <span>{t("drop.detect.analyzing")}</span>
              </div>
            ) : result ? (
              <>
                <div className="drop-detect-file">
                  <TypeIcon aria-hidden="true" size={20} />
                  <strong title={fileName}>{fileName}</strong>
                </div>

                <div className="drop-detect-result">
                  <div className="drop-detect-row">
                    <span>{t("drop.detect.label.type")}</span>
                    <strong>{typeLabel}</strong>
                  </div>
                  {result.loader ? (
                    <div className="drop-detect-row">
                      <span>{t("drop.detect.label.loader")}</span>
                      <strong>{result.loader}</strong>
                    </div>
                  ) : null}
                  {result.minecraftVersion ? (
                    <div className="drop-detect-row">
                      <span>{t("drop.detect.label.version")}</span>
                      <strong>{result.minecraftVersion}</strong>
                    </div>
                  ) : null}
                  <div className="drop-detect-row">
                    <span>{t("drop.detect.label.confidence")}</span>
                    <strong className={`drop-detect-confidence-${result.confidence}`}>
                      {confidenceLabel}
                    </strong>
                  </div>
                </div>

                {isServerSource ? (
                  <p className="drop-detect-recommended">
                    {t("drop.detect.recommended.createServer", {
                      loader: result.loader ?? "Vanilla",
                    })}
                  </p>
                ) : isContentFile ? (
                  <p className="drop-detect-recommended">
                    {t("drop.detect.recommended.installContent")}
                  </p>
                ) : null}

                <div className="drop-detect-actions">
                  {isServerSource ? (
                    <Button variant="primary" onClick={handleCreate}>
                      {t("drop.detect.action.create")}
                    </Button>
                  ) : null}
                  {isContentFile && servers.length > 0 ? (
                    <div className="drop-detect-install-row">
                      <Select
                        ariaLabel={t("drop.detect.action.selectServer")}
                        options={serverOptions}
                        value={installTarget}
                        onValueChange={setInstallTarget}
                        placeholder={t("drop.detect.action.selectServer")}
                      />
                      <Button
                        variant="secondary"
                        disabled={!installTarget}
                        onClick={handleInstall}
                      >
                        {t("drop.detect.action.install")}
                      </Button>
                    </div>
                  ) : null}
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>
                    {t("drop.detect.action.skip")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="drop-detect-failed">{t("drop.detect.failed")}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

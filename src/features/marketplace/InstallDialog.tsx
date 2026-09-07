import { useQueries } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";
import {
  getBbsmcProject,
  getHangarProject,
  getModrinthProject,
  type ProjectSummary,
  type ProjectVersion,
} from "./marketplaceApi";
import type { MarketplaceProvider } from "./providerBranding";
import { marketplaceKeys } from "./queries";

interface InstallDialogProps {
  project: ProjectSummary;
  version: ProjectVersion;
  error: string | null;
  isInstalling: boolean;
  installAnyway: boolean;
  onCancel: () => void;
  onInstallAnywayChange: (value: boolean) => void;
  onInstall: () => void;
  sourceLabel?: MarketplaceProvider;
}

function getDependencyProject(
  provider: MarketplaceProvider,
  projectId: string,
) {
  if (provider === "BBSMC") return getBbsmcProject(projectId);
  if (provider === "Hangar") return getHangarProject(projectId);
  return getModrinthProject(projectId);
}

export function InstallDialog({
  project,
  version,
  error,
  isInstalling,
  installAnyway,
  onCancel,
  onInstallAnywayChange,
  onInstall,
  sourceLabel = "Modrinth",
}: InstallDialogProps) {
  const { t } = useAppSettings();
  const requiresInstallAnyway = version.warnings.length > 0;
  const dependencyProjectIds = [
    ...new Set(
      version.dependencies.flatMap((dependency) =>
        dependency.projectId ? [dependency.projectId] : [],
      ),
    ),
  ];
  const dependencyQueries = useQueries({
    queries: dependencyProjectIds.map((projectId) => ({
      queryKey: marketplaceKeys.project(sourceLabel, projectId),
      queryFn: () => getDependencyProject(sourceLabel, projectId),
      retry: false,
    })),
  });
  const dependencyQueryByProjectId = new Map(
    dependencyProjectIds.map((projectId, index) => [
      projectId,
      dependencyQueries[index],
    ]),
  );
  const dependencyLabel = (dependencyType: string) => {
    if (dependencyType === "required")
      return t("marketplace.dependency.required");
    if (dependencyType === "optional")
      return t("marketplace.dependency.optional");
    if (dependencyType === "incompatible") {
      return t("marketplace.dependency.incompatible");
    }
    return t("marketplace.dependency.other");
  };

  return (
    <DialogSurface
      open
      className="marketplace-install-dialog"
      title={t("marketplace.install.title", { title: project.title })}
      description={t("marketplace.install.description", {
        version: version.versionNumber,
        source: sourceLabel,
      })}
      onOpenChange={(open) => !open && onCancel()}
      footer={
        <>
          <Button
            disabled={isInstalling}
            variant="secondary"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isInstalling || (requiresInstallAnyway && !installAnyway)}
            variant="primary"
            onClick={onInstall}
          >
            <Download aria-hidden="true" size={15} />
            {isInstalling
              ? t("marketplace.install.installing")
              : error
                ? t("marketplace.install.retry")
                : t("marketplace.install.button")}
          </Button>
        </>
      }
    >
      {version.dependencies.length > 0 ? (
        <div className="marketplace-install-note">
          <strong>{t("marketplace.install.dependencies")}</strong>
          <span>{t("marketplace.install.dependenciesDescription")}</span>
          <ul className="marketplace-dependency-list">
            {version.dependencies.map((dependency, index) => (
              <li
                key={`${dependency.projectId ?? dependency.versionId ?? "dependency"}-${index}`}
              >
                <span className="marketplace-dependency-identity">
                  <strong>
                    {dependency.projectId
                      ? (dependencyQueryByProjectId.get(dependency.projectId)
                          ?.data?.title ??
                        (dependencyQueryByProjectId.get(dependency.projectId)
                          ?.isLoading
                          ? t("marketplace.dependency.resolving")
                          : t("marketplace.dependency.unresolved")))
                      : t("marketplace.dependency.unresolved")}
                  </strong>
                  <small>
                    {[dependency.projectId, dependency.versionId]
                      .filter(Boolean)
                      .join(" / ") || t("common.unknown")}
                  </small>
                </span>
                <span>{dependencyLabel(dependency.dependencyType)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {requiresInstallAnyway ? (
        <label className="marketplace-install-confirm">
          <Checkbox
            checked={installAnyway}
            disabled={isInstalling}
            onCheckedChange={(checked) =>
              onInstallAnywayChange(checked === true)
            }
          />
          <span>{t("marketplace.install.reviewWarnings")}</span>
        </label>
      ) : null}
      {version.warnings.length > 0 ? (
        <p className="danger-text">{version.warnings.join("; ")}</p>
      ) : null}
      {error ? (
        <div className="inline-error" role="alert">
          <strong>{t("marketplace.install.failed")}</strong>
          <span>{error}</span>
          <span>{t("marketplace.install.recovery")}</span>
        </div>
      ) : null}
    </DialogSurface>
  );
}

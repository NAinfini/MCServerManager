import * as Dialog from "@radix-ui/react-dialog";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { useAppSettings } from "../../i18n";
import type { ProjectSummary, ProjectVersion } from "./marketplaceApi";

interface InstallDialogProps {
  project: ProjectSummary;
  version: ProjectVersion;
  error: string | null;
  isInstalling: boolean;
  installAnyway: boolean;
  onCancel: () => void;
  onInstallAnywayChange: (value: boolean) => void;
  onInstall: () => void;
  sourceLabel?: string;
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

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="inline-dialog modal-dialog marketplace-install-dialog"
          aria-describedby="marketplace-install-description"
        >
          <div>
            <Dialog.Title>
              {t("marketplace.install.title", { title: project.title })}
            </Dialog.Title>
            <Dialog.Description id="marketplace-install-description">
              {t("marketplace.install.description", {
                version: version.versionNumber,
                source: sourceLabel,
              })}
            </Dialog.Description>
          </div>
          {version.dependencies.length > 0 ? (
            <div className="marketplace-install-note">
              <strong>{t("marketplace.install.dependencies")}</strong>
              <span>
                {version.dependencies
                  .map(
                    (dependency) =>
                      `${dependency.dependencyType}: ${
                        dependency.projectId ?? t("common.unknown")
                      }`,
                  )
                  .join("; ")}
              </span>
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
          {error ? <p className="danger-text">{error}</p> : null}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button disabled={isInstalling} variant="secondary">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              disabled={
                isInstalling || (requiresInstallAnyway && !installAnyway)
              }
              variant="primary"
              onClick={onInstall}
            >
              <Download aria-hidden="true" size={15} />
              {t("marketplace.install.button")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

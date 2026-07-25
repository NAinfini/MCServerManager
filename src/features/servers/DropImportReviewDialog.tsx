import { Archive, FileArchive, FileCode2, FolderOpen, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";

interface DropImportReviewDialogProps {
  open: boolean;
  paths: string[];
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}

type DropImportKind = "modrinthPack" | "archive" | "jar" | "folder";

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function detectKind(path: string): DropImportKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mrpack")) return "modrinthPack";
  if (lower.endsWith(".zip")) return "archive";
  if (lower.endsWith(".jar")) return "jar";
  return "folder";
}

const kindIcon = {
  modrinthPack: Archive,
  archive: FileArchive,
  jar: FileCode2,
  folder: FolderOpen,
} satisfies Record<DropImportKind, typeof Archive>;

export function DropImportReviewDialog({
  open,
  paths,
  onOpenChange,
  onContinue,
}: DropImportReviewDialogProps) {
  const { t } = useAppSettings();
  const primaryPath = paths[0] ?? "";
  const kind = detectKind(primaryPath);
  const Icon = kindIcon[kind];

  return (
    <DialogSurface
      open={open}
      className="drop-import-review-dialog"
      description={t("dropImport.review.description")}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={paths.length !== 1} type="button" onClick={onContinue}>
            {t("dropImport.review.continue")}
          </Button>
        </>
      }
      title={t("dropImport.review.title")}
      onOpenChange={onOpenChange}
      header={({ description, title }) => (
        <div className="create-server-dialog-header">
          <div>
            {title}
            {description}
          </div>
          <Button
            aria-label={t("dropImport.review.close")}
            className="icon-button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" size={16} />
          </Button>
        </div>
      )}
    >
          <div className="drop-import-review-body">
            <div className="drop-import-detected">
              <span className="drop-import-detected-icon">
                <Icon aria-hidden="true" size={24} />
              </span>
              <div>
                <strong>{basename(primaryPath)}</strong>
                <span>{t(`dropImport.kind.${kind}`)}</span>
              </div>
            </div>
            <div className="drop-import-review-grid">
              <div>
                <span>{t("dropImport.review.confidence")}</span>
                <strong>{t("dropImport.review.confidenceValue")}</strong>
              </div>
              <div>
                <span>{t("dropImport.review.action")}</span>
                <strong>{t(`dropImport.action.${kind}`)}</strong>
              </div>
            </div>
            <p className="drop-import-review-note">
              {paths.length > 1
                ? t("provisioning.wizard.dropSingle")
                : t("dropImport.review.note")}
            </p>
          </div>
    </DialogSurface>
  );
}

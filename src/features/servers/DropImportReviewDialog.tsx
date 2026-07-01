import * as Dialog from "@radix-ui/react-dialog";
import { Archive, FileArchive, FileCode2, FolderOpen, X } from "lucide-react";
import { Button } from "../../components/ui/button";
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="modal-dialog drop-import-review-dialog">
          <div className="create-server-dialog-header">
            <div>
              <Dialog.Title asChild>
                <h2>{t("dropImport.review.title")}</h2>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p>{t("dropImport.review.description")}</p>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label={t("dropImport.review.close")}
                className="icon-button"
                variant="ghost"
              >
                <X aria-hidden="true" size={16} />
              </Button>
            </Dialog.Close>
          </div>
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
              {t("dropImport.review.note")}
            </p>
          </div>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={onContinue}>
              {t("dropImport.review.continue")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

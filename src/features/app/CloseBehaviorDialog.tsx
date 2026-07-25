import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";

type CloseBehaviorDialogProps = {
  isOpen: boolean;
  operationError?: string | null;
  runningServerCount: number | null;
  onCancel: () => void;
  onMinimizeToTray: () => void;
  onQuit: () => void;
};

export function CloseBehaviorDialog({
  isOpen,
  operationError,
  runningServerCount,
  onCancel,
  onMinimizeToTray,
  onQuit,
}: CloseBehaviorDialogProps) {
  const { t } = useAppSettings();
  const hasRunningServers =
    runningServerCount !== null && runningServerCount > 0;
  const hasUnknownRuntimeStatus = runningServerCount === null;

  return (
    <DialogSurface
      open={isOpen}
      className="close-dialog"
      description={t("close.description")}
      footer={
        <>
          <Button variant="secondary" onClick={onMinimizeToTray}>
            {t("close.minimize")}
          </Button>
          <Button variant="danger" onClick={onQuit}>
            {t("close.quit")}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </>
      }
      footerClassName="close-dialog-actions"
      title={t("close.title")}
      onOpenChange={(open) => !open && onCancel()}
      header={({ description, title }) => (
        <div className="close-dialog-copy">
          <p className="eyebrow">{t("close.eyebrow")}</p>
          {title}
          {description}
          {hasUnknownRuntimeStatus ? (
            <p className="close-dialog-runtime-note">
              {t("close.unknownRuntime")}
            </p>
          ) : null}
          {hasRunningServers ? (
            <p className="close-dialog-warning" role="alert">
              {t(
                runningServerCount === 1
                  ? "close.runningWarning.one"
                  : "close.runningWarning.many",
                {
                  count: runningServerCount ?? 0,
                },
              )}
            </p>
          ) : null}
          {operationError ? (
            <p className="close-dialog-error" role="alert">
              {operationError}
            </p>
          ) : null}
        </div>
      )}
    />
  );
}

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../../components/ui/button";
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
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AnimatePresence>
        {isOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                className="dialog-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby="close-behavior-description"
            >
              <motion.section
                className="close-dialog"
                initial={{ opacity: 0, scale: 0.98, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 8 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <div className="close-dialog-copy">
                  <p className="eyebrow">{t("close.eyebrow")}</p>
                  <Dialog.Title id="close-behavior-title">
                    {t("close.title")}
                  </Dialog.Title>
                  <Dialog.Description id="close-behavior-description">
                    {t("close.description")}
                  </Dialog.Description>
                  {hasUnknownRuntimeStatus ? (
                    <p className="close-dialog-runtime-note">
                      {t("close.unknownRuntime")}
                    </p>
                  ) : null}
                  {hasRunningServers ? (
                    <p className="close-dialog-warning" role="alert">
                      {t(runningServerCount === 1
                        ? "close.runningWarning.one"
                        : "close.runningWarning.many", {
                        count: runningServerCount ?? 0,
                      })}
                    </p>
                  ) : null}
                  {operationError ? (
                    <p className="close-dialog-error" role="alert">
                      {operationError}
                    </p>
                  ) : null}
                </div>
                <div className="close-dialog-actions">
                  <Button variant="secondary" onClick={onMinimizeToTray}>
                    {t("close.minimize")}
                  </Button>
                  <Button variant="danger" onClick={onQuit}>
                    {t("close.quit")}
                  </Button>
                  <Dialog.Close asChild>
                    <Button variant="ghost">{t("common.cancel")}</Button>
                  </Dialog.Close>
                </div>
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

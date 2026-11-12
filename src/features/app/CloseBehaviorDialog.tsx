import { Stack, Text } from "@mantine/core";
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
      title={t("close.title")}
      onOpenChange={(open) => !open && onCancel()}
      header={({ description, title }) => (
        <Stack gap={4}>
          <Text c="dimmed" fw={600} size="xs">
            {t("close.eyebrow")}
          </Text>
          {title}
          {description}
          {hasUnknownRuntimeStatus ? (
            <Text c="dimmed" mt="xs" size="sm">
              {t("close.unknownRuntime")}
            </Text>
          ) : null}
          {hasRunningServers ? (
            <Text c="yellow" mt="xs" role="alert" size="sm">
              {t(
                runningServerCount === 1
                  ? "close.runningWarning.one"
                  : "close.runningWarning.many",
                {
                  count: runningServerCount ?? 0,
                },
              )}
            </Text>
          ) : null}
          {operationError ? (
            <Text c="red" mt="xs" role="alert" size="sm">
              {operationError}
            </Text>
          ) : null}
        </Stack>
      )}
    />
  );
}

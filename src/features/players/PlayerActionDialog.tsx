import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";
import type { PlayerAction, PlayerSummary } from "./api";

interface PlayerActionDialogProps {
  action: PlayerAction;
  player: PlayerSummary;
  serverName: string;
  isSubmitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const actionLabelKeys: Record<PlayerAction, string> = {
  op: "players.dialog.op",
  deop: "players.dialog.deop",
  ban: "players.dialog.ban",
  pardon: "players.dialog.pardon",
  kick: "players.dialog.kick",
  whitelistAdd: "players.dialog.whitelistAdd",
  whitelistRemove: "players.dialog.whitelistRemove",
  banIp: "players.dialog.banIp",
  pardonIp: "players.dialog.pardonIp",
};

function actionCopy(
  action: PlayerAction,
  player: PlayerSummary,
  serverName: string,
  t: (key: string, values?: Record<string, string>) => string,
) {
  return t(`players.confirm.${action}`, {
    player: player.username,
    server: serverName,
  });
}

export function PlayerActionDialog({
  action,
  player,
  serverName,
  isSubmitting = false,
  error = null,
  onCancel,
  onConfirm,
}: PlayerActionDialogProps) {
  const { t } = useAppSettings();

  return (
    <DialogSurface
      open
      title={t(actionLabelKeys[action])}
      description={actionCopy(action, player, serverName, t)}
      onOpenChange={(open) => !open && onCancel()}
      footer={
        <>
          <Button disabled={isSubmitting} variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            variant={
              action === "ban" || action === "banIp" || action === "kick"
                ? "danger"
                : "primary"
            }
            onClick={onConfirm}
          >
            {isSubmitting
              ? t("players.dialog.sending")
              : t(actionLabelKeys[action])}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
    </DialogSurface>
  );
}

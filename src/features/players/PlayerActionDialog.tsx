import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "../../components/ui/button";
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
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="inline-dialog modal-dialog"
          aria-describedby="player-action-description"
        >
          <div>
            <Dialog.Title>{t(actionLabelKeys[action])}</Dialog.Title>
            <Dialog.Description id="player-action-description">
              {actionCopy(action, player, serverName, t)}
            </Dialog.Description>
          </div>
          {error ? (
            <div className="inline-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button disabled={isSubmitting} variant="ghost">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              disabled={isSubmitting}
              variant={
                action === "ban" || action === "kick" ? "danger" : "primary"
              }
              onClick={onConfirm}
            >
              {isSubmitting ? t("players.dialog.sending") : t(actionLabelKeys[action])}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

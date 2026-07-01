import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserX,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import { useAppSettings } from "../../i18n";
import { getServerProcessStatus } from "../process/api";
import type { ServerProfile } from "../servers/types";
import {
  applyPlayerAction,
  listPlayers,
  type PlayerAction,
  type PlayerSummary,
} from "./api";
import { PlayerActionDialog } from "./PlayerActionDialog";
import { PlayerListsView } from "./PlayerListsView";

interface PlayersViewProps {
  server: ServerProfile;
}

interface PendingAction {
  player: PlayerSummary;
  action: PlayerAction;
}

const playerActions: Array<{
  action: PlayerAction;
  labelKey: string;
  icon: typeof Shield;
}> = [
  { action: "op", labelKey: "players.action.op", icon: Shield },
  { action: "deop", labelKey: "players.action.deop", icon: ShieldOff },
  { action: "ban", labelKey: "players.action.ban", icon: UserX },
  { action: "pardon", labelKey: "players.action.pardon", icon: UserMinus },
  { action: "kick", labelKey: "players.action.kick", icon: X },
  { action: "whitelistAdd", labelKey: "players.action.whitelistAdd", icon: ShieldCheck },
  { action: "whitelistRemove", labelKey: "players.action.whitelistRemove", icon: ShieldOff },
];

function statusText(player: PlayerSummary, t: (key: string) => string) {
  const states = [
    player.online ? t("players.state.online") : t("players.state.offline"),
    player.operator ? t("players.state.operator") : null,
    player.whitelisted ? t("players.state.whitelisted") : null,
    player.banned ? t("players.state.banned") : null,
  ].filter(Boolean);

  return states.join(" / ");
}

export function PlayersView({ server }: PlayersViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const playersQuery = useQuery({
    queryKey: ["players", server.id],
    queryFn: () => listPlayers(server.id),
    refetchInterval: 3000,
  });
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", server.id],
    queryFn: () => getServerProcessStatus(server.id),
    refetchInterval: 1500,
  });
  const processStatus = processQuery.data?.status ?? "stopped";
  const canSendActions =
    processStatus === "running" && Boolean(playersQuery.data?.actionsAvailable);
  const actionMutation = useMutation({
    mutationFn: (input: PendingAction) =>
      applyPlayerAction({
        serverId: server.id,
        player: input.player.username,
        action: input.action,
      }),
    onSuccess: async () => {
      setPendingAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["players", server.id] }),
        queryClient.invalidateQueries({
          queryKey: ["processEvents", server.id],
        }),
      ]);
    },
  });

  if (playersQuery.isLoading) {
    return <LoadingState message={t("players.loading")} />;
  }

  if (playersQuery.error) {
    return (
      <section className="players-panel" aria-label={t("server.tabs.players")}>
        <div className="list-state list-state-error">
          <strong>{t("players.loadError.title")}</strong>
          <span>{playersQuery.error.message}</span>
        </div>
        <PlayerListsView server={server} />
      </section>
    );
  }

  const players = playersQuery.data?.players ?? [];

  return (
    <section className="players-panel" aria-label={t("server.tabs.players")}>
      <div className="players-toolbar">
        <div>
          <strong>{t("players.knownCount", { count: players.length })}</strong>
          <span>
            {playersQuery.data?.unavailableReason ??
              t("players.actionsThroughStdin")}
          </span>
        </div>
        <StatusBadge status={processStatus} />
      </div>

      {pendingAction ? (
        <PlayerActionDialog
          action={pendingAction.action}
          error={actionMutation.error?.message ?? null}
          isSubmitting={actionMutation.isPending}
          player={pendingAction.player}
          serverName={server.name}
          onCancel={() => {
            actionMutation.reset();
            setPendingAction(null);
          }}
          onConfirm={() => actionMutation.mutate(pendingAction)}
        />
      ) : null}

      {players.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-players.png"
          title={t("players.empty.title")}
          description={t("players.empty.description")}
        />
      ) : (
        <div className="players-table-scroll">
          <table className="players-table">
            <thead>
              <tr>
                <th scope="col">{t("players.table.player")}</th>
                <th scope="col">{t("players.table.uuid")}</th>
                <th scope="col">{t("players.table.state")}</th>
                <th scope="col">{t("players.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.uuid ?? player.username}>
                  <th scope="row">{player.username}</th>
                  <td>{player.uuid ?? t("players.state.unknown")}</td>
                  <td>{statusText(player, t)}</td>
                  <td>
                    <div className="player-actions">
                      {playerActions.map(({ action, labelKey, icon: Icon }) => {
                        const label = t(labelKey);
                        return (
                        <Button
                          key={action}
                          aria-label={`${label} ${player.username}`}
                          disabled={!canSendActions || actionMutation.isPending}
                          title={
                            canSendActions
                              ? label
                              : t("players.action.disabledTitle")
                          }
                          variant={
                            action === "ban" || action === "kick"
                              ? "danger"
                              : "ghost"
                          }
                          onClick={() => {
                            actionMutation.reset();
                            setPendingAction({ player, action });
                          }}
                        >
                          <Icon aria-hidden="true" size={14} />
                        </Button>
                      );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PlayerListsView server={server} />
    </section>
  );
}

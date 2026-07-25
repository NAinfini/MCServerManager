import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Plus,
  UserMinus,
  UserX,
  X,
} from "lucide-react";
import { AttentionBar } from "../../components/ui/attention-bar";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { PlayerHead } from "../../components/ui/player-head";
import { navigateTo } from "../../app/router";
import { LoadingState } from "../../components/ui/loading-state";
import { StatusBadge } from "../../components/ui/status-badge";
import { TextField } from "../../components/ui/text-field";
import { DataTable, type DataTableColumn } from "../../components/data/DataTable";
import { useAppSettings } from "../../i18n";
import { processKeys } from "../process/queries";
import type { ServerProfile } from "../../domain/server";
import {
  applyPlayerChange,
  listPlayers,
  type PlayerAction,
  type PlayerSummary,
} from "./api";
import { PlayerActionDialog } from "./PlayerActionDialog";
import { playerKeys } from "./queries";
import { useServerRuntime } from "../servers/ServerRuntimeContext";

interface PlayersViewProps {
  server: ServerProfile;
  view?: "online" | "ops" | "whitelist" | "bans";
}

interface PendingAction {
  player: PlayerSummary;
  action: PlayerAction;
}

const playerActionDefinitions: Record<PlayerAction, {
  action: PlayerAction;
  labelKey: string;
  icon: typeof Shield;
}> = {
  op: { action: "op", labelKey: "players.action.op", icon: Shield },
  deop: { action: "deop", labelKey: "players.action.deop", icon: ShieldOff },
  ban: { action: "ban", labelKey: "players.action.ban", icon: UserX },
  pardon: { action: "pardon", labelKey: "players.action.pardon", icon: UserMinus },
  kick: { action: "kick", labelKey: "players.action.kick", icon: X },
  whitelistAdd: { action: "whitelistAdd", labelKey: "players.action.whitelistAdd", icon: ShieldCheck },
  whitelistRemove: { action: "whitelistRemove", labelKey: "players.action.whitelistRemove", icon: ShieldOff },
  banIp: { action: "banIp", labelKey: "players.action.banIp", icon: UserX },
  pardonIp: { action: "pardonIp", labelKey: "players.action.pardonIp", icon: UserMinus },
};

function actionsFor(player: PlayerSummary): PlayerAction[] {
  if (player.kind === "ip") return ["pardonIp"];
  return [
    player.operator ? "deop" : "op",
    player.whitelisted ? "whitelistRemove" : "whitelistAdd",
    player.banned ? "pardon" : "ban",
    ...(player.online ? (["kick"] as const) : []),
  ];
}

function statusText(player: PlayerSummary, t: (key: string) => string) {
  const states = [
    player.online ? t("players.state.online") : t("players.state.offline"),
    player.operator ? t("players.state.operator") : null,
    player.whitelisted ? t("players.state.whitelisted") : null,
    player.banned ? t("players.state.banned") : null,
  ].filter(Boolean);

  return states.join(" / ");
}

export function PlayersView({ server, view }: PlayersViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const runtime = useServerRuntime();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [newPlayer, setNewPlayer] = useState("");
  const playersQuery = useQuery({
    queryKey: playerKeys.list(server.id),
    queryFn: () => listPlayers(server.id),
  });
  const processStatus = runtime.status;
  const canApplyActions = Boolean(playersQuery.data?.actionsAvailable);
  const actionMutation = useMutation({
    mutationFn: (input: PendingAction) =>
      applyPlayerChange({
        serverId: server.id,
        player: input.player.username,
        action: input.action,
        uuid: input.player.uuid,
      }),
    onSuccess: async () => {
      setPendingAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: playerKeys.list(server.id) }),
        queryClient.invalidateQueries({
          queryKey: processKeys.events(server.id),
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
        <div className="list-state list-state-error" role="alert">
          <strong>{t("players.loadError.title")}</strong>
          <span>{playersQuery.error.message}</span>
          <Button variant="secondary" onClick={() => playersQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      </section>
    );
  }

  const allPlayers = playersQuery.data?.players ?? [];
  const whitelistEnabled = playersQuery.data?.whitelistEnabled ?? false;
  const players = allPlayers.filter((player) => {
    if (!view) return true;
    if (view === "online") return player.online;
    if (view === "ops") return player.operator;
    if (view === "whitelist") return player.whitelisted;
    return player.banned;
  });
  const addAction: PlayerAction =
    view === "ops"
      ? "op"
      : view === "whitelist"
        ? "whitelistAdd"
        : newPlayer.includes(".")
          ? "banIp"
          : "ban";
  const columns: DataTableColumn<PlayerSummary>[] = [
    {
      id: "player",
      header: t("players.table.player"),
      rowHeader: true,
      cellClassName: "player-identity-cell",
      cell: (player) =>
        player.kind === "ip" ? (
          player.username
        ) : (
          <span className="player-identity">
            <PlayerHead username={player.username} uuid={player.uuid} />
            {player.username}
          </span>
        ),
    },
    { id: "uuid", header: t("players.table.uuid"), cell: (player) => player.uuid ?? t("players.state.unknown") },
    { id: "state", header: t("players.table.state"), cell: (player) => statusText(player, t) },
    { id: "actions", header: t("players.table.actions"), cell: (player) => <div className="player-actions">{actionsFor(player).map((action) => { const { labelKey, icon: Icon } = playerActionDefinitions[action]; const label = t(labelKey); const disabled = !canApplyActions || actionMutation.isPending || (action === "kick" && processStatus !== "running"); return <Button key={action} aria-label={`${label} ${player.username}`} className="icon-button" disabled={disabled} title={disabled ? t("players.action.disabledTitle") : label} variant={action === "ban" || action === "banIp" || action === "kick" ? "danger" : "ghost"} onClick={() => { actionMutation.reset(); setPendingAction({ player, action }); }}><Icon aria-hidden="true" size={14} /></Button>; })}</div> },
  ];

  return (
    <section className="players-panel" aria-label={t("server.tabs.players")}>
      <div className="players-toolbar">
        <div>
          <strong>{t("players.knownCount", { count: players.length })}</strong>
          <span>{processStatus === "running" ? t("players.actionsThroughStdin") : t("players.offlineChange")}</span>
        </div>
        <div className="players-toolbar-actions">
          {view && view !== "online" ? (
            <form
              className="players-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                const player = newPlayer.trim();
                if (!player) return;
                setPendingAction({
                  player: {
                    username: player,
                    kind: addAction === "banIp" ? "ip" : "player",
                    online: false,
                    operator: false,
                    whitelisted: false,
                    banned: false,
                  },
                  action: addAction,
                });
                setNewPlayer("");
              }}
            >
              <TextField
                aria-label={t("players.add.placeholder")}
                placeholder={t("players.add.placeholder")}
                value={newPlayer}
                onChange={(event) => setNewPlayer(event.target.value)}
              />
              <Button disabled={!newPlayer.trim()} type="submit" variant="secondary">
                <Plus aria-hidden="true" size={14} />
                {t("players.add.submit")}
              </Button>
            </form>
          ) : null}
          <StatusBadge status={processStatus} />
        </div>
      </div>

      {view === "whitelist" && !whitelistEnabled ? (
        <AttentionBar className="players-whitelist-notice" tone="info">
          <div>
            <strong>{t("players.whitelistOff.title")}</strong>
            <span>{t("players.whitelistOff.description")}</span>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              navigateTo({
                name: "server",
                serverId: server.id,
                section: "settings",
                view: "properties",
              })
            }
          >
            {t("players.whitelistOff.action")}
          </Button>
        </AttentionBar>
      ) : null}

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
          title={
            view === "online"
              ? t("players.onlineEmpty.title")
              : view === "whitelist"
                ? t("players.whitelistEmpty.title")
                : t("players.empty.title")
          }
          description={
            view === "online"
              ? t("players.onlineEmpty.description")
              : view === "whitelist"
                ? whitelistEnabled
                  ? t("players.whitelistEmpty.enforced")
                  : t("players.whitelistEmpty.description")
                : t("players.empty.description")
          }
        />
      ) : (
        <div className="players-table-scroll">
          <DataTable caption={t("players.title")} className="players-table" columns={columns} getRowKey={(player) => player.uuid ?? player.username} rows={players} />
        </div>
      )}
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { listPlayers } from "./api";
import { playerKeys } from "./queries";

/**
 * Shares the players query already issued by PlayersView, so the workspace view
 * switcher can label each segment without a second IPC round trip.
 */
export function usePlayerViewCounts(
  serverId: string,
  enabled: boolean,
): Record<string, number> | null {
  const playersQuery = useQuery({
    queryKey: playerKeys.list(serverId),
    queryFn: () => listPlayers(serverId),
    enabled,
  });

  if (!playersQuery.data) return null;

  const players = playersQuery.data.players;
  return {
    online: players.filter((player) => player.online).length,
    ops: players.filter((player) => player.operator).length,
    whitelist: players.filter((player) => player.whitelisted).length,
    bans: players.filter((player) => player.banned).length,
  } satisfies Record<string, number>;
}

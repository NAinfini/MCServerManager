import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export type PlayerAction =
  | "op"
  | "deop"
  | "ban"
  | "pardon"
  | "kick"
  | "whitelistAdd"
  | "whitelistRemove";

export interface PlayerSummary {
  username: string;
  uuid?: string | null;
  online: boolean;
  operator: boolean;
  whitelisted: boolean;
  banned: boolean;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface PlayerState {
  serverId: string;
  players: PlayerSummary[];
  actionsAvailable: boolean;
  unavailableReason?: string | null;
}

export interface PlayerActionInput {
  serverId: string;
  player: string;
  action: PlayerAction;
}

export interface PlayerActionResult {
  commandSent: string;
}

export interface PlayerListEntry {
  name?: string | null;
  uuid?: string | null;
  ip?: string | null;
  reason?: string | null;
  created?: string | null;
  source?: string | null;
  expires?: string | null;
  level?: number | null;
  bypassesPlayerLimit?: boolean | null;
  extra?: Record<string, unknown>;
}

export interface PlayerListDocument {
  listType: string;
  fileName: string;
  entries: PlayerListEntry[];
  error?: string | null;
}

export interface PlayerListsState {
  serverId: string;
  lists: PlayerListDocument[];
}

export function listPlayers(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<PlayerState>("list_players", { serverId });
}

export function applyPlayerAction(input: PlayerActionInput) {
  return invokeDesktopCommandWithErrorHandling<PlayerActionResult>("apply_player_action", {
    input,
  });
}

export function readPlayerLists(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<PlayerListsState>("read_player_lists", {
    serverId,
  });
}

export function savePlayerList(input: {
  serverId: string;
  listType: string;
  entries: PlayerListEntry[];
}) {
  return invokeDesktopCommandWithErrorHandling<PlayerListDocument>("save_player_list", { input });
}

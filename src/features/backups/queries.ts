import { queryKeys } from "../../lib/query-keys";

export const backupKeys = {
  ...queryKeys.backups,
  // Under the list key, so refreshing the list refreshes the status line too.
  status: (serverId: string) => ["backups", serverId, "status"] as const,
};

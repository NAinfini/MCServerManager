import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";

export interface AttentionItem {
  id: string;
  serverId: string;
  serverName: string;
  kind: "crash" | "update" | "backup";
  severity: "error" | "warning" | "info";
  createdAt: string | null;
}

export const attentionKeys = queryKeys.attention;

export function getAttentionItems() {
  return invokeDesktopCommandWithErrorHandling<AttentionItem[]>(
    "get_attention_items",
  );
}

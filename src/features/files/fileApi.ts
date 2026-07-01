import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface ServerFileEntry {
  name: string;
  relativePath: string;
  kind: "directory" | "file";
  sizeBytes: number;
  modifiedAt?: string | null;
  editable: boolean;
}

export interface ServerTextFile {
  relativePath: string;
  content: string;
  sizeBytes: number;
  readOnly: boolean;
  warning?: string | null;
}

export function listServerFiles(serverId: string, relativePath = "") {
  return invokeDesktopCommandWithErrorHandling<ServerFileEntry[]>("list_server_files", {
    serverId,
    relativePath,
  });
}

export function readServerTextFile(serverId: string, relativePath: string) {
  return invokeDesktopCommandWithErrorHandling<ServerTextFile>("read_server_text_file", {
    serverId,
    relativePath,
  });
}

export function writeServerTextFile(
  serverId: string,
  relativePath: string,
  content: string,
) {
  return invokeDesktopCommandWithErrorHandling<ServerTextFile>("write_server_text_file", {
    serverId,
    relativePath,
    content,
  });
}

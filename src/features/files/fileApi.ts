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
  revision: string;
  readOnly: boolean;
  warning?: string | null;
}

export type ServerFileMutation =
  | {
      operation: "createFile" | "createDirectory";
      relativePath: string;
      content?: string;
    }
  | {
      operation: "rename" | "move";
      relativePath: string;
      targetRelativePath: string;
    }
  | {
      operation: "delete";
      relativePath: string;
      confirmDelete: true;
    }
  | {
      operation: "upload";
      relativePath: string;
      sourcePaths: string[];
    };

export function listServerFiles(serverId: string, relativePath = "") {
  return invokeDesktopCommandWithErrorHandling<ServerFileEntry[]>(
    "list_server_files",
    {
      serverId,
      relativePath,
    },
  );
}

export function readServerTextFile(serverId: string, relativePath: string) {
  return invokeDesktopCommandWithErrorHandling<ServerTextFile>(
    "read_server_text_file",
    {
      serverId,
      relativePath,
    },
  );
}

export function writeServerTextFile(
  serverId: string,
  relativePath: string,
  content: string,
  expectedRevision: string,
) {
  return invokeDesktopCommandWithErrorHandling<ServerTextFile>(
    "write_server_text_file",
    {
      serverId,
      relativePath,
      content,
      expectedRevision,
    },
  );
}

export function mutateServerFiles(
  serverId: string,
  mutation: ServerFileMutation,
) {
  return invokeDesktopCommandWithErrorHandling<{ relativePaths: string[] }>(
    "mutate_server_files",
    { input: { serverId, ...mutation } },
  );
}

export function openServerFolder(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<null>("open_server_folder", {
    serverId,
  });
}

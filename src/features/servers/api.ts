import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type {
  CreateServerProfileInput,
  LoaderType,
  ServerProfile,
  UpdateServerProfileInput,
} from "./types";

export interface LoaderVersionOption {
  value: string;
  label: string;
  stable: boolean;
}

export function listServerProfiles() {
  return invokeDesktopCommandWithErrorHandling<ServerProfile[]>(
    "list_server_profiles",
  );
}

export function createServerProfile(input: CreateServerProfileInput) {
  return invokeDesktopCommandWithErrorHandling<ServerProfile>(
    "create_server_profile",
    {
      input,
    },
  );
}

export async function getDefaultServerRoot(name: string) {
  const result = await invokeDesktopCommandWithErrorHandling<{ path: string }>(
    "get_default_server_root",
    {
      input: { name },
    },
  );
  return result.path;
}

export function updateServerProfile(input: UpdateServerProfileInput) {
  return invokeDesktopCommandWithErrorHandling<ServerProfile>(
    "update_server_profile",
    {
      input,
    },
  );
}

export function deleteServerProfile(id: string) {
  return invokeDesktopCommandWithErrorHandling<void>("delete_server_profile", {
    id,
  });
}

export function listLoaderMinecraftVersions(loaderType: LoaderType) {
  return invokeDesktopCommandWithErrorHandling<LoaderVersionOption[]>(
    "list_loader_minecraft_versions",
    { input: { loaderType } },
  );
}

export function listLoaderVersions(
  loaderType: LoaderType,
  minecraftVersion: string,
) {
  return invokeDesktopCommandWithErrorHandling<LoaderVersionOption[]>(
    "list_loader_versions",
    { input: { loaderType, minecraftVersion } },
  );
}

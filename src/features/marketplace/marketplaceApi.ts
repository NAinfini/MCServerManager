import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type { InstalledContent } from "../content/contentApi";

export interface MarketplaceProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  projectType: string;
  loaders: string[];
  gameVersions: string[];
  iconUrl?: string | null;
  gallery?: string[];
  downloads?: number;
  follows?: number;
  modCount?: number | null;
  updatedAt?: string | null;
  body?: string | null;
  websiteUrl?: string | null;
}

export type ProjectSummary = MarketplaceProject;
export type ProjectDetails = MarketplaceProject;

export interface ProjectVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  loaders: string[];
  gameVersions: string[];
  files: Array<{
    filename: string;
    size: number;
    primary: boolean;
    url?: string;
  }>;
  dependencies: Array<{
    projectId?: string | null;
    versionId?: string | null;
    dependencyType: string;
  }>;
  diskUrls?: Array<{ platform: string; url: string }>;
  diskOnly?: boolean;
  warnings: string[];
  releaseType?: "release" | "beta" | "alpha" | string | null;
  isServerPack?: boolean;
  serverPackFileId?: string | null;
  serverCompatibility?: "serverPack" | "unverified";
}

export type BbsmcProjectSummary = MarketplaceProject;

export type MarketplaceProjectType =
  "mod" | "modpack" | "plugin" | "resourcepack" | "shader" | "datapack";

export type MarketplaceLoaderFilter =
  "any" | "fabric" | "forge" | "neoForge" | "paper" | "quilt";

export type MarketplaceSortOrder = "relevance" | "downloads" | "updated";

export interface MarketplaceSearchOptions {
  projectType?: MarketplaceProjectType;
  loader?: MarketplaceLoaderFilter;
  sort?: MarketplaceSortOrder;
  minecraftVersion?: string;
  offset?: number;
  limit?: number;
}

/* A version only counts as a real server pack when the provider says so. Both
   the result list and the detail panel badge it, so the predicate lives here
   rather than being restated wherever it is needed. */
export function isVerifiedServerPack(version: ProjectVersion) {
  return Boolean(
    version.isServerPack ||
    version.serverPackFileId ||
    version.serverCompatibility === "serverPack",
  );
}

export function searchModrinthProjects(
  serverId: string,
  query: string,
  options?: MarketplaceSearchOptions,
) {
  return invokeDesktopCommandWithErrorHandling<ProjectSummary[]>(
    "search_modrinth_projects",
    {
      input: { serverId, query, ...options },
    },
  );
}

export function getModrinthProject(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectDetails>(
    "get_modrinth_project",
    {
      input: { projectId },
    },
  );
}

export function listModrinthVersions(serverId: string, projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectVersion[]>(
    "list_modrinth_versions",
    {
      input: { serverId, projectId },
    },
  );
}

export function installModrinthVersion(
  serverId: string,
  projectId: string,
  versionId: string,
  installAnyway = false,
) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "install_modrinth_version",
    {
      input: { serverId, projectId, versionId, installAnyway },
    },
  );
}

export function searchHangarProjects(
  query: string,
  options: MarketplaceSearchOptions = {},
) {
  return invokeDesktopCommandWithErrorHandling<ProjectSummary[]>(
    "search_hangar_projects",
    {
      input: { query, ...options },
    },
  );
}

export function getHangarProject(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectDetails>(
    "get_hangar_project",
    { input: { projectId } },
  );
}

export function listHangarVersions(serverId: string, projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectVersion[]>(
    "list_hangar_versions",
    {
      input: { serverId, projectId },
    },
  );
}

export function installHangarVersion(
  serverId: string,
  projectId: string,
  versionName: string,
  installAnyway = false,
) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "install_hangar_version",
    {
      input: { serverId, projectId, versionName, installAnyway },
    },
  );
}

export function searchCurseForgeProjects(
  query: string,
  options?: MarketplaceSearchOptions,
) {
  return invokeDesktopCommandWithErrorHandling<ProjectSummary[]>(
    "search_curseforge_projects",
    {
      input: { query, ...options },
    },
  );
}

export function getCurseForgeProject(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectDetails>(
    "get_curseforge_project",
    {
      input: { projectId },
    },
  );
}

export function listCurseForgeFiles(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectVersion[]>(
    "list_curseforge_files",
    {
      input: { projectId },
    },
  );
}

export function installCurseForgeFile(
  serverId: string,
  projectId: string,
  fileId: string,
  name?: string,
  version?: string,
  fileName?: string,
) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "install_curseforge_file",
    {
      input: { serverId, projectId, fileId, name, version, fileName },
    },
  );
}

export function importCurseForgeManual(
  serverId: string,
  input: {
    filePath?: string;
    downloadUrl?: string;
    name: string;
    version?: string;
  },
) {
  return invokeDesktopCommandWithErrorHandling<{
    content: InstalledContent;
    dependencyResolution: string;
  }>("import_curseforge_manual", {
    input: { serverId, ...input },
  });
}

export function searchBbsmcProjects(
  query: string,
  options?: MarketplaceSearchOptions,
) {
  return invokeDesktopCommandWithErrorHandling<BbsmcProjectSummary[]>(
    "search_bbsmc_projects",
    {
      input: { query, ...options },
    },
  );
}

export function getBbsmcProject(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectDetails>(
    "get_bbsmc_project",
    {
      input: { projectId },
    },
  );
}

export function fetchMarketplaceImage(url: string) {
  return invokeDesktopCommandWithErrorHandling<{
    contentType: string;
    dataUrl: string;
  }>("fetch_marketplace_image", {
    input: { url },
  });
}

export function listBbsmcVersions(projectId: string) {
  return invokeDesktopCommandWithErrorHandling<ProjectVersion[]>(
    "list_bbsmc_versions",
    {
      input: { projectId },
    },
  );
}

export function installBbsmcPublicFile(
  serverId: string,
  versionId: string,
  name?: string,
  fileName?: string,
) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "install_bbsmc_public_file",
    {
      input: { serverId, versionId, name, fileName },
    },
  );
}

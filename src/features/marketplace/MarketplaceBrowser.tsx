import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  Package,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import type { ServerProfile } from "../../domain/server";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import {
  listInstalledContent,
  type InstalledContent,
} from "../content/contentApi";
import { contentKeys } from "../content/queries";
import type { LoaderType } from "../servers/types";
import { InstallDialog } from "./InstallDialog";
import { ProjectDetails } from "./ProjectDetails";
import {
  getBbsmcProject,
  getHangarProject,
  getModrinthProject,
  importCurseForgeManual,
  installBbsmcPublicFile,
  installHangarVersion,
  installModrinthVersion,
  isVerifiedServerPack,
  listBbsmcVersions,
  listHangarVersions,
  listModrinthVersions,
  searchBbsmcProjects,
  searchHangarProjects,
  searchModrinthProjects,
  type MarketplaceLoaderFilter,
  type MarketplaceProjectType,
  type MarketplaceSortOrder,
  type ProjectSummary,
  type ProjectVersion,
} from "./marketplaceApi";
import {
  getMarketplaceProviderBranding,
  marketplaceDiscoveryQueries,
  type MarketplaceProvider,
  type ServerPackMarketplaceProvider,
} from "./providerBranding";
import { marketplaceKeys } from "./queries";
import "./marketplace.css";

export interface MarketplaceCreateSelection {
  provider: ServerPackMarketplaceProvider;
  projectId: string;
  versionId: string;
  title: string;
  versionName: string;
  loaderType?: LoaderType | null;
  minecraftVersion?: string | null;
  loaderVersion?: string | null;
}

type MarketplaceBrowserProps =
  | {
      mode?: "install";
      server: ServerProfile;
      onSelect?: never;
      onDetailModeChange?: never;
      detailAction?: never;
    }
  | {
      mode: "create";
      server?: never;
      onSelect: (selection: MarketplaceCreateSelection) => void;
      onDetailModeChange?: (isDetailMode: boolean) => void;
      detailAction?: ReactNode;
    };

type MarketplaceContentType = "mods" | "plugins" | "modpacks";

const PAGE_SIZE = 20;
const contentTypeIcons: Record<MarketplaceContentType, typeof Blocks> = {
  mods: Blocks,
  plugins: Plug,
  modpacks: Package,
};

function sourcesForContentType(
  contentType: MarketplaceContentType,
): MarketplaceProvider[] {
  return contentType === "plugins"
    ? ["Modrinth", "Hangar"]
    : ["Modrinth", "BBSMC"];
}

function projectTypeFor(
  contentType: MarketplaceContentType,
): MarketplaceProjectType {
  if (contentType === "plugins") return "plugin";
  if (contentType === "modpacks") return "modpack";
  return "mod";
}

function serverLoaderFilter(server?: ServerProfile): MarketplaceLoaderFilter {
  const loader = server?.loaderType;
  if (loader === "fabric" || loader === "forge" || loader === "neoForge") {
    return loader;
  }
  if (loader === "paper") return "paper";
  if (loader === "quilt") return "quilt";
  return "any";
}

function creationMetadata(project: ProjectSummary, version: ProjectVersion) {
  const loader = [...version.loaders, ...project.loaders]
    .map((value) => value.toLowerCase())
    .find((value) =>
      [
        "vanilla",
        "paper",
        "forge",
        "fabric",
        "quilt",
        "neoforge",
        "neo-forge",
      ].includes(value),
    );
  const loaderType =
    loader === "neoforge" || loader === "neo-forge"
      ? "neoForge"
      : (loader as LoaderType | undefined);
  return {
    loaderType: loaderType ?? null,
    minecraftVersion:
      version.gameVersions.find((value) => /^1\.\d+(?:\.\d+)?/.test(value)) ??
      project.gameVersions.find((value) => /^1\.\d+(?:\.\d+)?/.test(value)) ??
      null,
    loaderVersion: null,
  };
}

function installedForProject(
  content: InstalledContent[],
  project: ProjectSummary,
  provider: MarketplaceProvider,
) {
  const providerName = provider.toLowerCase();
  const prefix = `${providerName}:`;
  const projectIds = [project.id, project.slug].map((value) =>
    value.toLowerCase(),
  );
  return content.filter((item) => {
    if (item.projectId) {
      return (
        projectIds.includes(item.projectId.toLowerCase()) &&
        (!item.provider || item.provider.toLowerCase() === providerName)
      );
    }
    const identity = item.contentId?.toLowerCase() ?? "";
    if (identity.includes(":")) {
      return (
        identity.startsWith(prefix) &&
        projectIds.some((projectId) =>
          identity.startsWith(`${prefix}${projectId}:`),
        )
      );
    }
    return false;
  });
}

function MarketplaceResultIcon({
  fallback,
  iconUrl,
  provider,
}: {
  fallback: string;
  iconUrl?: string | null;
  provider: MarketplaceProvider;
}) {
  const [failed, setFailed] = useState(false);
  const branding = getMarketplaceProviderBranding(provider);
  return (
    <span className="marketplace-result-icon">
      {iconUrl && !failed ? (
        <img
          alt=""
          aria-hidden="true"
          height="44"
          referrerPolicy="no-referrer"
          src={iconUrl}
          width="44"
          onError={() => setFailed(true)}
        />
      ) : branding?.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          height="44"
          src={branding.iconSrc}
          width="44"
        />
      ) : (
        <span>{fallback.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

export function MarketplaceBrowser(props: MarketplaceBrowserProps) {
  const isCreateMode = props.mode === "create";
  const server = isCreateMode ? undefined : props.server;
  const serverId = server?.id ?? "create-server";
  const { formatCompactNumber, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [contentType, setContentType] = useState<MarketplaceContentType>(
    isCreateMode ? "modpacks" : "mods",
  );
  const [source, setSource] = useState<MarketplaceProvider>("Modrinth");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState(
    isCreateMode ? marketplaceDiscoveryQueries.Modrinth : "",
  );
  const [loaderFilter, setLoaderFilter] = useState<MarketplaceLoaderFilter>(
    () => serverLoaderFilter(server),
  );
  const [sortOrder, setSortOrder] = useState<MarketplaceSortOrder>("relevance");
  const [page, setPage] = useState(0);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [selectedProvider, setSelectedProvider] =
    useState<MarketplaceProvider>("Modrinth");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [installAnyway, setInstallAnyway] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installedResult, setInstalledResult] =
    useState<InstalledContent | null>(null);
  const [pendingCreateSelection, setPendingCreateSelection] =
    useState<MarketplaceCreateSelection | null>(null);

  const onDetailModeChange = props.onDetailModeChange;
  useEffect(() => {
    onDetailModeChange?.(selectedProject !== null);
    return () => onDetailModeChange?.(false);
  }, [onDetailModeChange, selectedProject]);

  const searchOptions = {
    projectType: projectTypeFor(contentType),
    loader: loaderFilter,
    sort: sortOrder,
    minecraftVersion: server?.minecraftVersion ?? undefined,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
  const searchEnabled =
    submittedQuery.trim() !== "" || (isCreateMode && source === "BBSMC");
  const modrinthQuery = useQuery({
    enabled: source === "Modrinth" && searchEnabled,
    queryKey: [
      ...marketplaceKeys.modrinthSearch(
        serverId,
        contentType,
        submittedQuery,
        loaderFilter,
        sortOrder,
      ),
      server?.minecraftVersion,
      page,
    ],
    queryFn: () =>
      searchModrinthProjects(serverId, submittedQuery, searchOptions),
  });
  const bbsmcQuery = useQuery({
    enabled: source === "BBSMC" && searchEnabled,
    queryKey: [
      ...marketplaceKeys.bbsmcSearch(
        contentType,
        submittedQuery,
        loaderFilter,
        sortOrder,
      ),
      server?.minecraftVersion,
      page,
    ],
    queryFn: () => searchBbsmcProjects(submittedQuery, searchOptions),
  });
  const hangarQuery = useQuery({
    enabled: source === "Hangar" && searchEnabled,
    queryKey: [
      ...marketplaceKeys.hangarSearch(contentType, submittedQuery),
      server?.minecraftVersion,
      loaderFilter,
      sortOrder,
      page,
    ],
    queryFn: () => searchHangarProjects(submittedQuery, searchOptions),
  });
  const installedQuery = useQuery({
    enabled: !isCreateMode,
    queryKey: contentKeys.installed(serverId),
    queryFn: () => listInstalledContent(serverId),
  });
  const projectQuery = useQuery({
    enabled: selectedProject !== null,
    queryKey: marketplaceKeys.project(selectedProvider, selectedProject?.id),
    queryFn: () => {
      const projectId = selectedProject?.id ?? "";
      if (selectedProvider === "BBSMC") return getBbsmcProject(projectId);
      if (selectedProvider === "Hangar") return getHangarProject(projectId);
      return getModrinthProject(projectId);
    },
  });
  const versionsQuery = useQuery({
    enabled: selectedProject !== null,
    queryKey: marketplaceKeys.versions(
      selectedProvider,
      serverId,
      selectedProject?.id,
    ),
    queryFn: () => {
      const projectId = selectedProject?.id ?? "";
      if (selectedProvider === "BBSMC") return listBbsmcVersions(projectId);
      if (selectedProvider === "Hangar") {
        return listHangarVersions(serverId, projectId);
      }
      return listModrinthVersions(serverId, projectId);
    },
  });

  const versions = versionsQuery.data ?? [];
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? null;
  const selectedInstalled = selectedProject
    ? installedForProject(
        installedQuery.data ?? [],
        selectedProject,
        selectedProvider,
      )
    : [];
  const selectedVersionInstalled = Boolean(
    selectedVersion &&
    selectedInstalled.some(
      (item) =>
        item.versionId === selectedVersion.id ||
        item.version === selectedVersion.versionNumber,
    ),
  );

  const installMutation = useMutation({
    mutationFn: (version: ProjectVersion) => {
      if (isCreateMode) return Promise.resolve(null);
      if (selectedProvider === "BBSMC") {
        return installBbsmcPublicFile(
          serverId,
          version.id,
          selectedProject?.title,
        );
      }
      if (selectedProvider === "Hangar") {
        return installHangarVersion(
          serverId,
          version.projectId,
          version.id,
          installAnyway,
        );
      }
      return installModrinthVersion(
        serverId,
        version.projectId,
        version.id,
        installAnyway,
      );
    },
    onSuccess: async (result) => {
      setShowInstallDialog(false);
      setInstallAnyway(false);
      if (result) setInstalledResult(result);
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(serverId),
      });
    },
  });
  const importFileMutation = useMutation({
    mutationFn: async () => {
      const dialog = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", {
        kind: "file",
        filters: [{ name: "Minecraft content JAR", extensions: ["jar"] }],
      });
      if (!dialog?.path) return null;
      return importCurseForgeManual(serverId, {
        filePath: dialog.path,
        name:
          dialog.path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.jar$/i, "") || t("marketplace.manual.curseforge"),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(serverId),
      });
    },
  });

  const activeSearch =
    source === "Modrinth"
      ? modrinthQuery
      : source === "BBSMC"
        ? bbsmcQuery
        : hangarQuery;
  const results = activeSearch.data ?? [];
  const sourceOptions: SelectOption[] = sourcesForContentType(contentType).map(
    (value) => ({ value, label: value }),
  );
  const loaderFilterOptions: SelectOption[] = [
    { value: "any", label: t("marketplace.loader.any") },
    { value: "fabric", label: "Fabric" },
    { value: "forge", label: "Forge" },
    { value: "neoForge", label: "NeoForge" },
    { value: "paper", label: "Paper" },
    { value: "quilt", label: "Quilt" },
  ];
  const sortOrderOptions: SelectOption[] = [
    { value: "relevance", label: t("marketplace.sort.relevance") },
    { value: "downloads", label: t("marketplace.sort.downloads") },
    { value: "updated", label: t("marketplace.sort.updated") },
  ];
  const searchPlaceholder =
    contentType === "plugins"
      ? t("marketplace.plugins.placeholder")
      : source === "BBSMC"
        ? contentType === "modpacks"
          ? t("marketplace.bbsmc.modpackPlaceholder")
          : t("marketplace.bbsmc.modPlaceholder")
        : contentType === "modpacks"
          ? t("marketplace.modrinth.modpackPlaceholder")
          : t("marketplace.modrinth.modPlaceholder");
  const emptyDescription =
    contentType === "plugins"
      ? t("marketplace.empty.plugins")
      : contentType === "modpacks"
        ? t("marketplace.empty.modpacks")
        : t("marketplace.empty.mods");

  const resetSelection = () => {
    setSelectedProject(null);
    setSelectedVersionId(null);
    setInstalledResult(null);
    setShowInstallDialog(false);
    setInstallAnyway(false);
    installMutation.reset();
  };
  const resetSearchContext = () => {
    setPage(0);
    resetSelection();
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    resetSearchContext();
  };

  return (
    <section
      className="marketplace-panel"
      aria-label={t("marketplace.server.aria")}
    >
      {!selectedProject && !isCreateMode ? (
        <div className="marketplace-toolbar-row">
          <div
            className="marketplace-content-switch"
            aria-label={t("marketplace.contentType.aria")}
          >
            {(["mods", "plugins", "modpacks"] as const).map((value) => {
              const Icon = contentTypeIcons[value];
              return (
                <button
                  aria-pressed={contentType === value}
                  className={
                    contentType === value
                      ? "marketplace-content-option marketplace-content-option-active"
                      : "marketplace-content-option"
                  }
                  key={value}
                  type="button"
                  onClick={() => {
                    setContentType(value);
                    setSource(sourcesForContentType(value)[0]);
                    setSubmittedQuery("");
                    setQuery("");
                    resetSearchContext();
                  }}
                >
                  <Icon aria-hidden="true" size={15} />
                  {t(`marketplace.contentType.${value}`)}
                </button>
              );
            })}
          </div>
          <div
            className="marketplace-server-filter"
            aria-label={t("marketplace.compatibility.active")}
          >
            <span>
              {t("marketplace.compatibility.minecraft", {
                version: server?.minecraftVersion,
              })}
            </span>
            <span>{server?.loaderType}</span>
          </div>
          {contentType !== "plugins" ? (
            <Button
              disabled={importFileMutation.isPending}
              variant="secondary"
              onClick={() => importFileMutation.mutate()}
            >
              <FolderOpen aria-hidden="true" size={15} />
              {t("marketplace.manual.importFile")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!selectedProject ? (
        <form className="marketplace-search-row" onSubmit={handleSubmit}>
          <Select
            ariaLabel={t("marketplace.source")}
            name="marketplace-source"
            options={sourceOptions}
            value={source}
            onValueChange={(value) => {
              const nextSource = value as MarketplaceProvider;
              setSource(nextSource);
              setPage(0);
              if (
                isCreateMode &&
                query.trim() === "" &&
                nextSource !== "Hangar"
              ) {
                setSubmittedQuery(
                  marketplaceDiscoveryQueries[
                    nextSource as ServerPackMarketplaceProvider
                  ],
                );
              }
            }}
          />
          <TextField
            aria-label={t("marketplace.search.aria")}
            name="marketplace-query"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            ariaLabel={t("marketplace.loaderFilter")}
            name="marketplace-loader"
            options={loaderFilterOptions}
            value={loaderFilter}
            onValueChange={(value) => {
              setLoaderFilter(value as MarketplaceLoaderFilter);
              setPage(0);
            }}
          />
          <Select
            ariaLabel={t("marketplace.sortOrder")}
            name="marketplace-sort"
            options={sortOrderOptions}
            value={sortOrder}
            onValueChange={(value) => {
              setSortOrder(value as MarketplaceSortOrder);
              setPage(0);
            }}
          />
          <Button
            disabled={query.trim() === "" || activeSearch.isFetching}
            type="submit"
            variant="primary"
          >
            <Search aria-hidden="true" size={15} />
            {t("marketplace.search.button")}
          </Button>
        </form>
      ) : null}

      {importFileMutation.error ? (
        <div className="inline-error" role="alert">
          {importFileMutation.error.message}
        </div>
      ) : null}

      {!selectedProject ? (
        <div className="marketplace-layout">
          <section
            className="marketplace-results"
            aria-label={t("marketplace.results.aria")}
          >
            {activeSearch.isFetching ? (
              <LoadingState
                message={t("marketplace.searching", { provider: source })}
              />
            ) : activeSearch.error ? (
              <div
                aria-label={t("marketplace.search.loadError")}
                className="list-state list-state-error"
                role="alert"
              >
                <strong>{t("marketplace.search.loadError")}</strong>
                <span>{activeSearch.error.message}</span>
                <Button
                  variant="secondary"
                  onClick={() => activeSearch.refetch()}
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  {t("common.retry")}
                </Button>
              </div>
            ) : !searchEnabled ? (
              <EmptyState
                illustration="/illustrations/no-results.png"
                title={t("marketplace.empty.search.title")}
                description={emptyDescription}
              />
            ) : results.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-results.png"
                title={t("marketplace.empty.results.title")}
                description={emptyDescription}
              />
            ) : (
              results.map((project) => {
                const installed = installedForProject(
                  installedQuery.data ?? [],
                  project,
                  source,
                );
                return (
                  <button
                    className="marketplace-result"
                    key={`${source}-${project.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedProject(project);
                      setSelectedProvider(source);
                      setSelectedVersionId(null);
                      setInstalledResult(null);
                      setInstallAnyway(false);
                      installMutation.reset();
                    }}
                  >
                    <MarketplaceResultIcon
                      fallback={project.title}
                      iconUrl={project.iconUrl}
                      provider={source}
                    />
                    <span className="marketplace-result-body">
                      <strong>{project.title}</strong>
                      <span>{project.description}</span>
                      <span className="marketplace-result-meta">
                        <span>{source}</span>
                        {typeof project.downloads === "number" ? (
                          <span>
                            {t("marketplace.downloads", {
                              count: formatCompactNumber(project.downloads),
                            })}
                          </span>
                        ) : null}
                        {project.gameVersions[0] ? (
                          <span>{project.gameVersions[0]}</span>
                        ) : null}
                        {project.loaders[0] ? (
                          <span>{project.loaders[0]}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="marketplace-result-status">
                      {!isCreateMode ? (
                        <span className="marketplace-compatible-mark">
                          <CheckCircle2 aria-hidden="true" size={14} />
                          {t("marketplace.compatibility.match")}
                        </span>
                      ) : null}
                      {installed.length === 1 ? (
                        <span>{t("marketplace.installed")}</span>
                      ) : installed.length > 1 ? (
                        <span className="marketplace-duplicate-mark">
                          <CircleAlert aria-hidden="true" size={14} />
                          {t("marketplace.duplicate", {
                            count: installed.length,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </section>
          {searchEnabled &&
          !activeSearch.error &&
          !activeSearch.isFetching &&
          results.length > 0 ? (
            <nav
              className="marketplace-pagination"
              aria-label={t("marketplace.pagination.aria")}
            >
              <Button
                disabled={page === 0}
                variant="secondary"
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft aria-hidden="true" size={15} />
                {t("common.previous")}
              </Button>
              <span>
                {t("marketplace.pagination.page", { page: page + 1 })}
              </span>
              <Button
                disabled={results.length < PAGE_SIZE}
                variant="secondary"
                onClick={() => setPage((value) => value + 1)}
              >
                {t("common.next")}
                <ChevronRight aria-hidden="true" size={15} />
              </Button>
            </nav>
          ) : null}
        </div>
      ) : (
        <div className="marketplace-layout marketplace-layout-has-selection marketplace-layout-detail-mode">
          <div className="marketplace-detail-pane">
            <div className="marketplace-detail-bar">
              <Button
                className="marketplace-details-back"
                type="button"
                variant="ghost"
                onClick={resetSelection}
              >
                <ArrowLeft aria-hidden="true" size={15} />
                {t("marketplace.backToResults")}
              </Button>
              <span className="marketplace-detail-bar-source">
                {selectedProvider}
              </span>
              {!isCreateMode && server ? (
                <span className="marketplace-detail-compatibility">
                  {server.minecraftVersion} / {server.loaderType}
                </span>
              ) : null}
              {isCreateMode && props.detailAction ? (
                <span className="marketplace-detail-bar-action">
                  {props.detailAction}
                </span>
              ) : null}
            </div>

            {selectedInstalled.length > 0 ? (
              <div className="marketplace-installed-note" role="status">
                <CheckCircle2 aria-hidden="true" size={16} />
                <span>
                  {selectedInstalled.length === 1
                    ? t("marketplace.installed.detail", {
                        version:
                          selectedInstalled[0].version ?? t("common.unknown"),
                      })
                    : t("marketplace.duplicate.detail", {
                        count: selectedInstalled.length,
                      })}
                </span>
              </div>
            ) : null}
            {installedResult ? (
              <div
                className="marketplace-install-result"
                role="status"
                aria-live="polite"
              >
                <CheckCircle2 aria-hidden="true" size={16} />
                <span>
                  <strong>
                    {t("marketplace.install.success", {
                      name: installedResult.name,
                    })}
                  </strong>
                  {t("marketplace.install.restartRequired")}
                </span>
              </div>
            ) : null}
            {projectQuery.error ? (
              <div className="inline-error" role="alert">
                <span>{projectQuery.error.message}</span>
                <Button
                  variant="secondary"
                  onClick={() => projectQuery.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}

            <ProjectDetails
              isLoading={projectQuery.isLoading || versionsQuery.isLoading}
              project={projectQuery.data ?? selectedProject}
              provider={selectedProvider}
              selectedVersionId={selectedVersionId}
              versions={versions}
              versionsError={
                versionsQuery.error ? (
                  <div className="list-state list-state-error" role="alert">
                    <strong>{t("marketplace.versions.loadError")}</strong>
                    <span>{versionsQuery.error.message}</span>
                    <Button
                      variant="secondary"
                      onClick={() => versionsQuery.refetch()}
                    >
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : undefined
              }
              versionAction={
                selectedVersion ? (
                  isCreateMode ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        const selection: MarketplaceCreateSelection = {
                          provider:
                            selectedProvider as ServerPackMarketplaceProvider,
                          projectId: selectedProject.id,
                          versionId: selectedVersion.id,
                          title: selectedProject.title,
                          versionName: selectedVersion.versionNumber,
                          ...creationMetadata(selectedProject, selectedVersion),
                        };
                        if (isVerifiedServerPack(selectedVersion)) {
                          props.onSelect(selection);
                        } else {
                          setPendingCreateSelection(selection);
                        }
                      }}
                    >
                      {t("marketplace.selectVersion")}
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        selectedVersionInstalled || installMutation.isPending
                      }
                      variant="primary"
                      onClick={() => {
                        setInstalledResult(null);
                        setShowInstallDialog(true);
                      }}
                    >
                      {selectedVersionInstalled
                        ? t("marketplace.install.alreadyInstalled")
                        : t("marketplace.install.selected")}
                    </Button>
                  )
                ) : (
                  <p className="marketplace-version-hint">
                    {t("marketplace.selectVersionHint")}
                  </p>
                )
              }
              onSelectVersion={(versionId) => {
                setSelectedVersionId(versionId);
                setInstalledResult(null);
                installMutation.reset();
              }}
            />
            {showInstallDialog && selectedVersion && !isCreateMode ? (
              <InstallDialog
                error={installMutation.error?.message ?? null}
                isInstalling={installMutation.isPending}
                installAnyway={installAnyway}
                project={selectedProject}
                sourceLabel={selectedProvider}
                version={selectedVersion}
                onCancel={() => {
                  setShowInstallDialog(false);
                  setInstallAnyway(false);
                  installMutation.reset();
                }}
                onInstallAnywayChange={setInstallAnyway}
                onInstall={() => installMutation.mutate(selectedVersion)}
              />
            ) : null}
          </div>
        </div>
      )}

      <DialogSurface
        open={pendingCreateSelection !== null}
        className="confirm-danger-dialog"
        description={t("marketplace.unverifiedDialog.description")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingCreateSelection(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingCreateSelection && props.mode === "create") {
                  props.onSelect(pendingCreateSelection);
                }
                setPendingCreateSelection(null);
              }}
            >
              {t("marketplace.unverifiedDialog.confirm")}
            </Button>
          </>
        }
        title={t("marketplace.unverifiedDialog.title")}
        onOpenChange={(open) => {
          if (!open) setPendingCreateSelection(null);
        }}
      />
    </section>
  );
}

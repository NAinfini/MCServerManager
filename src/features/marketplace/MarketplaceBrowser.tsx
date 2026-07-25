import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Blocks,
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
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type { ServerProfile } from "../../domain/server";
import type { LoaderType } from "../servers/types";
import { contentKeys } from "../content/queries";
import { InstallDialog } from "./InstallDialog";
import { ProjectDetails } from "./ProjectDetails";
import {
  getModrinthProject,
  installModrinthVersion,
  installBbsmcPublicFile,
  importCurseForgeManual,
  listBbsmcVersions,
  listModrinthVersions,
  searchModrinthProjects,
  searchBbsmcProjects,
  searchHangarProjects,
  type MarketplaceLoaderFilter,
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
    }
  | {
      mode: "create";
      server?: never;
      onSelect: (selection: MarketplaceCreateSelection) => void;
      onDetailModeChange?: (isDetailMode: boolean) => void;
    };

type MarketplaceContentType = "mods" | "plugins" | "modpacks";
type MarketplaceSource = MarketplaceProvider;

const contentTypeIcons: Record<MarketplaceContentType, typeof Blocks> = {
  mods: Blocks,
  plugins: Plug,
  modpacks: Package,
};

function sourcesForContentType(
  contentType: MarketplaceContentType,
): MarketplaceSource[] {
  return contentType === "plugins" ? ["Hangar"] : ["Modrinth", "BBSMC"];
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

function isVerifiedServerPack(version: ProjectVersion) {
  return Boolean(
    version.isServerPack ||
    version.serverPackFileId ||
    version.serverCompatibility === "serverPack",
  );
}

function MarketplaceResultIcon({
  fallback,
  iconUrl,
  provider,
}: {
  fallback: string;
  iconUrl?: string | null;
  provider: string;
}) {
  const [failed, setFailed] = useState(false);
  const providerBranding = getMarketplaceProviderBranding(provider);

  return (
    <span className="marketplace-result-icon">
      {iconUrl && !failed ? (
        <img
          alt=""
          aria-hidden="true"
          height="64"
          referrerPolicy="no-referrer"
          src={iconUrl}
          width="64"
          onError={() => setFailed(true)}
        />
      ) : providerBranding?.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          height="64"
          src={providerBranding.iconSrc}
          width="64"
        />
      ) : (
        <span>{fallback.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function MarketplaceResultMeta({
  downloadsLabel,
  project,
  provider,
}: {
  downloadsLabel: string;
  project: ProjectSummary;
  provider: string;
}) {
  const branding = getMarketplaceProviderBranding(provider);
  const versions = project.gameVersions.slice(0, 2).join(", ");

  return (
    <span className="marketplace-result-meta">
      {branding?.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          className="provider-icon"
          height="17"
          src={branding.iconSrc}
          width="17"
        />
      ) : null}
      <span className="meta-badge meta-badge-provider">{provider}</span>
      <span className="meta-badge meta-badge-downloads">{downloadsLabel}</span>
      {versions ? (
        <span className="meta-badge meta-badge-version">{versions}</span>
      ) : null}
    </span>
  );
}

export function MarketplaceBrowser(props: MarketplaceBrowserProps) {
  const isCreateMode = props.mode === "create";
  const serverId = isCreateMode ? "create-server" : props.server.id;
  const { formatCompactNumber, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [contentType, setContentType] = useState<MarketplaceContentType>(
    isCreateMode ? "modpacks" : "mods",
  );
  const [source, setSource] = useState<MarketplaceSource>("Modrinth");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState(
    isCreateMode ? marketplaceDiscoveryQueries.Modrinth : "",
  );
  const [loaderFilter, setLoaderFilter] =
    useState<MarketplaceLoaderFilter>("any");
  const [sortOrder, setSortOrder] = useState<MarketplaceSortOrder>("relevance");
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [selectedProvider, setSelectedProvider] =
    useState<ServerPackMarketplaceProvider>("Modrinth");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [installAnyway, setInstallAnyway] = useState(false);
  const [pendingCreateSelection, setPendingCreateSelection] =
    useState<MarketplaceCreateSelection | null>(null);
  useEffect(() => {
    props.onDetailModeChange?.(selectedProject !== null);
    return () => props.onDetailModeChange?.(false);
  }, [props, selectedProject]);
  const searchQuery = useQuery({
    enabled: source === "Modrinth" && submittedQuery.trim() !== "",
    queryKey: marketplaceKeys.modrinthSearch(
      serverId,
      contentType,
      submittedQuery,
      loaderFilter,
      sortOrder,
    ),
    queryFn: () =>
      searchModrinthProjects(serverId, submittedQuery, {
        projectType: contentType === "modpacks" ? "modpack" : "mod",
        loader: loaderFilter,
        sort: sortOrder,
      }),
  });
  const bbsmcQueryResult = useQuery({
    enabled: source === "BBSMC" && submittedQuery.trim() !== "",
    queryKey: marketplaceKeys.bbsmcSearch(
      contentType,
      submittedQuery,
      loaderFilter,
      sortOrder,
    ),
    queryFn: () =>
      searchBbsmcProjects(submittedQuery, {
        projectType: contentType === "modpacks" ? "modpack" : "mod",
        loader: loaderFilter,
        sort: sortOrder,
      }),
  });
  const hangarQueryResult = useQuery({
    enabled: source === "Hangar" && submittedQuery.trim() !== "",
    queryKey: marketplaceKeys.hangarSearch(contentType, submittedQuery),
    queryFn: () => searchHangarProjects(submittedQuery),
  });
  const projectQuery = useQuery({
    enabled: selectedProject !== null && selectedProvider === "Modrinth",
    queryKey: marketplaceKeys.project("Modrinth", selectedProject?.id),
    queryFn: () => getModrinthProject(selectedProject?.id ?? ""),
  });
  const versionsQuery = useQuery({
    enabled: selectedProject !== null,
    queryKey: marketplaceKeys.versions(
      selectedProvider,
      serverId,
      selectedProject?.id,
    ),
    queryFn: () =>
      selectedProvider === "BBSMC"
        ? listBbsmcVersions(selectedProject?.id ?? "")
        : listModrinthVersions(serverId, selectedProject?.id ?? ""),
  });
  const installMutation = useMutation({
    mutationFn: (version: ProjectVersion) =>
      isCreateMode
        ? Promise.resolve(null)
        : selectedProvider === "BBSMC"
          ? installBbsmcPublicFile(serverId, version.id, selectedProject?.title)
          : installModrinthVersion(
              serverId,
              version.projectId,
              version.id,
              installAnyway,
            ),
    onSuccess: async () => {
      setSelectedVersionId(null);
      setInstallAnyway(false);
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
      if (!dialog?.path) {
        return null;
      }
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
  const versions = versionsQuery.data ?? [];
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? null;
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
  const emptyDescription =
    contentType === "plugins"
      ? t("marketplace.empty.plugins")
      : contentType === "modpacks"
        ? t("marketplace.empty.modpacks")
        : t("marketplace.empty.mods");
  const searchPlaceholder =
    contentType === "plugins"
      ? t("marketplace.hangar.placeholder")
      : contentType === "modpacks"
        ? t("marketplace.modrinth.modpackPlaceholder")
        : t("marketplace.modrinth.modPlaceholder");
  const isSearching =
    searchQuery.isFetching ||
    bbsmcQueryResult.isFetching ||
    hangarQueryResult.isFetching;
  const hasSearched = submittedQuery.trim() !== "";
  const activeSearchError =
    source === "Modrinth"
      ? searchQuery.error
      : source === "BBSMC"
        ? bbsmcQueryResult.error
        : hangarQueryResult.error;
  const retryActiveSearch = () => {
    if (source === "Modrinth") {
      return searchQuery.refetch();
    }
    if (source === "BBSMC") {
      return bbsmcQueryResult.refetch();
    }
    return hangarQueryResult.refetch();
  };

  const changeContentType = (nextType: MarketplaceContentType) => {
    setContentType(nextType);
    setSource(sourcesForContentType(nextType)[0]);
    setSubmittedQuery("");
    setSelectedProject(null);
    setSelectedVersionId(null);
    setInstallAnyway(false);
    installMutation.reset();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setSelectedProject(null);
    setSelectedVersionId(null);
    setInstallAnyway(false);
  };

  return (
    <section
      className="marketplace-panel"
      aria-label={t("marketplace.server.aria")}
    >
      {!isCreateMode ? (
        <div
          className="marketplace-content-switch"
          aria-label={t("marketplace.contentType.aria")}
        >
          {[
            ["mods", t("marketplace.contentType.mods")],
            ["plugins", t("marketplace.contentType.plugins")],
            ["modpacks", t("marketplace.contentType.modpacks")],
          ].map(([value, label]) =>
            (() => {
              const Icon = contentTypeIcons[value as MarketplaceContentType];
              return (
                <button
                  className={
                    contentType === value
                      ? "marketplace-content-option marketplace-content-option-active"
                      : "marketplace-content-option marketplace-content-option-muted"
                  }
                  key={value}
                  type="button"
                  onClick={() =>
                    changeContentType(value as MarketplaceContentType)
                  }
                >
                  <Icon aria-hidden="true" size={15} />
                  {label}
                </button>
              );
            })(),
          )}
        </div>
      ) : null}

      <form className="marketplace-search-row" onSubmit={handleSubmit}>
        <Select
          ariaLabel={t("marketplace.source")}
          name="marketplace-source"
          options={sourceOptions}
          value={source}
          onValueChange={(value) => {
            setSource(value as MarketplaceSource);
            setSelectedProject(null);
            setSelectedVersionId(null);
          }}
        />
        <TextField
          aria-label={t("marketplace.search.aria")}
          name="marketplace-query"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {source !== "Hangar" ? (
          <>
            <Select
              ariaLabel={t("marketplace.loaderFilter")}
              name="marketplace-loader"
              options={loaderFilterOptions}
              value={loaderFilter}
              onValueChange={(value) => {
                setLoaderFilter(value as MarketplaceLoaderFilter);
                setSelectedProject(null);
                setSelectedVersionId(null);
              }}
            />
            <Select
              ariaLabel={t("marketplace.sortOrder")}
              name="marketplace-sort"
              options={sortOrderOptions}
              value={sortOrder}
              onValueChange={(value) => {
                setSortOrder(value as MarketplaceSortOrder);
                setSelectedProject(null);
                setSelectedVersionId(null);
              }}
            />
          </>
        ) : null}
        <Button
          disabled={query.trim() === "" || isSearching}
          type="submit"
          variant="primary"
        >
          <Search aria-hidden="true" size={15} />
          {t("marketplace.search.button")}
        </Button>
      </form>

      {!isCreateMode && contentType !== "plugins" ? (
        <div className="marketplace-secondary-actions">
          <Button
            disabled={importFileMutation.isPending}
            variant="secondary"
            onClick={() => importFileMutation.mutate()}
          >
            <FolderOpen aria-hidden="true" size={15} />
            {t("marketplace.manual.importFile")}
          </Button>
        </div>
      ) : null}

      {versionsQuery.error ? (
        <div className="inline-error" role="alert">
          {versionsQuery.error.message}
        </div>
      ) : null}
      {projectQuery.error ? (
        <div className="inline-error" role="alert">
          {projectQuery.error.message}
        </div>
      ) : null}
      {importFileMutation.error ? (
        <div className="inline-error" role="alert">
          {importFileMutation.error.message}
        </div>
      ) : null}

      <div
        className={[
          "marketplace-layout",
          contentType === "modpacks" ? "marketplace-layout-card-mode" : "",
          selectedProject ? "marketplace-layout-has-selection" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <section
          className={
            contentType === "modpacks"
              ? "marketplace-results marketplace-card-grid"
              : "marketplace-results"
          }
          aria-label={t("marketplace.results.aria")}
        >
          {isSearching ? (
            <LoadingState
              message={t("marketplace.searching", { provider: source })}
            />
          ) : null}
          {!isSearching && activeSearchError ? (
            <div
              aria-label={t("marketplace.search.loadError")}
              className="list-state list-state-error"
              role="alert"
            >
              <strong>{t("marketplace.search.loadError")}</strong>
              <span>{activeSearchError.message}</span>
              <Button variant="secondary" onClick={() => retryActiveSearch()}>
                <RefreshCw aria-hidden="true" size={15} />
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {source === "Modrinth" &&
          hasSearched &&
          !searchQuery.isFetching &&
          !searchQuery.error &&
          (searchQuery.data?.length ?? 0) === 0 ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.results.title")}
              description={emptyDescription}
            />
          ) : null}
          {source === "BBSMC" &&
          hasSearched &&
          !bbsmcQueryResult.isFetching &&
          !bbsmcQueryResult.error &&
          (bbsmcQueryResult.data?.length ?? 0) === 0 ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.results.title")}
              description={emptyDescription}
            />
          ) : null}
          {source === "Hangar" &&
          hasSearched &&
          !hangarQueryResult.isFetching &&
          !hangarQueryResult.error &&
          (hangarQueryResult.data?.length ?? 0) === 0 ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.plugins.title")}
              description={emptyDescription}
            />
          ) : null}
          {!hasSearched && !isSearching ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.search.title")}
              description={emptyDescription}
            />
          ) : null}
          {source === "Modrinth"
            ? searchQuery.data?.map((project) => (
                <button
                  className={
                    project.id === selectedProject?.id
                      ? "marketplace-result marketplace-result-selected"
                      : "marketplace-result"
                  }
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setSelectedProject(project);
                    setSelectedProvider("Modrinth");
                    setSelectedVersionId(null);
                    setInstallAnyway(false);
                    installMutation.reset();
                  }}
                >
                  <MarketplaceResultIcon
                    fallback={project.title}
                    iconUrl={project.iconUrl}
                    provider="Modrinth"
                  />
                  <span className="marketplace-result-body">
                    <strong>{project.title}</strong>
                    <span>{project.description}</span>
                    <MarketplaceResultMeta
                      downloadsLabel={t("marketplace.downloads", {
                        count: formatCompactNumber(project.downloads),
                      })}
                      project={project}
                      provider="Modrinth"
                    />
                  </span>
                  {contentType === "modpacks" ? (
                    <span className="marketplace-pack-card-action">
                      {t("marketplace.viewPack")}
                    </span>
                  ) : null}
                </button>
              ))
            : null}
          {source === "BBSMC"
            ? bbsmcQueryResult.data?.map((project) => (
                <button
                  className={
                    selectedProvider === "BBSMC" &&
                    project.id === selectedProject?.id
                      ? "marketplace-result marketplace-result-selected"
                      : "marketplace-result"
                  }
                  key={`bbsmc-${project.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedProject(project);
                    setSelectedProvider("BBSMC");
                    setSelectedVersionId(null);
                    setInstallAnyway(false);
                    installMutation.reset();
                  }}
                >
                  <MarketplaceResultIcon
                    fallback={project.title}
                    iconUrl={project.iconUrl}
                    provider="BBSMC"
                  />
                  <span className="marketplace-result-body">
                    <strong>{project.title}</strong>
                    <span>{project.description}</span>
                    <MarketplaceResultMeta
                      downloadsLabel={t("marketplace.downloads", {
                        count: formatCompactNumber(project.downloads),
                      })}
                      project={project}
                      provider="BBSMC"
                    />
                    <small>
                      {t("marketplace.bbsmc.publicFree", {
                        type:
                          contentType === "modpacks"
                            ? t("marketplace.contentType.modpacks")
                            : t("marketplace.contentType.mods"),
                      })}
                    </small>
                  </span>
                  {contentType === "modpacks" ? (
                    <span className="marketplace-pack-card-action">
                      {t("marketplace.viewPack")}
                    </span>
                  ) : null}
                </button>
              ))
            : null}
          {source === "Hangar"
            ? hangarQueryResult.data?.map((project) => (
                <div
                  className="marketplace-result"
                  key={`hangar-${project.id}`}
                >
                  <MarketplaceResultIcon
                    fallback={project.name}
                    provider="Hangar"
                  />
                  <span className="marketplace-result-body">
                    <strong>{project.name}</strong>
                    <span>{project.description}</span>
                    <span className="marketplace-result-meta">
                      <span className="meta-badge meta-badge-provider">
                        Hangar
                      </span>
                      <span className="meta-badge meta-badge-source">
                        {project.namespace}
                      </span>
                    </span>
                  </span>
                </div>
              ))
            : null}
        </section>
        <div className="marketplace-details">
          {selectedProject ? (
            <Button
              className="marketplace-details-back"
              type="button"
              variant="ghost"
              onClick={() => {
                setSelectedProject(null);
                setSelectedVersionId(null);
                setInstallAnyway(false);
                installMutation.reset();
              }}
            >
              {t("wizard.nav.back")}
            </Button>
          ) : null}
          <ProjectDetails
            isLoading={projectQuery.isLoading || versionsQuery.isLoading}
            project={
              selectedProvider === "BBSMC"
                ? selectedProject
                : (projectQuery.data ?? null)
            }
            provider={selectedProvider}
            selectedVersionId={selectedVersionId}
            versions={versions}
            onSelectVersion={setSelectedVersionId}
          />
          {selectedProject && selectedVersion && !isCreateMode ? (
            <InstallDialog
              error={installMutation.error?.message ?? null}
              isInstalling={installMutation.isPending}
              installAnyway={installAnyway}
              project={selectedProject}
              sourceLabel={selectedProvider}
              version={selectedVersion}
              onCancel={() => {
                installMutation.reset();
                setSelectedVersionId(null);
                setInstallAnyway(false);
              }}
              onInstallAnywayChange={setInstallAnyway}
              onInstall={() => installMutation.mutate(selectedVersion)}
            />
          ) : null}
          {selectedProject && selectedVersion && isCreateMode ? (
            <Button
              variant="primary"
              onClick={() => {
                const selection: MarketplaceCreateSelection = {
                  provider: selectedProvider as ServerPackMarketplaceProvider,
                  projectId: selectedProject.id,
                  versionId: selectedVersion.id,
                  title: selectedProject.title,
                  versionName: selectedVersion.versionNumber,
                  ...creationMetadata(selectedProject, selectedVersion),
                };
                if (isVerifiedServerPack(selectedVersion))
                  props.onSelect(selection);
                else setPendingCreateSelection(selection);
              }}
            >
              {t("marketplace.selectVersion")}
            </Button>
          ) : null}
        </div>
      </div>
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
                if (pendingCreateSelection && props.mode === "create")
                  props.onSelect(pendingCreateSelection);
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

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, FolderOpen, Package, Plug, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type { ServerProfile } from "../servers/types";
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
import { getMarketplaceProviderBranding } from "./providerBranding";

interface ServerMarketplaceViewProps {
  server: ServerProfile;
}

type MarketplaceContentType = "mods" | "plugins" | "modpacks";
type MarketplaceSource = "Modrinth" | "BBSMC" | "Hangar";

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
          referrerPolicy="no-referrer"
          src={iconUrl}
          onError={() => setFailed(true)}
        />
      ) : providerBranding?.iconSrc ? (
        <img alt="" aria-hidden="true" src={providerBranding.iconSrc} />
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
          src={branding.iconSrc}
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

export function ServerMarketplaceView({ server }: ServerMarketplaceViewProps) {
  const { formatCompactNumber, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [contentType, setContentType] =
    useState<MarketplaceContentType>("mods");
  const [source, setSource] = useState<MarketplaceSource>("Modrinth");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loaderFilter, setLoaderFilter] =
    useState<MarketplaceLoaderFilter>("any");
  const [sortOrder, setSortOrder] = useState<MarketplaceSortOrder>("relevance");
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [selectedProvider, setSelectedProvider] = useState<
    "Modrinth" | "BBSMC"
  >("Modrinth");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [installAnyway, setInstallAnyway] = useState(false);
  const searchQuery = useQuery({
    enabled: source === "Modrinth" && submittedQuery.trim() !== "",
    queryKey: [
      "modrinthSearch",
      server.id,
      contentType,
      submittedQuery,
      loaderFilter,
      sortOrder,
    ],
    queryFn: () =>
      searchModrinthProjects(server.id, submittedQuery, {
        projectType: contentType === "modpacks" ? "modpack" : "mod",
        loader: loaderFilter,
        sort: sortOrder,
      }),
  });
  const bbsmcQueryResult = useQuery({
    enabled: source === "BBSMC" && submittedQuery.trim() !== "",
    queryKey: [
      "bbsmcSearch",
      contentType,
      submittedQuery,
      loaderFilter,
      sortOrder,
    ],
    queryFn: () =>
      searchBbsmcProjects(submittedQuery, {
        projectType: contentType === "modpacks" ? "modpack" : "mod",
        loader: loaderFilter,
        sort: sortOrder,
      }),
  });
  const hangarQueryResult = useQuery({
    enabled: source === "Hangar" && submittedQuery.trim() !== "",
    queryKey: ["hangarSearch", contentType, submittedQuery],
    queryFn: () => searchHangarProjects(submittedQuery),
  });
  const projectQuery = useQuery({
    enabled: selectedProject !== null && selectedProvider === "Modrinth",
    queryKey: ["modrinthProject", selectedProject?.id],
    queryFn: () => getModrinthProject(selectedProject?.id ?? ""),
  });
  const versionsQuery = useQuery({
    enabled: selectedProject !== null,
    queryKey: [
      "marketplaceVersions",
      selectedProvider,
      server.id,
      selectedProject?.id,
    ],
    queryFn: () =>
      selectedProvider === "BBSMC"
        ? listBbsmcVersions(selectedProject?.id ?? "")
        : listModrinthVersions(server.id, selectedProject?.id ?? ""),
  });
  const installMutation = useMutation({
    mutationFn: (version: ProjectVersion) =>
      selectedProvider === "BBSMC"
        ? installBbsmcPublicFile(server.id, version.id, selectedProject?.title)
        : installModrinthVersion(
            server.id,
            version.projectId,
            version.id,
            installAnyway,
          ),
    onSuccess: async () => {
      setSelectedVersionId(null);
      setInstallAnyway(false);
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
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
      return importCurseForgeManual(server.id, {
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
        queryKey: ["installedContent", server.id],
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

      <form className="marketplace-search-row" onSubmit={handleSubmit}>
        <Select
          ariaLabel={t("marketplace.source")}
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
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {source !== "Hangar" ? (
          <>
            <Select
              ariaLabel={t("marketplace.loaderFilter")}
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

      {contentType !== "plugins" ? (
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

      {searchQuery.error ? (
        <div className="inline-error">{searchQuery.error.message}</div>
      ) : null}
      {versionsQuery.error ? (
        <div className="inline-error">{versionsQuery.error.message}</div>
      ) : null}
      {projectQuery.error ? (
        <div className="inline-error">{projectQuery.error.message}</div>
      ) : null}
      {importFileMutation.error ? (
        <div className="inline-error">{importFileMutation.error.message}</div>
      ) : null}
      {bbsmcQueryResult.error ? (
        <div className="inline-error">{bbsmcQueryResult.error.message}</div>
      ) : null}
      {hangarQueryResult.error ? (
        <div className="inline-error">{hangarQueryResult.error.message}</div>
      ) : null}

      <div
        className={
          contentType === "modpacks"
            ? "marketplace-layout marketplace-layout-card-mode"
            : "marketplace-layout"
        }
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
            <LoadingState message={t("marketplace.searching", { provider: source })} />
          ) : null}
          {source === "Modrinth" &&
          hasSearched &&
          !searchQuery.isFetching &&
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
        <div>
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
          {selectedProject && selectedVersion ? (
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
        </div>
      </div>
    </section>
  );
}

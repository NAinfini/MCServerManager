import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Package, Plug, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
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

const contentTypeIcons: Record<MarketplaceContentType, typeof Blocks> = {
  mods: Blocks,
  plugins: Plug,
  modpacks: Package,
};

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
  const [query, setQuery] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [bbsmcQuery, setBbsmcQuery] = useState("");
  const [hangarQuery, setHangarQuery] = useState("");
  const [submittedBbsmcQuery, setSubmittedBbsmcQuery] = useState("");
  const [submittedHangarQuery, setSubmittedHangarQuery] = useState("");
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
    enabled: contentType !== "plugins" && submittedQuery.trim() !== "",
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
    enabled: contentType !== "plugins" && submittedBbsmcQuery.trim() !== "",
    queryKey: [
      "bbsmcSearch",
      contentType,
      submittedBbsmcQuery,
      loaderFilter,
      sortOrder,
    ],
    queryFn: () =>
      searchBbsmcProjects(submittedBbsmcQuery, {
        projectType: contentType === "modpacks" ? "modpack" : "mod",
        loader: loaderFilter,
        sort: sortOrder,
      }),
  });
  const hangarQueryResult = useQuery({
    enabled: contentType === "plugins" && submittedHangarQuery.trim() !== "",
    queryKey: ["hangarSearch", contentType, submittedHangarQuery],
    queryFn: () => searchHangarProjects(submittedHangarQuery),
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
  const manualMutation = useMutation({
    mutationFn: () =>
      importCurseForgeManual(server.id, {
        filePath: manualPath,
        name:
          manualPath
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.jar$/i, "") || t("marketplace.manual.curseforge"),
      }),
    onSuccess: async () => {
      setManualPath("");
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
      });
    },
  });
  const versions = versionsQuery.data ?? [];
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? null;
  const modrinthBranding = getMarketplaceProviderBranding("Modrinth");
  const curseForgeBranding = getMarketplaceProviderBranding("CurseForge");
  const hangarBranding = getMarketplaceProviderBranding("Hangar");
  const bbsmcBranding = getMarketplaceProviderBranding("BBSMC");
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
  const searchLabel =
    contentType === "modpacks"
      ? t("marketplace.modrinth.modpackSearch")
      : t("marketplace.modrinth.modSearch");
  const bbsmcSearchLabel =
    contentType === "modpacks"
      ? t("marketplace.bbsmc.modpackSearch")
      : t("marketplace.bbsmc.modSearch");
  const emptyDescription =
    contentType === "plugins"
      ? t("marketplace.empty.plugins")
      : contentType === "modpacks"
        ? t("marketplace.empty.modpacks")
        : t("marketplace.empty.mods");

  const changeContentType = (nextType: MarketplaceContentType) => {
    setContentType(nextType);
    setSelectedProject(null);
    setSelectedVersionId(null);
    setInstallAnyway(false);
    installMutation.reset();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setSelectedProvider("Modrinth");
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

      {contentType !== "plugins" ? (
        <form className="marketplace-search" onSubmit={handleSubmit}>
          <label>
            <span className="provider-label">
              <img
                alt=""
                aria-hidden="true"
                className="provider-icon"
                src={modrinthBranding?.iconSrc}
              />
              {searchLabel}
            </span>
            <TextField
              placeholder={
                contentType === "modpacks"
                  ? t("marketplace.modrinth.modpackPlaceholder")
                  : t("marketplace.modrinth.modPlaceholder")
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
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
          <Button
            disabled={query.trim() === "" || searchQuery.isFetching}
            type="submit"
            variant="primary"
          >
            <Search aria-hidden="true" size={15} />
            {t("marketplace.search.button")}
          </Button>
        </form>
      ) : null}

      {contentType !== "modpacks" ? (
        <form
          className="marketplace-search"
          onSubmit={(event) => {
            event.preventDefault();
            manualMutation.mutate();
          }}
        >
          <label>
            <span className="provider-label">
              <img
                alt=""
                aria-hidden="true"
                className="provider-icon"
                src={curseForgeBranding?.iconSrc}
              />
              {t("marketplace.manual.curseforge")}
            </span>
            <TextField
              placeholder={t("marketplace.manual.placeholder")}
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
            />
          </label>
          <Button
            disabled={manualPath.trim() === "" || manualMutation.isPending}
            type="submit"
            variant="secondary"
          >
            {t("marketplace.manual.import")}
          </Button>
        </form>
      ) : null}

      {contentType === "plugins" ? (
        <form
          className="marketplace-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedHangarQuery(hangarQuery.trim());
          }}
        >
          <label>
            <span className="provider-label">
              <img
                alt=""
                aria-hidden="true"
                className="provider-icon"
                src={hangarBranding?.iconSrc}
              />
              {t("marketplace.hangar.search")}
            </span>
            <TextField
              placeholder={t("marketplace.hangar.placeholder")}
              value={hangarQuery}
              onChange={(event) => setHangarQuery(event.target.value)}
            />
          </label>
          <Button
            disabled={hangarQuery.trim() === "" || hangarQueryResult.isFetching}
            type="submit"
            variant="primary"
          >
            <Search aria-hidden="true" size={15} />
            {t("marketplace.hangar.button")}
          </Button>
        </form>
      ) : null}

      {contentType !== "plugins" ? (
        <form
          className="marketplace-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedBbsmcQuery(bbsmcQuery.trim());
          }}
        >
          <label>
            <span className="provider-label">
              <img
                alt=""
                aria-hidden="true"
                className="provider-icon"
                src={bbsmcBranding?.iconSrc}
              />
              {bbsmcSearchLabel}
            </span>
            <TextField
              placeholder={
                contentType === "modpacks"
                  ? t("marketplace.bbsmc.modpackPlaceholder")
                  : t("marketplace.bbsmc.modPlaceholder")
              }
              value={bbsmcQuery}
              onChange={(event) => setBbsmcQuery(event.target.value)}
            />
          </label>
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
          <Button
            disabled={bbsmcQuery.trim() === "" || bbsmcQueryResult.isFetching}
            type="submit"
            variant="secondary"
          >
            {t("marketplace.bbsmc.button")}
          </Button>
        </form>
      ) : null}

      {searchQuery.error ? (
        <div className="inline-error">{searchQuery.error.message}</div>
      ) : null}
      {versionsQuery.error ? (
        <div className="inline-error">{versionsQuery.error.message}</div>
      ) : null}
      {manualMutation.error ? (
        <div className="inline-error">{manualMutation.error.message}</div>
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
          {contentType !== "plugins" && searchQuery.isFetching ? (
            <LoadingState message={t("marketplace.searchingModrinth")} />
          ) : null}
          {contentType === "plugins" && hangarQueryResult.isFetching ? (
            <LoadingState message={t("marketplace.searchingHangar")} />
          ) : null}
          {contentType !== "plugins" &&
          !searchQuery.isFetching &&
          (searchQuery.data?.length ?? 0) === 0 ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.results.title")}
              description={emptyDescription}
            />
          ) : null}
          {contentType === "plugins" &&
          !hangarQueryResult.isFetching &&
          (hangarQueryResult.data?.length ?? 0) === 0 ? (
            <EmptyState
              illustration="/illustrations/no-results.png"
              title={t("marketplace.empty.plugins.title")}
              description={emptyDescription}
            />
          ) : null}
          {contentType !== "plugins"
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
          {contentType !== "plugins"
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
          {contentType === "plugins"
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
                      {hangarBranding?.iconSrc ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="provider-icon"
                          src={hangarBranding.iconSrc}
                        />
                      ) : null}
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

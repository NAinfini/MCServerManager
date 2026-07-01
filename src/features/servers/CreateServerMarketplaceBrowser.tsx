import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, ExternalLink, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import {
  getBbsmcProject,
  getCurseForgeProject,
  getModrinthProject,
  listCurseForgeFiles,
  listBbsmcVersions,
  listModrinthVersions,
  searchBbsmcProjects,
  searchCurseForgeProjects,
  searchModrinthProjects,
  type BbsmcProjectSummary,
  type MarketplaceLoaderFilter,
  type MarketplaceSortOrder,
  type ProjectDetails,
  type ProjectSummary,
  type ProjectVersion,
} from "../marketplace/marketplaceApi";
import { MarketplaceMarkdown } from "../marketplace/MarketplaceMarkdown";
import { getMarketplaceProviderBranding } from "../marketplace/providerBranding";
import type { LoaderType } from "./types";

type MarketplaceProvider = "Modrinth" | "CurseForge" | "BBSMC";
type MarketplaceProject = ProjectSummary | BbsmcProjectSummary | ProjectDetails;

export interface MarketplaceCreateSelection {
  provider: MarketplaceProvider;
  projectId: string;
  versionId: string;
  title: string;
  versionName: string;
  loaderType?: LoaderType | null;
  minecraftVersion?: string | null;
  loaderVersion?: string | null;
}

interface CreateServerMarketplaceBrowserProps {
  onSelect: (selection: MarketplaceCreateSelection) => void;
  onDetailModeChange?: (isDetailMode: boolean) => void;
}

const providers: MarketplaceProvider[] = ["Modrinth", "CurseForge", "BBSMC"];
const discoveryQueries: Record<MarketplaceProvider, string> = {
  Modrinth: "server",
  CurseForge: "server",
  BBSMC: "\u6574\u5408",
};

function projectTitle(project: MarketplaceProject | null) {
  return project?.title || "";
}

function projectDescription(
  project: MarketplaceProject | null,
  fallback: string,
) {
  return project?.description || fallback;
}

function projectGallery(project: MarketplaceProject | null) {
  return (project?.gallery || [])
    .map((image) => (typeof image === "string" ? image : ""))
    .filter(Boolean)
    .slice(0, 5);
}

function isReadableMinecraftVersion(value: string) {
  return /^\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function readableVersionLabels(
  project: MarketplaceProject | null,
  versions: ProjectVersion[] = [],
) {
  const labels = [
    ...(project?.gameVersions || []),
    ...versions.flatMap((version) => version.gameVersions),
  ].filter(isReadableMinecraftVersion);

  return Array.from(new Set(labels)).slice(0, 5);
}

function versionMinecraftLabels(version: ProjectVersion) {
  return Array.from(
    new Set(version.gameVersions.filter(isReadableMinecraftVersion)),
  ).slice(0, 3);
}

function projectModCount(project: MarketplaceProject | null) {
  return typeof project?.modCount === "number" ? project.modCount : null;
}

function formatCount(value?: number) {
  if (!value) return "0";
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function MarketplaceProjectIcon({
  project,
  provider,
  size = "compact",
}: {
  project: MarketplaceProject | null;
  provider: MarketplaceProvider;
  size?: "compact" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const iconUrl = project?.iconUrl;
  const label = projectTitle(project).slice(0, 1) || provider.slice(0, 1);

  return (
    <div
      className={
        size === "large"
          ? "marketplace-pack-card-media marketplace-pack-card-media-large"
          : "marketplace-pack-card-media"
      }
    >
      {iconUrl && !failed ? (
        <img
          alt=""
          referrerPolicy="no-referrer"
          src={iconUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

function MarketplaceGalleryImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <img
      alt=""
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function versionLabel(version: ProjectVersion) {
  return version.versionNumber;
}

function normalizeMarketplaceLoader(loaders: string[]): LoaderType | null {
  for (const loader of loaders) {
    const normalized = loader.toLowerCase();
    if (normalized === "neoforge" || normalized === "neo-forge") {
      return "neoForge";
    }
    if (
      normalized === "vanilla" ||
      normalized === "paper" ||
      normalized === "forge" ||
      normalized === "fabric"
    ) {
      return normalized;
    }
  }
  return null;
}

function marketplaceSelectionMetadata(
  project: MarketplaceProject,
  version: ProjectVersion,
) {
  const loaderType = normalizeMarketplaceLoader([
    ...version.loaders,
    ...project.loaders,
  ]);
  const minecraftVersion =
    version.gameVersions.find(isReadableMinecraftVersion) ??
    project.gameVersions.find(isReadableMinecraftVersion) ??
    null;
  const loaderVersion = versionLabel(version) || version.name || null;

  return { loaderType, minecraftVersion, loaderVersion };
}

function versionIsDirectlyInstallable(
  provider: MarketplaceProvider,
  version: ProjectVersion,
) {
  if (provider !== "BBSMC") {
    return true;
  }
  return version.files.some((file) =>
    /^https:\/\/cdn\.bbsmc\.net\//i.test(file.url || ""),
  );
}

export function CreateServerMarketplaceBrowser({
  onDetailModeChange,
  onSelect,
}: CreateServerMarketplaceBrowserProps) {
  const { t } = useAppSettings();
  const [provider, setProvider] = useState<MarketplaceProvider>("Modrinth");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState(
    discoveryQueries.Modrinth,
  );
  const [loaderFilter, setLoaderFilter] =
    useState<MarketplaceLoaderFilter>("any");
  const [sortOrder, setSortOrder] = useState<MarketplaceSortOrder>("relevance");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );

  const resultsQuery = useQuery({
    queryKey: [
      "createMarketplaceSearch",
      provider,
      submittedQuery,
      loaderFilter,
      sortOrder,
    ],
    enabled: submittedQuery.trim() !== "",
    queryFn: async () => {
      if (provider === "Modrinth") {
        return searchModrinthProjects("create-server", submittedQuery, {
          projectType: "modpack",
          loader: loaderFilter,
          sort: sortOrder,
        });
      }
      if (provider === "CurseForge") {
        return searchCurseForgeProjects(submittedQuery, {
          projectType: "modpack",
          loader: loaderFilter,
          sort: sortOrder,
        });
      }
      return searchBbsmcProjects(submittedQuery, {
        projectType: "modpack",
        loader: loaderFilter,
        sort: sortOrder,
      });
    },
  });

  const results = resultsQuery.data ?? [];
  const selectedProject = useMemo(
    () => results.find((project) => project.id === selectedProjectId) ?? null,
    [results, selectedProjectId],
  );
  const isDetailMode = selectedProject !== null;

  useEffect(() => {
    onDetailModeChange?.(isDetailMode);
    return () => onDetailModeChange?.(false);
  }, [isDetailMode, onDetailModeChange]);

  const selectedDetailsQuery = useQuery({
    queryKey: ["createMarketplaceProjectDetails", provider, selectedProjectId],
    enabled: selectedProject !== null,
    queryFn: async () => {
      if (!selectedProject) {
        return null;
      }
      if (provider === "Modrinth") {
        return getModrinthProject(selectedProject.id);
      }
      if (provider === "CurseForge") {
        return getCurseForgeProject(selectedProject.id);
      }
      return getBbsmcProject(selectedProject.id);
    },
  });

  const versionsQuery = useQuery({
    queryKey: ["createMarketplaceVersions", provider, selectedProjectId],
    enabled: selectedProject !== null,
    queryFn: async () => {
      if (!selectedProject) {
        return [];
      }
      if (provider === "Modrinth") {
        return listModrinthVersions("create-server", selectedProject.id);
      }
      if (provider === "CurseForge") {
        return listCurseForgeFiles(selectedProject.id);
      }
      if (provider === "BBSMC") {
        return listBbsmcVersions(selectedProject.id);
      }
      return [];
    },
  });

  const versions = versionsQuery.data ?? [];
  const selectedDetails = selectedDetailsQuery.data ?? selectedProject;
  const isDiscoverySearch =
    query.trim() === "" && submittedQuery === discoveryQueries[provider];
  const noDescription = t("marketplace.noDescription");
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
  const providerOptions: SelectOption[] = providers.map((item) => {
    const branding = getMarketplaceProviderBranding(item);
    return {
      value: item,
      label: item,
      iconSrc: branding?.iconSrc,
      iconAlt: "",
      iconText: item.slice(0, 1),
    };
  });

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setSelectedProjectId(null);
  };

  const handleProviderChange = (item: MarketplaceProvider) => {
    setProvider(item);
    setSubmittedQuery(query.trim() || discoveryQueries[item]);
    setSelectedProjectId(null);
  };

  return (
    <section
      className="create-marketplace"
      aria-label={t("marketplace.browser.aria")}
    >
      {!isDetailMode ? (
        <div className="create-marketplace-toolbar">
          <form
            aria-label={t("marketplace.search.filters")}
            className="create-marketplace-search"
            role="search"
            onSubmit={handleSearch}
          >
            <TextField
              aria-label={t("marketplace.search.aria")}
              placeholder={t("marketplace.search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              ariaLabel={t("marketplace.providers.aria")}
              options={providerOptions}
              value={provider}
              onValueChange={(value) =>
                handleProviderChange(value as MarketplaceProvider)
              }
            />
            <Select
              ariaLabel={t("marketplace.loaderFilter")}
              options={loaderFilterOptions}
              value={loaderFilter}
              onValueChange={(value) => {
                setLoaderFilter(value as MarketplaceLoaderFilter);
                setSelectedProjectId(null);
              }}
            />
            <Select
              ariaLabel={t("marketplace.sortOrder")}
              options={sortOrderOptions}
              value={sortOrder}
              onValueChange={(value) => {
                setSortOrder(value as MarketplaceSortOrder);
                setSelectedProjectId(null);
              }}
            />
            <Button
              disabled={query.trim() === ""}
              type="submit"
              variant="primary"
            >
              <Search aria-hidden="true" size={15} />
              {t("marketplace.search.button")}
            </Button>
          </form>
        </div>
      ) : null}

      {resultsQuery.error ? (
        <div className="wizard-picker-error" role="alert">
          {resultsQuery.error.message}
        </div>
      ) : null}
      {versionsQuery.error ? (
        <div className="wizard-picker-error" role="alert">
          {versionsQuery.error.message}
        </div>
      ) : null}

      {!selectedProject ? (
        <div className="create-marketplace-layout">
          <section
            className="marketplace-results-list"
            aria-label={t("marketplace.projects.aria")}
          >
            {resultsQuery.isFetching ? (
              <LoadingState
                message={t("marketplace.searching", { provider })}
              />
            ) : null}
            {!resultsQuery.isFetching && results.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-results.png"
                title={
                  isDiscoverySearch
                    ? t("marketplace.empty.featured.title")
                    : t("marketplace.empty.found.title")
                }
                description={
                  isDiscoverySearch
                    ? t("marketplace.empty.featured.description")
                    : t("marketplace.empty.found.description")
                }
              />
            ) : null}
            {results.map((project) => {
              const modCount = projectModCount(project);
              return (
                <button
                  className="marketplace-pack-card"
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <MarketplaceProjectIcon
                    project={project}
                    provider={provider}
                  />
                  <div className="marketplace-pack-card-body">
                    <div className="marketplace-pack-card-title">
                      <strong>{projectTitle(project)}</strong>
                      <small className="meta-badge meta-badge-provider">
                        {provider}
                      </small>
                    </div>
                    <span>{projectDescription(project, noDescription)}</span>
                    <div className="marketplace-pack-card-meta">
                      <small className="meta-badge meta-badge-downloads">
                        {t("marketplace.downloads", {
                          count: formatCount(project?.downloads),
                        })}
                      </small>
                      {modCount !== null ? (
                        <small className="meta-badge meta-badge-mods">
                          {t("marketplace.modsCount", {
                            count: formatCount(modCount),
                          })}
                        </small>
                      ) : null}
                      {readableVersionLabels(project)
                        .slice(0, 2)
                        .map((version) => (
                          <small
                            className="meta-badge meta-badge-version"
                            key={version}
                          >
                            {version}
                          </small>
                        ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        </div>
      ) : (
        <div className="create-marketplace-layout create-marketplace-layout-detail">
          <article
            aria-label={projectTitle(selectedDetails)}
            className="marketplace-detail-view"
          >
            {versionsQuery.isFetching || selectedDetailsQuery.isFetching ? (
              <LoadingState message={t("marketplace.loadingDetails")} />
            ) : (
              <div className="marketplace-version-stack">
                <Button
                  className="marketplace-detail-back"
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedProjectId(null)}
                >
                  <ChevronLeft aria-hidden="true" size={14} />
                  {t("wizard.nav.back")}
                </Button>
                <div className="marketplace-pack-detail-grid">
                  <div className="marketplace-pack-detail-main">
                    <div className="marketplace-pack-detail-hero">
                      <MarketplaceProjectIcon
                        project={selectedDetails}
                        provider={provider}
                        size="large"
                      />
                      <div>
                        <div className="marketplace-pack-detail-title">
                          <h3>{projectTitle(selectedDetails)}</h3>
                          {selectedDetails?.websiteUrl ? (
                            <a
                              aria-label={t("marketplace.openProviderPage", {
                                provider,
                              })}
                              className="marketplace-site-link-icon"
                              href={selectedDetails.websiteUrl}
                              title={t("marketplace.openProviderPage", {
                                provider,
                              })}
                            >
                              <ExternalLink aria-hidden="true" size={15} />
                            </a>
                          ) : null}
                        </div>
                        <p>
                          {projectDescription(selectedDetails, noDescription)}
                        </p>
                      </div>
                    </div>
                    <div className="marketplace-pack-detail-meta">
                      <span className="meta-badge meta-badge-downloads">
                        {t("marketplace.downloads", {
                          count: formatCount(selectedDetails?.downloads),
                        })}
                      </span>
                      {projectModCount(selectedDetails) !== null ? (
                        <span className="meta-badge meta-badge-mods">
                          {t("marketplace.modsCount", {
                            count: formatCount(
                              projectModCount(selectedDetails) ?? 0,
                            ),
                          })}
                        </span>
                      ) : null}
                      <span className="meta-badge meta-badge-follows">
                        {t("marketplace.follows", {
                          count: formatCount(selectedDetails?.follows),
                        })}
                      </span>
                      <span className="meta-badge meta-badge-version">
                        {readableVersionLabels(selectedDetails, versions).join(
                          ", ",
                        ) || t("marketplace.versionsUnknown")}
                      </span>
                    </div>
                    {projectGallery(selectedDetails).length > 0 ? (
                      <div
                        className="marketplace-pack-gallery"
                        aria-label={t("marketplace.screenshots")}
                      >
                        {projectGallery(selectedDetails).map((image) => (
                          <MarketplaceGalleryImage key={image} src={image} />
                        ))}
                      </div>
                    ) : null}
                    {selectedDetails?.body || selectedDetails?.description ? (
                      <MarketplaceMarkdown
                        source={
                          selectedDetails.body || selectedDetails.description
                        }
                      />
                    ) : null}
                  </div>
                  <aside
                    aria-label={t("marketplace.versions.aria")}
                    className="marketplace-pack-version-sidebar"
                  >
                    <div className="marketplace-pack-version-sidebar-header">
                      <h4>{t("marketplace.versions.aria")}</h4>
                      <span>{versions.length}</span>
                    </div>
                    {versions.length === 0 ? (
                      <p className="danger-text">
                        {t("marketplace.noInstallableVersions")}
                      </p>
                    ) : null}
                    <div className="marketplace-version-list-compact">
                      {versions.map((version) => {
                        const directlyInstallable =
                          versionIsDirectlyInstallable(provider, version);
                        const minecraftLabels =
                          versionMinecraftLabels(version);
                        return (
                          <button
                            className="marketplace-install-version"
                            disabled={!directlyInstallable}
                            key={version.id}
                            title={
                              directlyInstallable
                                ? undefined
                                : t("marketplace.externalDiskOnly")
                            }
                            type="button"
                            onClick={() =>
                              onSelect({
                                provider,
                                projectId: selectedProject.id,
                                versionId: version.id,
                                title: projectTitle(selectedProject),
                                versionName: versionLabel(version),
                                ...marketplaceSelectionMetadata(
                                  selectedProject,
                                  version,
                                ),
                              })
                            }
                          >
                            <span>
                              <strong>{versionLabel(version)}</strong>
                              <small>{version.name}</small>
                              {minecraftLabels.length > 0 ? (
                                <small className="meta-badge meta-badge-version marketplace-version-minecraft">
                                  {t("marketplace.minecraftVersion", {
                                    version: minecraftLabels.join(", "),
                                  })}
                                </small>
                              ) : null}
                              {!directlyInstallable ? (
                                <small>
                                  {t("marketplace.externalDownloadRequired")}
                                </small>
                              ) : null}
                            </span>
                            <Download aria-hidden="true" size={15} />
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                </div>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

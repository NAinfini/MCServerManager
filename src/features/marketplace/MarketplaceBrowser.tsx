import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  ButtonGroup,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FolderOpen,
  Package,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { LoadingState } from "../../components/ui/loading-state";
import { Select, type SelectOption } from "../../components/ui/select";
import type { ServerProfile } from "../../domain/server";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import {
  listInstalledContent,
  type InstalledContent,
} from "../content/contentApi";
import { contentKeys } from "../content/queries";
import { LoaderPill } from "../loaders/LoaderIdentity";
import type { LoaderType } from "../servers/types";
import { InstallDialog } from "./InstallDialog";
import { ProjectDetails, ProjectIcon } from "./ProjectDetails";
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
  marketplaceDiscoveryQueries,
  marketplaceProviderOption,
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
    (value) => ({ ...marketplaceProviderOption(value), iconAlt: undefined }),
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
    <Stack
      aria-label={t("marketplace.server.aria")}
      className="marketplace-panel"
      component="section"
      gap="sm"
    >
      {!selectedProject && !isCreateMode ? (
        <Group gap="sm" justify="space-between">
          <ButtonGroup aria-label={t("marketplace.contentType.aria")}>
            {(["mods", "plugins", "modpacks"] as const).map((value) => {
              const Icon = contentTypeIcons[value];
              return (
                <Button
                  aria-pressed={contentType === value}
                  key={value}
                  variant={contentType === value ? "primary" : "secondary"}
                  onClick={() => {
                    setContentType(value);
                    setSource(sourcesForContentType(value)[0]);
                    setSubmittedQuery("");
                    setQuery("");
                    resetSearchContext();
                  }}
                >
                  <Icon aria-hidden="true" size={16} />
                  {t(`marketplace.contentType.${value}`)}
                </Button>
              );
            })}
          </ButtonGroup>
          <Group gap="xs">
            <Group aria-label={t("marketplace.compatibility.active")} gap={4}>
              <Badge color="gray" tt="none" variant="light">
                {t("marketplace.compatibility.minecraft", {
                  version: server?.minecraftVersion,
                })}
              </Badge>
              {server ? <LoaderPill loaderType={server.loaderType} /> : null}
            </Group>
            {contentType !== "plugins" ? (
              <Button
                disabled={importFileMutation.isPending}
                variant="secondary"
                onClick={() => importFileMutation.mutate()}
              >
                <FolderOpen aria-hidden="true" size={16} />
                {t("marketplace.manual.importFile")}
              </Button>
            ) : null}
          </Group>
        </Group>
      ) : null}

      {!selectedProject ? (
        <Group component="form" gap="xs" onSubmit={handleSubmit}>
          <Box w={150}>
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
          </Box>
          <TextInput
            aria-label={t("marketplace.search.aria")}
            flex={1}
            leftSection={<Search aria-hidden="true" size={16} />}
            miw={220}
            name="marketplace-query"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Box w={140}>
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
          </Box>
          <Box w={150}>
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
          </Box>
          <Button
            disabled={query.trim() === "" || activeSearch.isFetching}
            type="submit"
            variant="primary"
          >
            <Search aria-hidden="true" size={16} />
            {t("marketplace.search.button")}
          </Button>
        </Group>
      ) : null}

      {importFileMutation.error ? (
        <Alert color="red">{importFileMutation.error.message}</Alert>
      ) : null}

      {!selectedProject ? (
        <Stack gap="sm">
          <Box aria-label={t("marketplace.results.aria")} component="section">
            {activeSearch.isFetching ? (
              <LoadingState
                message={t("marketplace.searching", { provider: source })}
              />
            ) : activeSearch.error ? (
              <Alert color="red" title={t("marketplace.search.loadError")}>
                <Stack align="flex-start" gap="xs">
                  <Text size="sm">{activeSearch.error.message}</Text>
                  <Button
                    variant="secondary"
                    onClick={() => activeSearch.refetch()}
                  >
                    <RefreshCw aria-hidden="true" size={16} />
                    {t("common.retry")}
                  </Button>
                </Stack>
              </Alert>
            ) : !searchEnabled || results.length === 0 ? (
              <Stack gap={2} p="md">
                <Text fw={600} size="sm">
                  {!searchEnabled
                    ? t("marketplace.empty.search.title")
                    : t("marketplace.empty.results.title")}
                </Text>
                <Text c="dimmed" size="sm">
                  {emptyDescription}
                </Text>
              </Stack>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="xs">
                {results.map((project) => {
                  const installed = installedForProject(
                    installedQuery.data ?? [],
                    project,
                    source,
                  );
                  return (
                    <Card
                      component="button"
                      key={`${source}-${project.id}`}
                      padding="sm"
                      style={{ cursor: "pointer", textAlign: "left" }}
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
                      <Group align="flex-start" gap="sm" wrap="nowrap">
                        <ProjectIcon
                          iconUrl={project.iconUrl}
                          provider={source}
                          size={44}
                          title={project.title}
                        />
                        <Stack flex={1} gap={2} miw={0}>
                          <Group gap="xs" justify="space-between" wrap="nowrap">
                            <Text fw={600} size="sm" truncate>
                              {project.title}
                            </Text>
                            <Group gap={4} wrap="nowrap">
                              {!isCreateMode ? (
                                <Badge
                                  color="gray"
                                  leftSection={
                                    <CheckCircle2 aria-hidden="true" size={12} />
                                  }
                                  size="sm"
                                  tt="none"
                                  variant="light"
                                >
                                  {t("marketplace.compatibility.match")}
                                </Badge>
                              ) : null}
                              {installed.length === 1 ? (
                                <Badge size="sm" tt="none" variant="light">
                                  {t("marketplace.installed")}
                                </Badge>
                              ) : installed.length > 1 ? (
                                <Badge
                                  color="yellow"
                                  leftSection={
                                    <CircleAlert aria-hidden="true" size={12} />
                                  }
                                  size="sm"
                                  tt="none"
                                  variant="light"
                                >
                                  {t("marketplace.duplicate", {
                                    count: installed.length,
                                  })}
                                </Badge>
                              ) : null}
                            </Group>
                          </Group>
                          <Text c="dimmed" lineClamp={2} size="xs">
                            {project.description}
                          </Text>
                          <Group c="dimmed" fz="xs" gap="sm" mt={2}>
                            <span>{source}</span>
                            {typeof project.downloads === "number" ? (
                              <Group gap={4} wrap="nowrap">
                                <Download aria-hidden="true" size={12} />
                                {t("marketplace.downloads", {
                                  count: formatCompactNumber(project.downloads),
                                })}
                              </Group>
                            ) : null}
                            {project.gameVersions[0] ? (
                              <Badge
                                color="gray"
                                size="xs"
                                tt="none"
                                variant="outline"
                              >
                                {project.gameVersions[0]}
                              </Badge>
                            ) : null}
                            {project.loaders[0] ? (
                              <Badge
                                color="gray"
                                size="xs"
                                tt="none"
                                variant="outline"
                              >
                                {project.loaders[0]}
                              </Badge>
                            ) : null}
                          </Group>
                        </Stack>
                      </Group>
                    </Card>
                  );
                })}
              </SimpleGrid>
            )}
          </Box>
          {searchEnabled &&
          !activeSearch.error &&
          !activeSearch.isFetching &&
          results.length > 0 ? (
            <Group
              aria-label={t("marketplace.pagination.aria")}
              component="nav"
              gap="sm"
              justify="center"
            >
              <Button
                disabled={page === 0}
                variant="secondary"
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft aria-hidden="true" size={16} />
                {t("common.previous")}
              </Button>
              <Text c="dimmed" size="sm">
                {t("marketplace.pagination.page", { page: page + 1 })}
              </Text>
              <Button
                disabled={results.length < PAGE_SIZE}
                variant="secondary"
                onClick={() => setPage((value) => value + 1)}
              >
                {t("common.next")}
                <ChevronRight aria-hidden="true" size={16} />
              </Button>
            </Group>
          ) : null}
        </Stack>
      ) : (
        <Box className="marketplace-layout marketplace-layout-has-selection marketplace-layout-detail-mode">
          <Stack className="marketplace-detail-pane" gap="sm">
            <Group gap="sm">
              <Button variant="ghost" onClick={resetSelection}>
                <ArrowLeft aria-hidden="true" size={16} />
                {t("marketplace.backToResults")}
              </Button>
              <Badge color="gray" tt="none" variant="light">
                {selectedProvider}
              </Badge>
              {!isCreateMode && server ? (
                <Text c="dimmed" ff="monospace" size="xs">
                  {server.minecraftVersion} / {server.loaderType}
                </Text>
              ) : null}
              {isCreateMode && props.detailAction ? (
                <Box ml="auto">{props.detailAction}</Box>
              ) : null}
            </Group>

            {selectedInstalled.length > 0 ? (
              <Alert
                icon={<CheckCircle2 aria-hidden="true" size={16} />}
                role="status"
              >
                {selectedInstalled.length === 1
                  ? t("marketplace.installed.detail", {
                      version:
                        selectedInstalled[0].version ?? t("common.unknown"),
                    })
                  : t("marketplace.duplicate.detail", {
                      count: selectedInstalled.length,
                    })}
              </Alert>
            ) : null}
            {installedResult ? (
              <Alert
                aria-live="polite"
                icon={<CheckCircle2 aria-hidden="true" size={16} />}
                role="status"
                title={t("marketplace.install.success", {
                  name: installedResult.name,
                })}
              >
                {t("marketplace.install.restartRequired")}
              </Alert>
            ) : null}
            {projectQuery.error ? (
              <Alert color="red">
                <Stack align="flex-start" gap="xs">
                  <Text size="sm">{projectQuery.error.message}</Text>
                  <Button
                    variant="secondary"
                    onClick={() => projectQuery.refetch()}
                  >
                    {t("common.retry")}
                  </Button>
                </Stack>
              </Alert>
            ) : null}

            <ProjectDetails
              isLoading={projectQuery.isLoading || versionsQuery.isLoading}
              project={projectQuery.data ?? selectedProject}
              provider={selectedProvider}
              selectedVersionId={selectedVersionId}
              versions={versions}
              versionsError={
                versionsQuery.error ? (
                  <Alert color="red" title={t("marketplace.versions.loadError")}>
                    <Stack align="flex-start" gap="xs">
                      <Text size="sm">{versionsQuery.error.message}</Text>
                      <Button
                        variant="secondary"
                        onClick={() => versionsQuery.refetch()}
                      >
                        {t("common.retry")}
                      </Button>
                    </Stack>
                  </Alert>
                ) : undefined
              }
              versionAction={
                selectedVersion ? (
                  isCreateMode ? (
                    <Button
                      style={{ width: "100%" }}
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
                      style={{ width: "100%" }}
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
                  <Text c="dimmed" size="xs">
                    {t("marketplace.selectVersionHint")}
                  </Text>
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
          </Stack>
        </Box>
      )}

      <DialogSurface
        open={pendingCreateSelection !== null}
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
    </Stack>
  );
}

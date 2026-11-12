import {
  Anchor,
  Avatar,
  Badge,
  Box,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ProjectDetails as ProjectDetailsData,
  ProjectVersion,
} from "./marketplaceApi";
import { isVerifiedServerPack } from "./marketplaceApi";
import { useAppSettings } from "../../i18n";
import { MarketplaceMarkdown } from "./MarketplaceMarkdown";
import { getMarketplaceProviderBranding } from "./providerBranding";

interface ProjectDetailsProps {
  project: ProjectDetailsData | null;
  versions: ProjectVersion[];
  isLoading: boolean;
  provider?: string;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  /* Rendered in the version panel footer so the primary action sits with the
     list it acts on instead of below a description that can run for pages. */
  versionAction?: ReactNode;
  versionsError?: ReactNode;
}

const BBSMC_EXTERNAL_DOWNLOAD_WARNING =
  "This BBSMC version also provides external disk download links.";

/* Providers overwhelmingly open their description with the pack name as an H1,
   which then lands directly under the heading that already says it. Dropping
   the duplicate is safe because the heading is always rendered. */
function stripDuplicateTitleHeading(body: string, title: string) {
  const normalized = title.trim().toLowerCase();
  return body.replace(
    /^\s*#{1,2}[ \t]+(.+?)[ \t]*(?:\r?\n|$)/,
    (match, heading) =>
      String(heading).trim().toLowerCase() === normalized ? "" : match,
  );
}

/* The project's own icon, then the provider's logo when that fails to load,
   then the first letter of the title. */
export function ProjectIcon({
  iconUrl,
  provider,
  size,
  title,
}: {
  iconUrl?: string | null;
  provider?: string;
  size: number;
  title: string;
}) {
  const brandingSrc = provider
    ? getMarketplaceProviderBranding(provider)?.iconSrc
    : undefined;

  return (
    <Avatar
      alt=""
      aria-hidden="true"
      color="gray"
      imageProps={{ referrerPolicy: "no-referrer" }}
      radius="md"
      size={size}
      src={iconUrl || brandingSrc}
      variant="light"
    >
      {iconUrl && brandingSrc ? (
        <Image alt="" h="100%" src={brandingSrc} w="100%" />
      ) : (
        title.slice(0, 1).toUpperCase()
      )}
    </Avatar>
  );
}

export function ProjectDetails({
  project,
  versions,
  isLoading,
  provider,
  selectedVersionId,
  onSelectVersion,
  versionAction,
  versionsError,
}: ProjectDetailsProps) {
  const { formatCompactNumber, language, t } = useAppSettings();
  const warningLabel = (warning: string) =>
    provider === "BBSMC" && warning === BBSMC_EXTERNAL_DOWNLOAD_WARNING
      ? t("marketplace.bbsmc.externalDownload")
      : warning;

  if (isLoading) {
    return (
      <Group gap="xs" p="md">
        <Loader size="xs" />
        <Text c="dimmed" size="sm">
          {t("marketplace.details.loading")}
        </Text>
      </Group>
    );
  }

  if (!project) {
    return (
      <Stack gap={2} p="md">
        <Title order={4}>{t("marketplace.details.empty.title")}</Title>
        <Text c="dimmed" size="sm">
          {t("marketplace.details.empty.description")}
        </Text>
      </Stack>
    );
  }

  const body = project.body
    ? stripDuplicateTitleHeading(project.body, project.title)
    : "";
  const updatedAt = project.updatedAt ? new Date(project.updatedAt) : null;
  const stats = [
    project.downloads === undefined || project.downloads === null
      ? null
      : {
          key: "downloads",
          label: t("marketplace.stat.downloads"),
          value: formatCompactNumber(project.downloads),
        },
    project.follows === undefined || project.follows === null
      ? null
      : {
          key: "follows",
          label: t("marketplace.stat.follows"),
          value: formatCompactNumber(project.follows),
        },
    project.modCount
      ? {
          key: "mods",
          label: t("marketplace.stat.mods"),
          value: formatCompactNumber(project.modCount),
        }
      : null,
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? {
          key: "updated",
          label: t("marketplace.stat.updated"),
          value: new Intl.DateTimeFormat(language, {
            dateStyle: "medium",
          }).format(updatedAt),
        }
      : null,
  ].filter((stat): stat is { key: string; label: string; value: string } =>
    Boolean(stat),
  );
  const tags = [...project.loaders, ...project.gameVersions].slice(0, 5);

  return (
    <Stack
      aria-label={t("marketplace.details.aria")}
      className="marketplace-details"
      component="section"
      gap="md"
    >
      <Group align="flex-start" gap="md" wrap="nowrap">
        <ProjectIcon
          iconUrl={project.iconUrl}
          provider={provider}
          size={64}
          title={project.title}
        />
        <Stack flex={1} gap={6} miw={0}>
          <Title order={2}>{project.title}</Title>
          <Text c="dimmed" size="sm">
            {project.description}
          </Text>
          {stats.length > 0 ? (
            <Group
              aria-label={t("marketplace.projectStats")}
              component="dl"
              gap="lg"
              m={0}
            >
              {stats.map((stat) => (
                <Stack gap={0} key={stat.key}>
                  <Text component="dd" ff="monospace" fw={600} m={0} size="sm">
                    {stat.value}
                  </Text>
                  <Text c="dimmed" component="dt" size="xs">
                    {stat.label}
                  </Text>
                </Stack>
              ))}
            </Group>
          ) : null}
        </Stack>
        <Stack align="flex-end" gap="xs">
          {project.websiteUrl ? (
            <Anchor
              href={project.websiteUrl}
              size="sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <ExternalLink aria-hidden="true" size={14} />
              {t("marketplace.openProviderPage", {
                provider: provider || t("marketplace.provider"),
              })}
            </Anchor>
          ) : null}
          {tags.length > 0 ? (
            <Group gap={4} justify="flex-end">
              {tags.map((tag) => (
                <Badge color="gray" key={tag} size="sm" tt="none" variant="light">
                  {tag}
                </Badge>
              ))}
            </Group>
          ) : null}
        </Stack>
      </Group>

      <Grid gap="md">
        <Grid.Col order={{ base: 2, lg: 1 }} span={{ base: 12, lg: 8 }}>
          {body ? (
            <Paper p="md">
              <MarketplaceMarkdown source={body} />
            </Paper>
          ) : null}
        </Grid.Col>

        <Grid.Col order={{ base: 1, lg: 2 }} span={{ base: 12, lg: 4 }}>
          <Paper component="aside" p="md">
            {versionsError ? (
              versionsError
            ) : versions.length === 0 ? (
              <Text c="red" size="sm">
                {t("marketplace.details.noCompatible")}
              </Text>
            ) : (
              <Stack gap="sm">
                <Group justify="space-between">
                  <Title order={4}>{t("marketplace.details.versions")}</Title>
                  <Text c="dimmed" size="xs">
                    {t("marketplace.details.versionCount", {
                      count: versions.length,
                    })}
                  </Text>
                </Group>
                <ScrollArea.Autosize mah={420} type="auto">
                  <Stack gap={2}>
                    {versions.map((version, index) => {
                      const showVersionNumber =
                        version.versionNumber &&
                        version.versionNumber !== version.id &&
                        version.versionNumber !== version.name;
                      const chips = [
                        ...version.gameVersions.slice(0, 2),
                        ...version.loaders.slice(0, 1),
                      ];
                      const selected = version.id === selectedVersionId;
                      return (
                        <UnstyledButton
                          bg={
                            selected
                              ? "var(--mantine-primary-color-light)"
                              : undefined
                          }
                          key={version.id}
                          px="sm"
                          py={6}
                          style={{ borderRadius: "var(--mantine-radius-sm)" }}
                          onClick={() => onSelectVersion(version.id)}
                        >
                          <Group gap="xs" justify="space-between" wrap="nowrap">
                            <Text fw={600} size="sm" truncate>
                              {version.name}
                            </Text>
                            {showVersionNumber ? (
                              <Text c="dimmed" ff="monospace" size="xs" truncate>
                                {version.versionNumber}
                              </Text>
                            ) : null}
                          </Group>
                          <Group gap={4} mt={4}>
                            {index === 0 ? (
                              <Badge size="xs" tt="none" variant="light">
                                {t("marketplace.details.latest")}
                              </Badge>
                            ) : null}
                            {chips.map((chip) => (
                              <Badge
                                color="gray"
                                key={chip}
                                size="xs"
                                tt="none"
                                variant="light"
                              >
                                {chip}
                              </Badge>
                            ))}
                            {isVerifiedServerPack(version) ? (
                              <Badge size="xs" tt="none" variant="outline">
                                {t("marketplace.serverPackBadge")}
                              </Badge>
                            ) : null}
                          </Group>
                          {version.dependencies.some(
                            (dependency) =>
                              dependency.dependencyType === "required",
                          ) ? (
                            <Text c="dimmed" mt={2} size="xs">
                              {t("marketplace.details.requiresDependencies")}
                            </Text>
                          ) : null}
                          {version.warnings.length > 0 ? (
                            <Text c="red" mt={2} size="xs">
                              {version.warnings.map(warningLabel).join("; ")}
                            </Text>
                          ) : null}
                        </UnstyledButton>
                      );
                    })}
                  </Stack>
                </ScrollArea.Autosize>
                {versionAction ? <Box>{versionAction}</Box> : null}
              </Stack>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

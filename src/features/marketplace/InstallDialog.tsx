import { useQueries } from "@tanstack/react-query";
import { Alert, Badge, Checkbox, Stack, Table, Text } from "@mantine/core";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";
import {
  getBbsmcProject,
  getHangarProject,
  getModrinthProject,
  type ProjectSummary,
  type ProjectVersion,
} from "./marketplaceApi";
import type { MarketplaceProvider } from "./providerBranding";
import { marketplaceKeys } from "./queries";

interface InstallDialogProps {
  project: ProjectSummary;
  version: ProjectVersion;
  error: string | null;
  isInstalling: boolean;
  installAnyway: boolean;
  onCancel: () => void;
  onInstallAnywayChange: (value: boolean) => void;
  onInstall: () => void;
  sourceLabel?: MarketplaceProvider;
}

function getDependencyProject(
  provider: MarketplaceProvider,
  projectId: string,
) {
  if (provider === "BBSMC") return getBbsmcProject(projectId);
  if (provider === "Hangar") return getHangarProject(projectId);
  return getModrinthProject(projectId);
}

export function InstallDialog({
  project,
  version,
  error,
  isInstalling,
  installAnyway,
  onCancel,
  onInstallAnywayChange,
  onInstall,
  sourceLabel = "Modrinth",
}: InstallDialogProps) {
  const { t } = useAppSettings();
  const requiresInstallAnyway = version.warnings.length > 0;
  const dependencyProjectIds = [
    ...new Set(
      version.dependencies.flatMap((dependency) =>
        dependency.projectId ? [dependency.projectId] : [],
      ),
    ),
  ];
  const dependencyQueries = useQueries({
    queries: dependencyProjectIds.map((projectId) => ({
      queryKey: marketplaceKeys.project(sourceLabel, projectId),
      queryFn: () => getDependencyProject(sourceLabel, projectId),
      retry: false,
    })),
  });
  const dependencyQueryByProjectId = new Map(
    dependencyProjectIds.map((projectId, index) => [
      projectId,
      dependencyQueries[index],
    ]),
  );
  const dependencyLabel = (dependencyType: string) => {
    if (dependencyType === "required")
      return t("marketplace.dependency.required");
    if (dependencyType === "optional")
      return t("marketplace.dependency.optional");
    if (dependencyType === "incompatible") {
      return t("marketplace.dependency.incompatible");
    }
    return t("marketplace.dependency.other");
  };

  return (
    <DialogSurface
      open
      title={t("marketplace.install.title", { title: project.title })}
      description={t("marketplace.install.description", {
        version: version.versionNumber,
        source: sourceLabel,
      })}
      onOpenChange={(open) => !open && onCancel()}
      footer={
        <>
          <Button
            disabled={isInstalling}
            variant="secondary"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isInstalling || (requiresInstallAnyway && !installAnyway)}
            variant="primary"
            onClick={onInstall}
          >
            <Download aria-hidden="true" size={16} />
            {isInstalling
              ? t("marketplace.install.installing")
              : error
                ? t("marketplace.install.retry")
                : t("marketplace.install.button")}
          </Button>
        </>
      }
    >
      <Stack gap="sm" mt="md">
        {version.dependencies.length > 0 ? (
          <Stack gap={4}>
            <Text fw={600} size="sm">
              {t("marketplace.install.dependencies")}
            </Text>
            <Text c="dimmed" size="xs">
              {t("marketplace.install.dependenciesDescription")}
            </Text>
            <Table verticalSpacing={6}>
              <Table.Tbody>
                {version.dependencies.map((dependency, index) => (
                  <Table.Tr
                    key={`${dependency.projectId ?? dependency.versionId ?? "dependency"}-${index}`}
                  >
                    <Table.Td>
                      <Text fw={500} size="sm">
                        {dependency.projectId
                          ? (dependencyQueryByProjectId.get(
                              dependency.projectId,
                            )?.data?.title ??
                            (dependencyQueryByProjectId.get(dependency.projectId)
                              ?.isLoading
                              ? t("marketplace.dependency.resolving")
                              : t("marketplace.dependency.unresolved")))
                          : t("marketplace.dependency.unresolved")}
                      </Text>
                      <Text c="dimmed" ff="monospace" size="xs">
                        {[dependency.projectId, dependency.versionId]
                          .filter(Boolean)
                          .join(" / ") || t("common.unknown")}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Badge
                        color={
                          dependency.dependencyType === "incompatible"
                            ? "red"
                            : "gray"
                        }
                        size="sm"
                        tt="none"
                        variant="light"
                      >
                        {dependencyLabel(dependency.dependencyType)}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ) : null}
        {requiresInstallAnyway ? (
          <Checkbox
            checked={installAnyway}
            disabled={isInstalling}
            label={t("marketplace.install.reviewWarnings")}
            onChange={(event) =>
              onInstallAnywayChange(event.currentTarget.checked)
            }
          />
        ) : null}
        {version.warnings.length > 0 ? (
          <Text c="red" size="sm">
            {version.warnings.join("; ")}
          </Text>
        ) : null}
        {error ? (
          <Alert color="red" title={t("marketplace.install.failed")}>
            <Text size="sm">{error}</Text>
            <Text size="sm">{t("marketplace.install.recovery")}</Text>
          </Alert>
        ) : null}
      </Stack>
    </DialogSurface>
  );
}

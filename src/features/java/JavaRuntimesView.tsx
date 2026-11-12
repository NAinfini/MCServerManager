import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Coffee,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Code,
  Group,
  Image,
  Paper,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { toAppHash } from "../../app/router";
import { queryKeys } from "../../lib/query-keys";
import { publicAssetUrl } from "../../lib/public-asset";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
import {
  listJavaRuntimes,
  removeJavaRuntime,
  type JavaRuntime,
  type JavaScanFailure,
  type ServerJavaCompatibility,
} from "./javaApi";
import { javaDiagnosis } from "./javaDiagnosis";
import { useJavaProvisioning, type JavaTarget } from "./useJavaProvisioning";

function compatibilityColor(status: string) {
  if (status === "compatible") return "green";
  if (status === "warning") return "yellow";
  return "gray";
}

/* One surface per question the page answers, named by its heading so it reads
   as a region. */
function JavaPanel({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Paper aria-labelledby={id} component="section" p="md">
      <Group align="baseline" justify="space-between" mb="sm">
        <Title id={id} order={3}>
          {title}
        </Title>
        <Text c="dimmed" size="xs">
          {subtitle}
        </Text>
      </Group>
      {children}
    </Paper>
  );
}

function isAdoptiumRuntime(vendor?: string | null) {
  return /adoptium|temurin/i.test(vendor ?? "");
}

function javaDownloadUrl(majorVersion: number) {
  return `https://adoptium.net/temurin/releases/?version=${majorVersion}`;
}

/* Windows paths differ in case and separator between the scan and the stored
   profile, so comparing them raw reports a runtime as unused while a server is
   running on it. */
function samePath(left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  return (
    left.replace(/\\/g, "/").toLowerCase() ===
    right.replace(/\\/g, "/").toLowerCase()
  );
}

function runtimeSourceLabel(source: string, t: (key: string) => string) {
  const keyBySource: Record<string, string> = {
    managed: "java.source.managed",
    "Managed by MC Server Manager": "java.source.managed",
    "Server profile": "java.source.serverProfile",
    "Installed on this machine": "java.source.systemInstall",
    PATH: "java.source.path",
    JAVA_HOME: "java.source.javaHome",
  };
  const key = keyBySource[source];
  return key ? t(key) : source;
}

/* Scan failures arrive as data, so the English message is the fallback rather
   than the value: a code means the same locale entry the thrown errors use. */
function failureMessage(
  failure: JavaScanFailure,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!failure.code) return failure.error;
  return t(`desktop.error.${failure.code}`, { detail: failure.detail ?? "" });
}

export function JavaRuntimesView() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [pendingRemoval, setPendingRemoval] = useState<JavaRuntime | null>(
    null,
  );
  const javaQuery = useQuery({
    queryKey: queryKeys.java.runtimes,
    queryFn: listJavaRuntimes,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.servers.profiles,
    });
    await javaQuery.refetch();
  };

  const compatibility = javaQuery.data?.compatibility ?? [];

  const {
    apply,
    applyError,
    busy,
    dialog: installDialog,
    start: startAcquire,
  } = useJavaProvisioning({
    onFinished: refresh,
    serverNameFor: (serverId) =>
      compatibility.find((item) => item.serverId === serverId)?.serverName,
  });

  const removeMutation = useMutation({
    mutationFn: (javaPath: string) => removeJavaRuntime(javaPath),
    onSuccess: async () => {
      setPendingRemoval(null);
      await refresh();
    },
  });

  const runtimes = javaQuery.data?.runtimes ?? [];
  const unresolved = compatibility.filter(
    (item) => item.status !== "compatible",
  );

  /* Every distinct version window the installed servers need. One runtime
     cannot serve them all: a 1.7.10 profile needs Java 8 and a 1.21 profile
     needs 21, and neither runs on the other's. */
  const neededVersions = [
    ...new Map(
      compatibility
        .filter(
          (
            item,
          ): item is ServerJavaCompatibility & {
            requiredMajorVersion: number;
          } => typeof item.requiredMajorVersion === "number",
        )
        .map((item) => [
          item.requiredMajorVersion,
          {
            majorVersion: item.requiredMajorVersion,
            maxMajorVersion: item.maxMajorVersion ?? null,
            serverId: null,
          } satisfies JavaTarget,
        ]),
    ).values(),
  ].sort((left, right) => left.majorVersion - right.majorVersion);
  const acquirable =
    neededVersions.length > 0
      ? neededVersions
      : [{ majorVersion: 21, maxMajorVersion: null, serverId: null }];

  const runtimeColumns: DataTableColumn<JavaRuntime>[] = [
    {
      id: "version",
      header: t("java.table.version"),
      rowHeader: true,
      sortValue: (runtime) => runtime.majorVersion,
      cell: (runtime) => (
        <Group gap="xs" wrap="nowrap">
          {isAdoptiumRuntime(runtime.vendor) ? (
            <Image
              alt=""
              aria-hidden="true"
              h={18}
              src={publicAssetUrl("/brand/adoptium-logo.svg")}
              w={18}
            />
          ) : (
            <ThemeIcon color="gray" size="sm" variant="light">
              <Coffee aria-hidden="true" size={14} />
            </ThemeIcon>
          )}
          <Text fw={600} size="sm" style={{ whiteSpace: "nowrap" }}>
            Java {runtime.majorVersion}
          </Text>
        </Group>
      ),
    },
    {
      id: "vendor",
      header: t("java.table.vendor"),
      cell: (runtime) => runtime.vendor ?? t("common.unknown"),
      sortValue: (runtime) => runtime.vendor,
    },
    {
      id: "architecture",
      header: t("java.table.architecture"),
      cell: (runtime) => runtime.architecture ?? t("common.unknown"),
      sortValue: (runtime) => runtime.architecture,
    },
    {
      id: "usedBy",
      header: t("java.table.usedBy"),
      /* A list of runtimes says nothing about whether any of them is in use.
         Naming the servers is what turns the table from an inventory into an
         answer, and it is how a duplicate-looking row is told apart. */
      cell: (runtime) => {
        const users = compatibility.filter((item) =>
          samePath(item.configuredJavaPath, runtime.path),
        );
        if (users.length === 0) {
          return (
            <Text c="dimmed" size="sm">
              {t("java.table.unused")}
            </Text>
          );
        }
        /* One line, truncated, with the full name on hover — a server name can
           be longer than any column width worth giving it. The link is a real
           anchor so the name is also the way to go look at that server. */
        return (
          <Text
            maw={220}
            size="sm"
            title={users.map((item) => item.serverName).join(", ")}
            truncate
          >
            {users.map((item, index) => (
              <span key={item.serverId}>
                {index > 0 ? ", " : null}
                <Anchor
                  href={toAppHash({
                    name: "server",
                    serverId: item.serverId,
                    section: "console",
                  })}
                  size="sm"
                >
                  {item.serverName}
                </Anchor>
              </span>
            ))}
          </Text>
        );
      },
    },
    {
      id: "source",
      header: t("java.table.source"),
      cell: (runtime) => (
        <Badge color="gray" size="sm" tt="none" variant="light">
          {runtimeSourceLabel(runtime.source, t)}
        </Badge>
      ),
    },
    {
      id: "path",
      header: t("java.table.path"),
      /* Paths run past any column width, so the cell shows what fits and keeps
         the rest one hover away rather than wrapping the whole row. */
      cell: (runtime) => (
        <Text
          c="dimmed"
          ff="monospace"
          maw={320}
          size="xs"
          title={runtime.path}
          truncate
        >
          {runtime.path}
        </Text>
      ),
    },
    {
      id: "actions",
      header: t("java.table.actions"),

      /* Only the runtimes this app downloaded. The others belong to the machine
         and are uninstalled the way they were installed; the backend refuses
         them too, so this is the honest affordance rather than the only guard. */
      cell: (runtime) =>
        runtime.managed ? (
          <Tooltip label={t("common.delete")}>
            <ActionIcon
              aria-label={t("common.delete")}
              color="red"
              disabled={removeMutation.isPending}
              onClick={() => {
                removeMutation.reset();
                setPendingRemoval(runtime);
              }}
            >
              <Trash2 aria-hidden="true" size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <Stack aria-labelledby="java-runtimes-title" component="section" gap="md">
      <Group justify="space-between">
        <Title id="java-runtimes-title" order={1} tabIndex={-1}>
          {t("java.title")}
        </Title>
        <Button
          disabled={javaQuery.isFetching}
          variant="secondary"
          onClick={() => javaQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("java.scan")}
        </Button>
      </Group>

      {javaQuery.isLoading ? (
        <LoadingState message={t("java.scanning")} />
      ) : null}

      {javaQuery.error ? (
        <Alert
          color="red"
          role="alert"
          title={t("java.scanError.title")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{javaQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => javaQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {javaQuery.data ? (
        <>
          {/* Servers first. The page used to open on the runtime inventory and
              bury this at the bottom, which asked the reader to translate "I
              have these four Javas" into "so can my server start?" on their
              own. That translation is the product's job. */}
          <JavaPanel
            id="java-servers-title"
            subtitle={
              unresolved.length > 0
                ? t("java.servers.needAttention", {
                    count: unresolved.length,
                  })
                : t("java.servers.allReady")
            }
            title={t("java.servers.title")}
          >
            <Stack gap="xs">
              {compatibility.map((item) => {
                const Icon =
                  item.status === "compatible" ? CheckCircle2 : AlertTriangle;
                const required = item.requiredMajorVersion;
                const usable = item.recommendedJavaPath;
                return (
                  <Group
                    align="center"
                    gap="sm"
                    key={item.serverId}
                    wrap="nowrap"
                  >
                    <ThemeIcon
                      color={compatibilityColor(item.status)}
                      size="md"
                      variant="light"
                    >
                      <Icon aria-hidden="true" size={16} />
                    </ThemeIcon>
                    <Stack flex={1} gap={2} miw={0}>
                      <Text fw={600} size="sm">
                        {item.serverName}
                      </Text>
                      <Text c="dimmed" size="sm">
                        {javaDiagnosis(item, t)}
                      </Text>
                      {item.configuredJavaPath ? (
                        <Text c="dimmed" ff="monospace" size="xs" truncate>
                          {item.configuredJavaPath}
                        </Text>
                      ) : null}
                    </Stack>
                    {item.status !== "compatible" &&
                    typeof required === "number" ? (
                      <Button
                        disabled={busy}
                        style={{ flexShrink: 0 }}
                        type="button"
                        variant={usable ? "secondary" : "primary"}
                        onClick={() =>
                          usable
                            ? apply(item.serverId, usable)
                            : startAcquire({
                                majorVersion: required,
                                maxMajorVersion: item.maxMajorVersion ?? null,
                                serverId: item.serverId,
                              })
                        }
                      >
                        {usable
                          ? t("java.action.use", { version: required })
                          : t("java.action.install", { version: required })}
                      </Button>
                    ) : null}
                  </Group>
                );
              })}
              {applyError ? (
                <Text c="red" role="alert" size="sm">
                  {applyError}
                </Text>
              ) : null}
              {compatibility.length === 0 ? (
                <EmptyState
                  title={t("java.compatibility.empty.title")}
                  description={t("java.compatibility.empty.description")}
                />
              ) : null}
            </Stack>
          </JavaPanel>

          <JavaPanel
            id="java-installed-title"
            subtitle={t("java.detected", { count: runtimes.length })}
            title={t("java.installed.title")}
          >
            {runtimes.length === 0 ? (
              <EmptyState
                title={t("java.empty.title")}
                description={t("java.empty.description")}
              />
            ) : (
              <Table.ScrollContainer minWidth={860}>
                <DataTable
                  caption={t("java.installed.title")}
                  columns={runtimeColumns}
                  getRowKey={(runtime) => `${runtime.path}-${runtime.version}`}
                  rows={runtimes}
                />
              </Table.ScrollContainer>
            )}
          </JavaPanel>

          <JavaPanel
            id="java-acquire-title"
            subtitle={t("java.managed.subtitle")}
            title={t("java.managed.title")}
          >
            <Stack gap="sm">
              <Text size="sm">{t("java.managed.description")}</Text>
              <Group gap="xs">
                {acquirable.map((entry) => (
                  <Button
                    disabled={busy}
                    key={entry.majorVersion}
                    type="button"
                    variant="secondary"
                    onClick={() => startAcquire(entry)}
                  >
                    {t("java.action.install", { version: entry.majorVersion })}
                  </Button>
                ))}
                <Group gap="md" ml="xs">
                  <Anchor
                    href="https://www.java.com/download/"
                    rel="noreferrer noopener"
                    size="sm"
                    target="_blank"
                  >
                    {t("java.managed.oracleLink")}
                  </Anchor>
                  <Anchor
                    href={javaDownloadUrl(
                      acquirable[acquirable.length - 1].majorVersion,
                    )}
                    rel="noreferrer noopener"
                    size="sm"
                    target="_blank"
                  >
                    {t("java.managed.temurinLink")}
                  </Anchor>
                </Group>
              </Group>
            </Stack>
          </JavaPanel>

          {javaQuery.data.failures.length > 0 ? (
            <JavaPanel
              id="java-failures-title"
              subtitle={t("java.failures.count", {
                count: javaQuery.data.failures.length,
              })}
              title={t("java.failures.title")}
            >
              <Stack gap="xs">
                {javaQuery.data.failures.map((failure) => (
                  <Stack gap={2} key={`${failure.path}-${failure.source}`}>
                    <Text fw={600} size="sm">
                      {runtimeSourceLabel(failure.source, t)}
                    </Text>
                    <Text c="dimmed" ff="monospace" size="xs">
                      {failure.path}
                    </Text>
                    <Text c="red" size="xs">
                      {failureMessage(failure, t)}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            </JavaPanel>
          ) : null}
        </>
      ) : null}

      {/* Deleting files off disk is not undoable, so it is confirmed. The
          dialog names the exact folder that goes, because "Java 25" is not
          enough to tell two installs apart. */}
      <DialogSurface
        description={t("java.remove.description")}
        open={pendingRemoval !== null}
        title={t("java.remove.title", {
          version: pendingRemoval?.majorVersion ?? "",
        })}
        footer={
          <>
            <Button
              disabled={removeMutation.isPending}
              variant="ghost"
              onClick={() => setPendingRemoval(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={removeMutation.isPending}
              variant="danger"
              onClick={() =>
                pendingRemoval && removeMutation.mutate(pendingRemoval.path)
              }
            >
              {t("common.delete")}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <Code block>{pendingRemoval?.path}</Code>
        {removeMutation.error ? (
          <Alert color="red" mt="sm" role="alert" variant="light">
            {removeMutation.error.message}
          </Alert>
        ) : null}
      </DialogSurface>

      {installDialog}
    </Stack>
  );
}

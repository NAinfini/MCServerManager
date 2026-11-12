import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Checkbox,
  Group,
  Input,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
import { LoadingState } from "../../components/ui/loading-state";
import { PathField } from "../../components/ui/path-field";
import { StickyActionBar } from "../../components/ui/sticky-action-bar";
import { createWorldBackup } from "../backups/backupApi";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";
import type { ServerProfile } from "../../domain/server";
import { serverKeys } from "../servers/queries";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";

interface ServerUpdateCheckItem {
  id: string;
  status: "ready" | "warning" | "blocked";
  message: string;
}

interface ServerUpdateCheck {
  serverId: string;
  loaderType: ServerProfile["loaderType"];
  currentVersion: string | null;
  targetVersion?: string | null;
  latestVersion?: string | null;
  latestLoaderVersion?: string | null;
  targetLoaderVersion: string | null;
  updateAvailable: boolean;
  installSupported: boolean;
  message: string;
  checks: ServerUpdateCheckItem[];
}

interface ServerUpdateHistory {
  id: string;
  serverId: string;
  loaderType: string;
  fromVersion: string | null;
  toVersion: string | null;
  status: string;
  message: string;
  rollbackPath: string | null;
  rollbackAvailable: boolean;
  createdAt: string;
}

interface ServerUpdatesViewProps {
  server: ServerProfile;
}

const SOURCE_LINKS: Record<ServerProfile["loaderType"], string> = {
  vanilla: "https://www.minecraft.net/download/server",
  paper: "https://papermc.io/downloads/paper",
  fabric: "https://fabricmc.net/use/server/",
  forge: "https://files.minecraftforge.net/net/minecraftforge/forge/",
  neoForge: "https://neoforged.net/",
  quilt: "https://quiltmc.org/en/install/server/",
};

const CHECK_COLORS: Record<ServerUpdateCheckItem["status"], string> = {
  ready: "gray",
  warning: "yellow",
  blocked: "red",
};

type UpdateStep = 1 | 2 | 3;
type UpdateTranslator = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => string;

function checkedVersion(
  check: ServerUpdateCheck | undefined,
  server: ServerProfile,
) {
  return (
    check?.targetVersion ??
    check?.latestVersion ??
    server.minecraftVersion ??
    null
  );
}

function historyStatusLabel(status: string, t: UpdateTranslator) {
  const knownStatuses = new Set([
    "available",
    "current",
    "installed",
    "unsupported",
    "rolledBack",
    "rollbackFailed",
  ]);
  return knownStatuses.has(status)
    ? t(`serverUpdates.history.status.${status}`)
    : status;
}

function historyMessage(entry: ServerUpdateHistory, t: UpdateTranslator) {
  const values = {
    from: entry.fromVersion ?? t("common.unknown"),
    to: entry.toVersion ?? t("common.unknown"),
  };
  if (entry.status === "installed")
    return t("serverUpdates.history.message.installed", values);
  if (entry.status === "available")
    return t("serverUpdates.history.message.available", values);
  if (entry.status === "current")
    return t("serverUpdates.history.message.current", values);
  if (entry.status === "unsupported")
    return t("serverUpdates.history.message.unsupported", values);
  if (entry.status === "rolledBack")
    return t("serverUpdates.history.message.rolledBack", values);
  return entry.message;
}

function checkSummary(
  check: ServerUpdateCheck,
  server: ServerProfile,
  t: UpdateTranslator,
) {
  if (check.updateAvailable && !check.installSupported) {
    return t("serverUpdates.checkSummary.manual");
  }
  if (check.updateAvailable) {
    return t("serverUpdates.checkSummary.available", {
      version: checkedVersion(check, server) ?? t("common.unknown"),
    });
  }
  return t("serverUpdates.checkSummary.current");
}

async function pickServerJar() {
  const result = await invokeDesktopCommandWithErrorHandling<{
    path: string | null;
  }>("show_open_dialog", {
    kind: "file",
    filters: [{ name: "Java archive", extensions: ["jar"] }],
  });
  return result.path;
}

export function ServerUpdatesView({ server }: ServerUpdatesViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const didStartAutomaticCheck = useRef(false);
  const [step, setStep] = useState<UpdateStep>(1);
  const [targetVersion, setTargetVersion] = useState("");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState("");
  const [serverJarPath, setServerJarPath] = useState("");
  const [serverJarSha256, setServerJarSha256] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [rollbackEntry, setRollbackEntry] =
    useState<ServerUpdateHistory | null>(null);

  const historyQuery = useQuery({
    queryKey: queryKeys.updates.server(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory[]>(
        "list_server_update_history",
        { serverId: server.id },
      ),
  });
  const checkMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateCheck>(
        "check_server_update",
        {
          input: { serverId: server.id },
        },
      ),
    onSuccess: async (result) => {
      setTargetVersion(result.targetVersion ?? result.latestVersion ?? "");
      setTargetLoaderVersion(
        result.targetLoaderVersion ?? result.latestLoaderVersion ?? "",
      );
      setWarningsAcknowledged(false);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.updates.server(server.id),
      });
    },
  });
  const installMutation = useMutation({
    mutationFn: async () => {
      await createWorldBackup({ serverId: server.id });
      return invokeDesktopCommandWithErrorHandling<ServerUpdateHistory>(
        "install_server_update",
        {
          input: {
            serverId: server.id,
            targetMinecraftVersion:
              targetVersion.trim() ||
              checkedVersion(checkMutation.data, server),
            targetLoaderVersion:
              targetLoaderVersion.trim() ||
              checkMutation.data?.targetLoaderVersion ||
              server.loaderVersion ||
              null,
            serverJarPath: serverJarPath.trim() || undefined,
            serverJarSha256: serverJarSha256.trim() || null,
            acknowledgeWarnings: warningsAcknowledged,
            confirm: true,
          },
        },
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.updates.server(server.id),
        }),
        queryClient.invalidateQueries({ queryKey: serverKeys.profiles }),
      ]);
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (entry: ServerUpdateHistory) =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory>(
        "rollback_server_update",
        {
          input: {
            serverId: server.id,
            historyId: entry.id,
            confirm: true,
          },
        },
      ),
    onSuccess: async () => {
      setRollbackEntry(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.updates.server(server.id),
        }),
        queryClient.invalidateQueries({ queryKey: serverKeys.profiles }),
      ]);
    },
  });

  useEffect(() => {
    if (!didStartAutomaticCheck.current) {
      didStartAutomaticCheck.current = true;
      checkMutation.mutate();
    }
  }, [checkMutation]);

  const check = checkMutation.data;
  const updateChecks = check?.checks ?? [];
  const hasBlockedCheck = updateChecks.some(
    (item) => item.status === "blocked",
  );
  const hasWarnings = updateChecks.some((item) => item.status === "warning");
  const canReviewUpdate =
    Boolean(check?.installSupported) &&
    !checkMutation.isPending &&
    !hasBlockedCheck;
  const canInstall =
    Boolean(check?.installSupported) &&
    !hasBlockedCheck &&
    (!hasWarnings || warningsAcknowledged) &&
    backupConfirmed &&
    !installMutation.isPending;
  const resetDraft = () => {
    setStep(1);
    setTargetVersion("");
    setTargetLoaderVersion("");
    setServerJarPath("");
    setServerJarSha256("");
    setBackupConfirmed(false);
    setWarningsAcknowledged(false);
    setBrowseError(null);
  };
  const hasUnsavedDraft =
    !installMutation.isSuccess &&
    (step !== 1 ||
      serverJarPath !== "" ||
      serverJarSha256 !== "" ||
      backupConfirmed ||
      warningsAcknowledged);

  const historyColumns: DataTableColumn<ServerUpdateHistory>[] = [
    {
      id: "created",
      header: t("serverUpdates.history.created"),
      sortValue: (entry) => entry.createdAt,
      cell: (entry) => formatDateTime(entry.createdAt, language),
    },
    {
      id: "status",
      header: t("serverUpdates.history.result"),
      sortValue: (entry) => entry.status,
      cell: (entry) => historyStatusLabel(entry.status, t),
    },
    {
      id: "change",
      header: t("serverUpdates.history.change"),
      rowHeader: true,
      cell: (entry) => historyMessage(entry, t),
    },
    {
      id: "actions",
      header: t("serverUpdates.history.actions"),
      cell: (entry) =>
        entry.rollbackAvailable ? (
          <Button
            disabled={rollbackMutation.isPending}
            variant="secondary"
            onClick={() => {
              rollbackMutation.reset();
              setRollbackEntry(entry);
            }}
          >
            <RotateCcw aria-hidden="true" size={14} />
            {t("serverUpdates.rollback.action")}
          </Button>
        ) : (
          <Text size="sm" c="dimmed">
            {t("common.unavailable")}
          </Text>
        ),
    },
  ];
  useUnsavedGuard({
    isDirty: hasUnsavedDraft,
    message: t("serverUpdates.unsaved.confirm"),
    onDiscard: resetDraft,
  });

  async function handleBrowseJar() {
    setBrowseError(null);
    try {
      const path = await pickServerJar();
      if (path) setServerJarPath(path);
    } catch (error) {
      setBrowseError(
        error instanceof Error
          ? error.message
          : t("serverUpdates.jarBrowseError"),
      );
    }
  }

  const statusFacts = [
    [t("serverUpdates.loader"), server.loaderType],
    [
      t("serverUpdates.version"),
      server.minecraftVersion ?? t("common.unknown"),
    ],
    [
      t("serverUpdates.status"),
      check
        ? check.updateAvailable
          ? t("settings.updates.available")
          : t("serverUpdates.current")
        : t("serverUpdates.pendingCheck"),
    ],
    [
      t("serverUpdates.install"),
      check?.installSupported
        ? t("serverUpdates.supported")
        : t("serverUpdates.manualOnly"),
    ],
  ];

  return (
    <Stack component="section" gap="md" aria-label={t("serverUpdates.title")}>
      {/* The dialog that hosts this wizard already names it; repeating the
          title and its description inside the panel was two headings deep. */}
      <Group
        component="ol"
        gap="lg"
        m={0}
        p={0}
        style={{ listStyle: "none" }}
        aria-label={t("serverUpdates.stepsAria")}
      >
        {([1, 2, 3] as UpdateStep[]).map((value) => (
          <Group component="li" key={value} gap="xs" wrap="nowrap">
            <ThemeIcon
              radius="xl"
              size={22}
              color={step >= value ? "azure" : "gray"}
              variant={step === value ? "filled" : "light"}
            >
              <Text span fz="xs" fw={600}>
                {value}
              </Text>
            </ThemeIcon>
            <Text
              size="sm"
              fw={step === value ? 600 : 400}
              c={step === value ? undefined : "dimmed"}
            >
              {t(`serverUpdates.step.${value}.title`)}
            </Text>
          </Group>
        ))}
      </Group>

      {step === 1 ? (
        <Stack gap="sm">
          <Paper p="md">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              {statusFacts.map(([label, value]) => (
                <Stack gap={2} key={label}>
                  <Text size="xs" c="dimmed">
                    {label}
                  </Text>
                  <Text size="sm" fw={600}>
                    {value}
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>
          {checkMutation.isPending ? (
            <LoadingState message={t("serverUpdates.checking")} />
          ) : null}
          {checkMutation.error ? (
            <Alert color="red" role="alert">
              {checkMutation.error.message}
            </Alert>
          ) : null}
          {check ? (
            <Alert
              color="azure"
              role="status"
              icon={<ShieldAlert aria-hidden="true" size={16} />}
              title={t("serverUpdates.checkComplete")}
            >
              <Stack gap={4} align="flex-start">
                <Text size="sm">{checkSummary(check, server, t)}</Text>
                {!check.installSupported ? (
                  <Anchor
                    href={SOURCE_LINKS[server.loaderType]}
                    rel="noreferrer"
                    size="sm"
                    target="_blank"
                  >
                    {t("serverUpdates.source.open", {
                      loader: server.loaderType,
                    })}
                  </Anchor>
                ) : null}
              </Stack>
            </Alert>
          ) : null}
          {updateChecks.length ? (
            <Stack
              component="ul"
              gap="xs"
              m={0}
              p={0}
              style={{ listStyle: "none" }}
            >
              {updateChecks.map((item) => (
                <Group
                  component="li"
                  key={item.id}
                  gap="sm"
                  wrap="nowrap"
                  align="flex-start"
                >
                  <Badge
                    variant="light"
                    color={CHECK_COLORS[item.status]}
                    style={{ flexShrink: 0 }}
                  >
                    {t(`serverUpdates.checkStatus.${item.status}`)}
                  </Badge>
                  <Text size="sm">{item.message}</Text>
                </Group>
              ))}
            </Stack>
          ) : null}
          <Group justify="flex-end" gap="xs">
            <Button
              disabled={checkMutation.isPending}
              variant="secondary"
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("serverUpdates.checkAgain")}
            </Button>
            <Button disabled={!canReviewUpdate} onClick={() => setStep(2)}>
              {t("serverUpdates.continue")}
            </Button>
          </Group>
        </Stack>
      ) : null}

      {step === 2 ? (
        <Stack gap="sm">
          <Alert
            color="gray"
            role="note"
            icon={<ExternalLink aria-hidden="true" size={16} />}
            title={t("serverUpdates.source.title")}
          >
            <Stack gap={4} align="flex-start">
              <Text size="sm">
                {t("serverUpdates.source.automaticDescription")}
              </Text>
              <Anchor
                href={SOURCE_LINKS[server.loaderType]}
                rel="noreferrer"
                size="sm"
                target="_blank"
              >
                {t("serverUpdates.source.open", { loader: server.loaderType })}
              </Anchor>
            </Stack>
          </Alert>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label={t("serverUpdates.targetMinecraftVersion")}
              placeholder={
                checkedVersion(check, server) ??
                t("serverUpdates.targetVersionPlaceholder")
              }
              value={targetVersion}
              onChange={(event) => setTargetVersion(event.currentTarget.value)}
            />
            <TextInput
              label={t("serverUpdates.targetLoaderBuild")}
              placeholder={
                server.loaderType === "paper"
                  ? t("serverUpdates.paperBuild")
                  : t("serverUpdates.loaderVersion")
              }
              value={targetLoaderVersion}
              onChange={(event) =>
                setTargetLoaderVersion(event.currentTarget.value)
              }
            />
            <Input.Wrapper
              id="server-update-jar"
              label={t("serverUpdates.downloadedJar")}
              description={t("serverUpdates.manualJarHint")}
              inputWrapperOrder={["label", "input", "description"]}
              style={{ gridColumn: "1 / -1" }}
            >
              <PathField
                id="server-update-jar"
                browseLabel={t("serverUpdates.browseJar")}
                onBrowse={handleBrowseJar}
                placeholder={t("serverUpdates.jarPlaceholder")}
                value={serverJarPath}
                onChange={(event) => setServerJarPath(event.target.value)}
              />
            </Input.Wrapper>
            <TextInput
              label={t("serverUpdates.sha256")}
              placeholder={t("serverUpdates.optionalChecksum")}
              value={serverJarSha256}
              onChange={(event) =>
                setServerJarSha256(event.currentTarget.value)
              }
            />
          </SimpleGrid>
          {browseError ? (
            <Alert color="red" role="alert">
              {browseError}
            </Alert>
          ) : null}
          <Group justify="flex-end" gap="xs">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t("serverUpdates.back")}
            </Button>
            <Button disabled={!canReviewUpdate} onClick={() => setStep(3)}>
              {t("serverUpdates.continue")}
            </Button>
          </Group>
        </Stack>
      ) : null}

      {step === 3 ? (
        <Stack gap="sm">
          <Alert
            color="yellow"
            role="note"
            icon={<ShieldAlert aria-hidden="true" size={16} />}
            title={t("serverUpdates.backup.title")}
          >
            <Text size="sm">{t("serverUpdates.backup.description")}</Text>
            <List size="sm" mt="xs" spacing={2}>
              <List.Item>{t("serverUpdates.backup.world")}</List.Item>
              <List.Item>{t("serverUpdates.backup.rollback")}</List.Item>
              <List.Item>{t("serverUpdates.backup.failure")}</List.Item>
            </List>
          </Alert>
          <Checkbox
            checked={backupConfirmed}
            label={t("serverUpdates.backup.confirm")}
            onChange={(event) =>
              setBackupConfirmed(event.currentTarget.checked)
            }
          />
          {hasWarnings ? (
            <Checkbox
              checked={warningsAcknowledged}
              label={t("serverUpdates.warnings.confirm")}
              onChange={(event) =>
                setWarningsAcknowledged(event.currentTarget.checked)
              }
            />
          ) : null}
          {installMutation.error ? (
            <Alert color="red" role="alert">
              {t("serverUpdates.installFailed")} {installMutation.error.message}
            </Alert>
          ) : null}
          {installMutation.data ? (
            <Alert
              color="azure"
              role="status"
              icon={<CheckCircle2 aria-hidden="true" size={16} />}
            >
              {t("serverUpdates.installSucceeded")}
            </Alert>
          ) : null}
          <StickyActionBar>
            <Button variant="secondary" onClick={() => setStep(2)}>
              {t("serverUpdates.back")}
            </Button>
            <Button
              disabled={!canInstall}
              onClick={() => installMutation.mutate()}
            >
              <Upload aria-hidden="true" size={16} />
              {installMutation.isPending
                ? t("serverUpdates.installing")
                : t("serverUpdates.backupAndInstall")}
            </Button>
          </StickyActionBar>
        </Stack>
      ) : null}

      <Stack
        component="section"
        gap="sm"
        aria-labelledby="server-update-history-title"
      >
        <Title order={3} size="h4" id="server-update-history-title">
          {t("serverUpdates.history.title")}
        </Title>
        {historyQuery.isLoading ? (
          <LoadingState message={t("serverUpdates.history.loading")} />
        ) : null}
        {historyQuery.error ? (
          <Alert
            color="red"
            role="alert"
            title={t("serverUpdates.history.loadError")}
          >
            <Group justify="space-between" gap="sm">
              <Text size="sm">{historyQuery.error.message}</Text>
              <Button
                disabled={historyQuery.isFetching}
                variant="secondary"
                onClick={() => historyQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </Group>
          </Alert>
        ) : null}
        {historyQuery.data?.length ? (
          <Table.ScrollContainer minWidth={560}>
            <DataTable
              caption={t("serverUpdates.history.title")}
              columns={historyColumns}
              getRowKey={(entry) => entry.id}
              rows={historyQuery.data}
            />
          </Table.ScrollContainer>
        ) : null}
        {!historyQuery.isLoading &&
        !historyQuery.error &&
        !historyQuery.data?.length ? (
          <Text size="sm" c="dimmed">
            {t("serverUpdates.history.empty")}
          </Text>
        ) : null}
      </Stack>
      {rollbackMutation.error ? (
        <Alert color="red" role="alert">
          {rollbackMutation.error.message}
        </Alert>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t("serverUpdates.rollback.confirm")}
        description={t("serverUpdates.rollback.description", {
          version: rollbackEntry?.fromVersion ?? t("common.unknown"),
        })}
        error={rollbackMutation.error?.message ?? null}
        isConfirming={rollbackMutation.isPending}
        isOpen={rollbackEntry !== null}
        title={t("serverUpdates.rollback.title")}
        onCancel={() => setRollbackEntry(null)}
        onConfirm={() => {
          if (rollbackEntry) rollbackMutation.mutate(rollbackEntry);
        }}
      />
    </Stack>
  );
}

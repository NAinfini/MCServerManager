import {
  Accordion,
  Alert,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Coffee,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { listJavaRuntimes } from "../java/javaApi";
import { javaDiagnosis } from "../java/javaDiagnosis";
import { useJavaProvisioning } from "../java/useJavaProvisioning";
import { getServerSetupStatus, type ServerSetupCheck } from "./setupApi";
import { serverKeys } from "./queries";
import type { ServerProfile } from "./types";

function statusLabelKey(status: ServerSetupCheck["status"]) {
  if (status === "ready") {
    return "server.setupChecklist.status.ready";
  }
  if (status === "warning") {
    return "server.setupChecklist.status.warning";
  }
  return "server.setupChecklist.status.actionRequired";
}

function checkLabelKey(id: ServerSetupCheck["id"]) {
  const normalizedId = id === "serverJar" ? "serverRuntime" : id;
  return `server.setupChecklist.check.${normalizedId}`;
}

function checkMessageKey(check: ServerSetupCheck) {
  const normalizedId = check.id === "serverJar" ? "serverRuntime" : check.id;
  return `server.setupChecklist.message.${normalizedId}.${check.status}`;
}

function CheckIcon({ status }: { status: ServerSetupCheck["status"] }) {
  if (status === "ready") {
    return <CheckCircle2 aria-hidden="true" size={16} />;
  }
  if (status === "warning") {
    return <AlertTriangle aria-hidden="true" size={16} />;
  }
  return <CircleAlert aria-hidden="true" size={16} />;
}

export function ServerSetupChecklist({
  server,
  onOpenJava,
}: {
  server: ServerProfile;
  onOpenJava?: () => void;
}) {
  const { t } = useAppSettings();
  const setupQuery = useQuery({
    queryKey: serverKeys.setupStatus(server.id),
    queryFn: () => getServerSetupStatus(server.id),
  });
  /* The checklist knows Java is wrong; only the scan knows why and what fixes
     it. Reading it here is what turns "select a compatible runtime" — which is
     where users got stuck — into a button that selects one. */
  const javaQuery = useQuery({
    queryKey: queryKeys.java.runtimes,
    queryFn: listJavaRuntimes,
  });
  const javaState =
    javaQuery.data?.compatibility.find((item) => item.serverId === server.id) ??
    null;
  const {
    apply,
    applyError,
    busy: javaBusy,
    dialog: javaInstallDialog,
    start: startJavaInstall,
  } = useJavaProvisioning({
    onFinished: async () => {
      await setupQuery.refetch();
    },
    serverNameFor: () => server.name,
  });
  const checks = setupQuery.data?.checks ?? [];
  const allReady =
    checks.length > 0 && checks.every((check) => check.status === "ready");
  // Only a blocking check keeps the checklist open; a recommendation collapses
  // into the summary line so a healthy server does not bury the overview.
  const blocked = checks.some((check) => check.status === "actionRequired");
  const summaryLine = checks
    .map(
      (check) =>
        `${t(checkLabelKey(check.id))} ${check.status === "ready" ? "✓" : "⚠"}`,
    )
    .join(" · ");

  const checkColor = {
    ready: "green",
    warning: "yellow",
    actionRequired: "red",
  } as const;

  return (
    <Paper
      aria-label={t("server.setupChecklist.aria")}
      component="section"
      p="md"
    >
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Accordion
          chevronPosition="right"
          defaultValue={blocked ? "checks" : null}
          flex={1}
          key={String(blocked)}
          variant="unstyled"
        >
          <Accordion.Item value="checks">
            <Accordion.Control
              icon={
                <ThemeIcon
                  color={allReady ? "green" : blocked ? "red" : "yellow"}
                  radius="xl"
                  size="md"
                  variant="light"
                >
                  {allReady ? (
                    <CheckCircle2 aria-hidden="true" size={16} />
                  ) : (
                    <CircleAlert aria-hidden="true" size={16} />
                  )}
                </ThemeIcon>
              }
              p={0}
            >
              <Text fw={600}>
                {allReady
                  ? t("server.setupChecklist.complete")
                  : blocked
                    ? t("server.setupChecklist.title")
                    : t("server.setupChecklist.recommendations")}
              </Text>
              <Text c="dimmed" size="xs">
                {blocked || summaryLine.length === 0
                  ? t("server.setupChecklist.description")
                  : summaryLine}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              {setupQuery.data ? (
                <Stack gap="xs" pt="sm" role="list">
                  {setupQuery.data.checks.map((check) => {
                    const isJavaProblem =
                      check.id === "java" && check.status !== "ready";
                    /* A runtime already on this machine that fits this server. The
                       backend picks it, so "use it" is one press and no reading. */
                    const usable = isJavaProblem
                      ? (javaState?.recommendedJavaPath ?? null)
                      : null;
                    const required = javaState?.requiredMajorVersion;
                    return (
                      <Group
                        align="flex-start"
                        gap="sm"
                        key={check.id}
                        role="listitem"
                        wrap="nowrap"
                      >
                        <ThemeIcon
                          color={checkColor[check.status]}
                          size="sm"
                          variant="transparent"
                        >
                          <CheckIcon status={check.status} />
                        </ThemeIcon>
                        <Stack flex={1} gap={4} miw={0}>
                          <Group gap="xs">
                            <Text fw={600} size="sm">
                              {t(checkLabelKey(check.id))}
                            </Text>
                            <Badge
                              color={checkColor[check.status]}
                              size="xs"
                              variant="light"
                            >
                              {t(statusLabelKey(check.status))}
                            </Badge>
                          </Group>
                          {/* The generic line says to select a compatible runtime;
                              the scan says which one and why the current one is
                              not. Prefer the sentence that names the problem. */}
                          <Text c="dimmed" size="sm">
                            {isJavaProblem && javaState
                              ? javaDiagnosis(javaState, t)
                              : t(checkMessageKey(check))}
                          </Text>
                          {isJavaProblem && javaState?.configuredJavaPath ? (
                            <Text c="dimmed" ff="monospace" size="xs">
                              {javaState.configuredJavaPath}
                            </Text>
                          ) : null}
                          {isJavaProblem ? (
                            <Group gap="xs">
                              {usable ? (
                                <Button
                                  disabled={javaBusy}
                                  variant="primary"
                                  onClick={() => apply(server.id, usable)}
                                >
                                  <Coffee aria-hidden="true" size={16} />
                                  {t("java.action.use", {
                                    version: required ?? "",
                                  })}
                                </Button>
                              ) : typeof required === "number" ? (
                                <Button
                                  disabled={javaBusy}
                                  variant="primary"
                                  onClick={() =>
                                    startJavaInstall({
                                      majorVersion: required,
                                      maxMajorVersion:
                                        javaState?.maxMajorVersion ?? null,
                                      serverId: server.id,
                                    })
                                  }
                                >
                                  <Coffee aria-hidden="true" size={16} />
                                  {t("java.action.install", {
                                    version: required,
                                  })}
                                </Button>
                              ) : null}
                              {onOpenJava ? (
                                <Button
                                  variant="secondary"
                                  onClick={onOpenJava}
                                >
                                  {t("server.setupChecklist.openJava")}
                                </Button>
                              ) : null}
                            </Group>
                          ) : null}
                          {isJavaProblem && applyError ? (
                            <Text c="red" role="alert" size="sm">
                              {applyError}
                            </Text>
                          ) : null}
                        </Stack>
                      </Group>
                    );
                  })}
                </Stack>
              ) : null}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        <Button
          disabled={setupQuery.isFetching}
          variant="secondary"
          onClick={() => setupQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("common.refresh")}
        </Button>
      </Group>
      {/* Loading and load errors stay outside the folded list: with no checks
          there is nothing to fold away. */}
      {setupQuery.isLoading ? (
        <LoadingState message={t("server.setupChecklist.loading")} />
      ) : null}
      {setupQuery.error ? (
        <Alert
          aria-label={t("server.setupChecklist.loadError")}
          color="red"
          mt="sm"
          role="alert"
          title={t("server.setupChecklist.loadError")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{setupQuery.error.message}</Text>
            <Button
              disabled={setupQuery.isFetching}
              variant="secondary"
              onClick={() => setupQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {javaInstallDialog}
    </Paper>
  );
}

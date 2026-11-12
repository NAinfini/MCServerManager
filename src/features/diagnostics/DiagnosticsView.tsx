import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Activity, Stethoscope } from "lucide-react";
import {
  Alert,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { formatDateTime } from "../../lib/date-format";
import type { ServerProfile } from "../../domain/server";
import { navigateTo } from "../../app/router";

interface DiagnosticCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

interface DiagnosticRun {
  id: string;
  serverId: string;
  status: "pass" | "warn" | "fail";
  results: DiagnosticCheck[];
  createdAt: string;
}

interface DiagnosticsViewProps {
  server: ServerProfile;
}

const statusColor = { pass: "green", warn: "yellow", fail: "red" } as const;

function diagnosticStatusLabel(
  status: DiagnosticRun["status"] | DiagnosticCheck["status"],
  t: (key: string) => string,
) {
  return t(`diagnostics.status.${status}`);
}

export function DiagnosticsView({ server }: DiagnosticsViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: queryKeys.diagnostics.runs(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun[]>(
        "list_diagnostic_runs",
        {
          serverId: server.id,
        },
      ),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun>(
        "run_server_diagnostics",
        {
          serverId: server.id,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.diagnostics.runs(server.id),
      });
    },
  });
  const latest = runMutation.data ?? historyQuery.data?.[0] ?? null;

  return (
    <Paper aria-label={t("diagnostics.aria")} component="section" p="md">
      <Group justify="space-between" mb="sm">
        <Title order={2} size="h4">
          {t("diagnostics.title")}
        </Title>
        <Button
          disabled={runMutation.isPending}
          variant="secondary"
          onClick={() => runMutation.mutate()}
        >
          <Stethoscope aria-hidden="true" size={16} />
          {t("diagnostics.run")}
        </Button>
      </Group>
      {historyQuery.error ? (
        <Alert
          color="red"
          role="alert"
          title={t("diagnostics.loadError")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{historyQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => historyQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {runMutation.error ? (
        <Text c="red" mb="sm" role="alert" size="sm">
          {runMutation.error.message}
        </Text>
      ) : null}
      {!historyQuery.error && latest ? (
        <Stack gap="sm">
          <SimpleGrid cols={2} spacing="sm">
            <Stack gap={2}>
              <Text c="dimmed" size="xs">
                {t("diagnostics.status")}
              </Text>
              <Badge color={statusColor[latest.status]} variant="light">
                {diagnosticStatusLabel(latest.status, t)}
              </Badge>
            </Stack>
            <Stack gap={2}>
              <Text c="dimmed" size="xs">
                {t("diagnostics.runAt")}
              </Text>
              <Text fw={600} size="sm">
                {formatDateTime(latest.createdAt, language)}
              </Text>
            </Stack>
          </SimpleGrid>
          <Stack gap={6}>
            {latest.results.map((result) => (
              <Group
                align="flex-start"
                gap="sm"
                key={result.name}
                wrap="nowrap"
              >
                <Badge
                  color={statusColor[result.status]}
                  miw={56}
                  size="sm"
                  style={{ flexShrink: 0 }}
                  variant="light"
                >
                  {diagnosticStatusLabel(result.status, t)}
                </Badge>
                <Text size="sm">{result.message}</Text>
              </Group>
            ))}
          </Stack>
          {latest.status !== "pass" ? (
            <Group>
              <Button
                variant="secondary"
                onClick={() =>
                  navigateTo({
                    name: "server",
                    serverId: server.id,
                    section: "console",
                    view: "logs",
                  })
                }
              >
                {t("diagnostics.openLogs")}
              </Button>
            </Group>
          ) : null}
        </Stack>
      ) : !historyQuery.error ? (
        <Group gap="sm" wrap="nowrap">
          <Activity aria-hidden="true" size={16} />
          <Stack gap={0}>
            <Text fw={600} size="sm">
              {t("diagnostics.empty.title")}
            </Text>
            <Text c="dimmed" size="sm">
              {t("diagnostics.empty.description")}
            </Text>
          </Stack>
        </Group>
      ) : null}
    </Paper>
  );
}

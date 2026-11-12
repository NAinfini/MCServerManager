import { useEffect, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  ButtonGroup,
  Divider,
  Group,
  Paper,
  Radio,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import {
  getContentUpdatePolicy,
  listInstalledContent,
  saveContentUpdatePolicy,
  type ContentUpdatePolicyMode,
  type InstalledContent,
} from "./contentApi";
import { contentKeys } from "./queries";

interface ContentUpdatePolicyViewProps {
  server: ServerProfile;
}

type Preference = "batch" | "notify" | "manual";

const preferenceToPolicy: Record<Preference, ContentUpdatePolicyMode> = {
  batch: "batch_confirm",
  notify: "notify_only",
  manual: "manual_only",
};

function policyToPreference(policy: ContentUpdatePolicyMode): Preference {
  if (policy === "notify_only") return "notify";
  if (policy === "batch_confirm") return "batch";
  return "manual";
}

export function ContentUpdatePolicyView({
  server,
}: ContentUpdatePolicyViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [preference, setPreference] = useState<Preference>("manual");
  const policyQuery = useQuery({
    queryKey: contentKeys.updatePolicy(server.id),
    queryFn: () => getContentUpdatePolicy(server.id, null),
  });
  const contentQuery = useQuery({
    queryKey: contentKeys.installed(server.id),
    queryFn: () => listInstalledContent(server.id),
  });
  const exceptionQueries = useQueries({
    queries: (contentQuery.data ?? []).map((content) => {
      const contentId = content.contentId ?? content.id;
      return {
        queryKey: contentKeys.updatePolicy(server.id, contentId),
        queryFn: () => getContentUpdatePolicy(server.id, contentId),
      };
    }),
  });

  useEffect(() => {
    if (policyQuery.data)
      setPreference(policyToPreference(policyQuery.data.policy));
  }, [policyQuery.data]);

  const savePreference = useMutation({
    mutationFn: (next: Preference) =>
      saveContentUpdatePolicy(server.id, preferenceToPolicy[next]),
    onSuccess: (saved) => {
      setPreference(policyToPreference(saved.policy));
      void queryClient.invalidateQueries({
        queryKey: contentKeys.updatePolicy(server.id),
      });
    },
  });
  const saveException = useMutation({
    mutationFn: ({
      content,
      policy,
    }: {
      content: InstalledContent;
      policy: "manual_only" | "pin_current" | "ignore_update";
    }) =>
      saveContentUpdatePolicy(server.id, policy, {
        contentId: content.contentId ?? content.id,
        pinnedVersion:
          policy === "pin_current" ? (content.version ?? null) : null,
        ignoredUpdate: null,
      }),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contentKeys.updatePolicy(
            server.id,
            saved.contentId ?? null,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: contentKeys.updateCheck(server.id),
        }),
      ]);
    },
  });

  if (
    policyQuery.isLoading ||
    contentQuery.isLoading ||
    exceptionQueries.some((query) => query.isLoading)
  ) {
    return (
      <Paper aria-label={t("content.policy.title")} component="section" p="md">
        <LoadingState message={t("content.policy.loading")} />
      </Paper>
    );
  }
  const exceptionError = exceptionQueries.find((query) => query.error)?.error;
  if (policyQuery.error || contentQuery.error || exceptionError) {
    const error = policyQuery.error ?? contentQuery.error ?? exceptionError;
    return (
      <Paper aria-label={t("content.policy.title")} component="section" p="md">
        <Alert color="red" title={t("content.policy.loadError")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{error?.message}</Text>
            <Button
              variant="secondary"
              onClick={() => {
                void policyQuery.refetch();
                void contentQuery.refetch();
                exceptionQueries.forEach((query) => void query.refetch());
              }}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      </Paper>
    );
  }

  const options: Array<{ value: Preference; title: string; body: string }> = [
    {
      value: "batch",
      title: t("content.policy.batch"),
      body: t("content.policy.batchDescription"),
    },
    {
      value: "notify",
      title: t("content.policy.notify"),
      body: t("content.policy.notifyDescription"),
    },
    {
      value: "manual",
      title: t("content.policy.manual"),
      body: t("content.policy.manualDescription"),
    },
  ];
  const exceptionByContentId = new Map(
    (contentQuery.data ?? []).map((content, index) => [
      content.contentId ?? content.id,
      exceptionQueries[index]?.data,
    ]),
  );

  const policyOf = (content: InstalledContent) =>
    exceptionByContentId.get(content.contentId ?? content.id)?.policy;
  const exceptionChoices = [
    { policy: "manual_only", label: t("content.policy.allowUpdates") },
    { policy: "pin_current", label: t("content.policy.keepCurrent") },
    { policy: "ignore_update", label: t("content.policy.ignore") },
  ] as const;

  return (
    <Paper aria-label={t("content.policy.title")} component="section" p="md">
      <Stack gap="md">
        <Stack gap={2}>
          <Title order={3}>{t("content.policy.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("content.policy.description")}
          </Text>
        </Stack>
        <SimpleGrid
          aria-label={t("content.policy.defaultBehavior")}
          cols={{ base: 1, sm: 3 }}
          role="radiogroup"
          spacing="sm"
        >
          {options.map((option) => (
            <Radio.Card
              checked={preference === option.value}
              disabled={savePreference.isPending}
              key={option.value}
              p="sm"
              onClick={() => savePreference.mutate(option.value)}
            >
              <Group align="flex-start" gap="sm" wrap="nowrap">
                <Radio.Indicator />
                <Stack gap={2}>
                  <Text fw={600} size="sm">
                    {option.title}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {option.body}
                  </Text>
                </Stack>
              </Group>
            </Radio.Card>
          ))}
        </SimpleGrid>
        {savePreference.error || saveException.error ? (
          <Alert color="red">
            {(savePreference.error ?? saveException.error)?.message}
          </Alert>
        ) : null}
        <Divider />
        <Stack gap="xs">
          <Stack gap={2}>
            <Title order={4}>{t("content.policy.exceptions")}</Title>
            <Text c="dimmed" size="xs">
              {t("content.policy.exceptionsDescription")}
            </Text>
          </Stack>
          {(contentQuery.data ?? []).length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("content.policy.exceptionsEmpty")}
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={560}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Tbody>
                  {(contentQuery.data ?? []).map((content) => (
                    <Table.Tr key={content.id}>
                      <Table.Td>
                        <Group gap="xs">
                          <Text fw={500} size="sm">
                            {content.name}
                          </Text>
                          <Text c="dimmed" ff="monospace" size="xs">
                            {content.version ?? t("common.unknown")}
                          </Text>
                        </Group>
                        <Text c="dimmed" size="xs">
                          {t("content.policy.currentState", {
                            state: t(
                              `content.policy.state.${
                                policyOf(content) ?? "manual_only"
                              }`,
                            ),
                          })}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <ButtonGroup>
                          {exceptionChoices.map((choice) => (
                            <Button
                              disabled={saveException.isPending}
                              key={choice.policy}
                              variant={
                                policyOf(content) === choice.policy
                                  ? "primary"
                                  : "secondary"
                              }
                              onClick={() =>
                                saveException.mutate({
                                  content,
                                  policy: choice.policy,
                                })
                              }
                            >
                              {choice.label}
                            </Button>
                          ))}
                        </ButtonGroup>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

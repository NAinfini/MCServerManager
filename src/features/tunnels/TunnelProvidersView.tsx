import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import {
  AppWindow,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  Group,
  Input,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import { PlayitSetupPanel } from "./PlayitSetupPanel";
import { TunnelBindingEditor } from "./TunnelBindingEditor";
import {
  listTunnelBindings,
  listTunnelProviders,
  listTunnelStatuses,
  openTunnelApplication,
  tunnelKeys,
  type TunnelProvider,
} from "./api";

export type { TunnelBinding, TunnelProvider } from "./api";

interface CreateTunnelProviderInput {
  name: string;
  kind: "custom" | "application";
  command?: string | null;
  enabled?: boolean;
}

interface TunnelProvidersViewProps {
  servers: ServerProfile[];
  embedded?: boolean;
}

async function pickTunnelApplication(): Promise<string | null> {
  const result = await invokeDesktopCommandWithErrorHandling<{
    path: string | null;
  }>("show_open_dialog", {
    kind: "file",
    filters: [
      {
        name: "Applications",
        extensions: ["exe", "lnk", "bat", "cmd", "app", "AppImage", "sh"],
      },
    ],
  });
  return result?.path ?? null;
}

function tunnelProviderDescription(
  provider: TunnelProvider,
  t: (
    key: string,
    values?: Record<string, string | number | null | undefined>,
  ) => string,
) {
  if (provider.kind === "application") {
    return provider.command
      ? t("tunnels.application.path", { path: provider.command })
      : t("tunnels.application.missing");
  }
  return provider.command;
}

function TunnelProviderKindIcon({ kind }: { kind: TunnelProvider["kind"] }) {
  const Icon = kind === "application" ? AppWindow : SquareTerminal;
  return (
    <ThemeIcon color="gray" size="lg" variant="light">
      <Icon aria-hidden="true" size={18} />
    </ThemeIcon>
  );
}

function LoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const { t } = useAppSettings();
  return (
    <Alert color="red" role="alert" title={title} variant="light">
      <Stack align="flex-start" gap="xs">
        <Text size="sm">{message}</Text>
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </Stack>
    </Alert>
  );
}

function ErrorText({ children }: { children: string | undefined }) {
  return (
    <Text c="red" role="alert" size="sm">
      {children}
    </Text>
  );
}

export function TunnelProvidersView({
  servers,
  embedded = false,
}: TunnelProvidersViewProps) {
  const { t } = useAppSettings();
  const defaultName = t("tunnels.form.defaultName");
  const [name, setName] = useState(defaultName);
  /* The default was captured once at mount, so switching language left the
     previous language's placeholder sitting in the field. Retranslate it while
     it is still untouched. */
  const appliedDefaultName = useRef(defaultName);
  useEffect(() => {
    if (appliedDefaultName.current === defaultName) return;
    const previousDefault = appliedDefaultName.current;
    appliedDefaultName.current = defaultName;
    setName((current) => (current === previousDefault ? defaultName : current));
  }, [defaultName]);
  const [kind, setKind] = useState<CreateTunnelProviderInput["kind"]>("custom");
  const [command, setCommand] = useState("ngrok tcp 25565");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );
  const [dangerAction, setDangerAction] = useState<{
    kind: "disable" | "delete";
    provider: TunnelProvider;
  } | null>(null);
  const providersQuery = useQuery({
    queryKey: tunnelKeys.providers,
    queryFn: listTunnelProviders,
  });
  const statusesQuery = useQuery({
    queryKey: tunnelKeys.statuses,
    queryFn: listTunnelStatuses,
  });
  const bindingsQuery = useQuery({
    queryKey: tunnelKeys.bindings,
    queryFn: listTunnelBindings,
  });
  const createMutation = useMutation({
    mutationFn: (input: CreateTunnelProviderInput) =>
      invokeDesktopCommandWithErrorHandling<TunnelProvider>(
        "create_tunnel_provider",
        { input },
      ),
    onSuccess: () => {
      clearProviderForm();
      setDangerAction(null);
      return providersQuery.refetch();
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: CreateTunnelProviderInput & { id: string }) =>
      invokeDesktopCommandWithErrorHandling<TunnelProvider>(
        "update_tunnel_provider",
        { input },
      ),
    onSuccess: () => {
      clearProviderForm();
      return providersQuery.refetch();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (providerId: string) =>
      invokeDesktopCommandWithErrorHandling<void>("delete_tunnel_provider", {
        input: { providerId },
      }),
    onSuccess: () => providersQuery.refetch(),
    onSettled: () => setDangerAction(null),
  });
  const bindMutation = useMutation({
    mutationFn: (input: { providerId: string; serverId: string }) =>
      invokeDesktopCommandWithErrorHandling<void>("bind_tunnel_to_server", {
        input,
      }),
    onSuccess: () => bindingsQuery.refetch(),
  });
  const unbindMutation = useMutation({
    mutationFn: (input: { providerId: string; serverId: string }) =>
      invokeDesktopCommandWithErrorHandling<void>("unbind_tunnel_from_server", {
        input,
      }),
    onSuccess: () => bindingsQuery.refetch(),
  });
  const openApplicationMutation = useMutation({
    mutationFn: openTunnelApplication,
  });
  const providers = providersQuery.data ?? [];
  const bindings = bindingsQuery.data ?? [];
  const currentServer = embedded ? servers[0] : undefined;
  const bindingsForCurrentServer = new Map(
    bindings
      .filter((binding) => binding.serverId === currentServer?.id)
      .map((binding) => [binding.providerId, binding]),
  );
  const statusesByProvider = new Map(
    (statusesQuery.data ?? []).map((status) => [status.providerId, status]),
  );
  const tunnelKindOptions = [
    { value: "custom", label: t("tunnels.kind.custom") },
    { value: "application", label: t("tunnels.kind.application") },
  ] as const;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = {
      name,
      kind,
      command: kind === "custom" || kind === "application" ? command : null,
    };
    if (editingProviderId) {
      updateMutation.mutate({ ...input, id: editingProviderId });
    } else {
      createMutation.mutate(input);
    }
  }

  function clearProviderForm() {
    setEditingProviderId(null);
    setName(t("tunnels.form.defaultName"));
    setKind("custom");
    setCommand("ngrok tcp 25565");
    setPickerError(null);
  }

  function editProvider(provider: TunnelProvider) {
    setEditingProviderId(provider.id);
    setName(provider.name);
    setKind(provider.kind);
    setCommand(provider.command || "");
    setPickerError(null);
  }

  function toggleProvider(provider: TunnelProvider) {
    if (provider.enabled) {
      updateMutation.reset();
      setDangerAction({ kind: "disable", provider });
      return;
    }
    updateMutation.mutate({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      command: provider.command,
      enabled: !provider.enabled,
    });
  }

  async function handleBrowseApplication() {
    setPickerError(null);
    try {
      const path = await pickTunnelApplication();
      if (path) {
        setCommand(path);
      }
    } catch (error) {
      setPickerError(
        error instanceof Error
          ? error.message
          : t("tunnels.application.selectError"),
      );
    }
  }

  return (
    <Stack aria-labelledby="tunnels-title" component="section" gap="md">
      <Group align="flex-start" justify="space-between" wrap="nowrap">
        {embedded ? (
          <Stack gap={2}>
            <Title id="tunnels-title" order={2}>
              {t("tunnels.settingsTitle")}
            </Title>
            <Text c="dimmed" size="sm">
              {t("tunnels.settingsDescription")}
            </Text>
          </Stack>
        ) : (
          <Stack gap={2}>
            <Text c="dimmed" size="xs">
              {t("tunnels.eyebrow")}
            </Text>
            <Title id="tunnels-title" order={1}>
              {t("tunnels.title")}
            </Title>
          </Stack>
        )}
        <Button
          disabled={providersQuery.isFetching}
          variant="secondary"
          onClick={() => providersQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("tunnels.refresh")}
        </Button>
      </Group>

      {currentServer ? <PlayitSetupPanel server={currentServer} /> : null}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper aria-labelledby="tunnel-create-title" component="section" p="md">
          <Stack gap={2} mb="sm">
            <Title id="tunnel-create-title" order={3}>
              {editingProviderId
                ? t("tunnels.edit.title")
                : t("tunnels.add.title")}
            </Title>
            <Text c="dimmed" size="sm">
              {t("tunnels.form.description")}
            </Text>
          </Stack>
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label={t("tunnels.form.name")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Input.Wrapper label={t("tunnels.form.type")}>
                <Select
                  ariaLabel={t("tunnels.form.type")}
                  options={tunnelKindOptions}
                  value={kind}
                  onValueChange={(value) =>
                    setKind(value as CreateTunnelProviderInput["kind"])
                  }
                />
              </Input.Wrapper>
              {kind === "custom" ? (
                <TextInput
                  label={t("tunnels.form.command")}
                  styles={{
                    input: {
                      fontFamily: "var(--mantine-font-family-monospace)",
                    },
                  }}
                  value={command}
                  onChange={(event) => setCommand(event.currentTarget.value)}
                />
              ) : null}
              {kind === "application" ? (
                <Group align="flex-end" gap="xs" wrap="nowrap">
                  <TextInput
                    flex={1}
                    label={t("tunnels.form.application")}
                    styles={{
                      input: {
                        fontFamily: "var(--mantine-font-family-monospace)",
                      },
                    }}
                    value={command}
                    onChange={(event) => setCommand(event.currentTarget.value)}
                  />
                  <Button
                    style={{ flexShrink: 0 }}
                    type="button"
                    variant="secondary"
                    onClick={handleBrowseApplication}
                  >
                    <FolderOpen aria-hidden="true" size={16} />
                    {t("tunnels.form.browse")}
                  </Button>
                </Group>
              ) : null}
              {pickerError ? <ErrorText>{pickerError}</ErrorText> : null}
              {createMutation.error || updateMutation.error ? (
                <ErrorText>
                  {(createMutation.error || updateMutation.error)?.message}
                </ErrorText>
              ) : null}
              <Group gap="xs">
                <Button
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                  type="submit"
                  variant="primary"
                >
                  <Plus aria-hidden="true" size={16} />
                  {editingProviderId
                    ? t("tunnels.form.save")
                    : t("tunnels.form.add")}
                </Button>
                {editingProviderId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={clearProviderForm}
                  >
                    {t("common.cancel")}
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </form>
        </Paper>

        <Stack
          aria-labelledby="tunnel-provider-list-title"
          component="section"
          gap="sm"
        >
          <Group align="baseline" justify="space-between">
            <Title id="tunnel-provider-list-title" order={3}>
              {t("tunnels.providers.title")}
            </Title>
            <Text c="dimmed" size="xs">
              {t("tunnels.providers.configured", { count: providers.length })}
            </Text>
          </Group>
          {providersQuery.error ? (
            <LoadError
              message={providersQuery.error.message}
              title={t("tunnels.providers.loadError.title")}
              onRetry={() => providersQuery.refetch()}
            />
          ) : null}
          {statusesQuery.error ? (
            <LoadError
              message={statusesQuery.error.message}
              title={t("tunnels.statuses.loadError")}
              onRetry={() => statusesQuery.refetch()}
            />
          ) : null}
          {!providersQuery.error ? (
            providers.length === 0 ? (
              <EmptyState
                title={t("tunnels.empty.title")}
                description={t("tunnels.empty.description")}
              />
            ) : (
              providers.map((provider) => {
                const status = statusesByProvider.get(provider.id);
                const bound = bindingsForCurrentServer.has(provider.id);
                return (
                  <Card key={provider.id}>
                    <Group align="flex-start" gap="sm" wrap="nowrap">
                      <TunnelProviderKindIcon kind={provider.kind} />
                      <Stack flex={1} gap={4} miw={0}>
                        <Group gap="xs">
                          <Text fw={600} size="sm">
                            {provider.name}
                          </Text>
                          <Badge
                            color={provider.enabled ? "green" : "gray"}
                            size="sm"
                            variant="light"
                          >
                            {provider.enabled
                              ? t("tunnels.status.enabled")
                              : t("tunnels.status.disabled")}
                          </Badge>
                        </Group>
                        <Text c="dimmed" ff="monospace" size="xs" truncate>
                          {tunnelProviderDescription(provider, t)}
                        </Text>
                        {!statusesQuery.error ? (
                          <Text c="dimmed" size="xs">
                            {status?.status ??
                              (provider.enabled
                                ? t("tunnels.status.enabled")
                                : t("tunnels.status.disabled"))}
                            {status?.refCount
                              ? ` / ${t("tunnels.status.refs", {
                                  count: status.refCount,
                                })}`
                              : ""}
                          </Text>
                        ) : null}
                        {status?.lastError ? (
                          <Text c="red" size="xs">
                            {status.lastError}
                          </Text>
                        ) : null}
                        {currentServer ? (
                          <Group gap="xs" mt={4}>
                            <Text size="xs">
                              {bound
                                ? t("tunnels.currentBinding.connected", {
                                    server: currentServer.name,
                                  })
                                : t("tunnels.currentBinding.disconnected", {
                                    server: currentServer.name,
                                  })}
                            </Text>
                            <Button
                              disabled={
                                bindMutation.isPending ||
                                unbindMutation.isPending
                              }
                              type="button"
                              variant={bound ? "secondary" : "primary"}
                              onClick={() => {
                                if (bound) {
                                  unbindMutation.mutate({
                                    providerId: provider.id,
                                    serverId: currentServer.id,
                                  });
                                  return;
                                }
                                bindMutation.mutate({
                                  providerId: provider.id,
                                  serverId: currentServer.id,
                                });
                              }}
                            >
                              {bound
                                ? t("tunnels.currentBinding.disconnect")
                                : t("tunnels.currentBinding.connect")}
                            </Button>
                          </Group>
                        ) : null}
                      </Stack>
                    </Group>
                    <Group gap="xs" justify="flex-end" mt="sm">
                      {provider.kind === "application" ? (
                        <Button
                          disabled={openApplicationMutation.isPending}
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            openApplicationMutation.mutate(provider.id)
                          }
                        >
                          <Play aria-hidden="true" size={16} />
                          {t("tunnels.actions.open")}
                        </Button>
                      ) : null}
                      <Button
                        disabled={updateMutation.isPending}
                        type="button"
                        variant="ghost"
                        onClick={() => editProvider(provider)}
                      >
                        <Pencil aria-hidden="true" size={16} />
                        {t("tunnels.actions.edit")}
                      </Button>
                      <Button
                        disabled={updateMutation.isPending}
                        type="button"
                        variant="ghost"
                        onClick={() => toggleProvider(provider)}
                      >
                        {provider.enabled ? (
                          <PowerOff aria-hidden="true" size={16} />
                        ) : (
                          <Power aria-hidden="true" size={16} />
                        )}
                        {provider.enabled
                          ? t("tunnels.actions.disable")
                          : t("tunnels.actions.enable")}
                      </Button>
                      <Button
                        disabled={deleteMutation.isPending}
                        type="button"
                        variant="danger"
                        onClick={() => {
                          deleteMutation.reset();
                          setDangerAction({ kind: "delete", provider });
                        }}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        {t("tunnels.actions.delete")}
                      </Button>
                    </Group>
                  </Card>
                );
              })
            )
          ) : null}
        </Stack>
      </SimpleGrid>
      {openApplicationMutation.error || deleteMutation.error ? (
        <ErrorText>
          {(openApplicationMutation.error || deleteMutation.error)?.message}
        </ErrorText>
      ) : null}

      {!embedded && bindingsQuery.error ? (
        <LoadError
          message={bindingsQuery.error.message}
          title={t("tunnels.bindings.loadError")}
          onRetry={() => bindingsQuery.refetch()}
        />
      ) : !embedded ? (
        <TunnelBindingEditor
          bindings={bindings}
          providers={providers}
          servers={servers}
          isSaving={bindMutation.isPending || unbindMutation.isPending}
          onBind={(providerId, serverId) =>
            bindMutation.mutate({ providerId, serverId })
          }
          onUnbind={(providerId, serverId) =>
            unbindMutation.mutate({ providerId, serverId })
          }
        />
      ) : null}
      {bindMutation.error || unbindMutation.error ? (
        <ErrorText>
          {(bindMutation.error || unbindMutation.error)?.message}
        </ErrorText>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={
          dangerAction?.kind === "delete"
            ? t("danger.labels.deleteProvider")
            : t("danger.labels.disableProvider")
        }
        description={
          dangerAction?.kind === "delete"
            ? t("danger.tunnel.delete.description", {
                provider: dangerAction.provider.name,
              })
            : t("danger.tunnel.disable.description", {
                provider: dangerAction?.provider.name ?? "",
              })
        }
        error={
          dangerAction?.kind === "delete"
            ? (deleteMutation.error?.message ?? null)
            : (updateMutation.error?.message ?? null)
        }
        isConfirming={deleteMutation.isPending || updateMutation.isPending}
        isOpen={dangerAction !== null}
        title={
          dangerAction?.kind === "delete"
            ? t("danger.tunnel.delete.title")
            : t("danger.tunnel.disable.title")
        }
        onCancel={() => setDangerAction(null)}
        onConfirm={() => {
          if (!dangerAction) {
            return;
          }
          if (dangerAction.kind === "delete") {
            deleteMutation.mutate(dangerAction.provider.id);
            return;
          }
          updateMutation.mutate({
            id: dangerAction.provider.id,
            name: dangerAction.provider.name,
            kind: dangerAction.provider.kind,
            command: dangerAction.provider.command,
            enabled: false,
          });
        }}
      />
    </Stack>
  );
}

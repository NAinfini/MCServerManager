import { FormEvent, useState } from "react";
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
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
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
    <span className="provider-row-icon">
      <Icon aria-hidden="true" size={18} />
    </span>
  );
}

export function TunnelProvidersView({
  servers,
  embedded = false,
}: TunnelProvidersViewProps) {
  const { t } = useAppSettings();
  const [name, setName] = useState("Custom tunnel");
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
    setName("Custom tunnel");
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
    <section
      className={embedded ? "tunnel-settings-section" : "settings-page"}
      aria-labelledby="tunnels-title"
    >
      {embedded ? (
        <div className="section-heading tunnel-settings-heading">
          <div>
            <h2 id="tunnels-title">{t("tunnels.settingsTitle")}</h2>
            <span>{t("tunnels.settingsDescription")}</span>
          </div>
          <Button
            disabled={providersQuery.isFetching}
            variant="secondary"
            onClick={() => providersQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("tunnels.refresh")}
          </Button>
        </div>
      ) : (
        <div className="page-header">
          <div>
            <p className="eyebrow">{t("tunnels.eyebrow")}</p>
            <h1 id="tunnels-title">{t("tunnels.title")}</h1>
          </div>
          <Button
            disabled={providersQuery.isFetching}
            variant="secondary"
            onClick={() => providersQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("tunnels.refresh")}
          </Button>
        </div>
      )}

      <div className="tunnel-workbench">
        <section
          className="tunnel-workbench-section"
          aria-labelledby="tunnel-create-title"
        >
          <div className="section-heading">
            <h2 id="tunnel-create-title">
              {editingProviderId
                ? t("tunnels.edit.title")
                : t("tunnels.add.title")}
            </h2>
            <span>{t("tunnels.form.description")}</span>
          </div>
          <form className="create-server-form" onSubmit={handleSubmit}>
            <label>
              {t("tunnels.form.name")}
              <TextField
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              {t("tunnels.form.type")}
              <Select
                ariaLabel={t("tunnels.form.type")}
                options={tunnelKindOptions}
                value={kind}
                onValueChange={(value) =>
                  setKind(value as CreateTunnelProviderInput["kind"])
                }
              />
            </label>
            {kind === "custom" ? (
              <label>
                {t("tunnels.form.command")}
                <TextField
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
            ) : null}
            {kind === "application" ? (
              <label>
                {t("tunnels.form.application")}
                <span className="inline-field-row">
                  <TextField
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleBrowseApplication}
                  >
                    <FolderOpen aria-hidden="true" size={15} />
                    {t("tunnels.form.browse")}
                  </Button>
                </span>
              </label>
            ) : null}
            {pickerError ? (
              <p className="danger-text" role="alert">
                {pickerError}
              </p>
            ) : null}
            {createMutation.error || updateMutation.error ? (
              <p className="danger-text" role="alert">
                {(createMutation.error || updateMutation.error)?.message}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                disabled={createMutation.isPending || updateMutation.isPending}
                type="submit"
                variant="primary"
              >
                <Plus aria-hidden="true" size={15} />
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
            </div>
          </form>
        </section>

        <section
          className="tunnel-workbench-section"
          aria-labelledby="tunnel-provider-list-title"
        >
          <div className="section-heading">
            <h2 id="tunnel-provider-list-title">
              {t("tunnels.providers.title")}
            </h2>
            <span>
              {t("tunnels.providers.configured", { count: providers.length })}
            </span>
          </div>
          {providersQuery.error ? (
            <div className="list-state list-state-error" role="alert">
              <strong>{t("tunnels.providers.loadError.title")}</strong>
              <span>{providersQuery.error.message}</span>
              <Button
                variant="secondary"
                onClick={() => providersQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {statusesQuery.error ? (
            <div className="list-state list-state-error" role="alert">
              <strong>{t("tunnels.statuses.loadError")}</strong>
              <span>{statusesQuery.error.message}</span>
              <Button
                variant="secondary"
                onClick={() => statusesQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {!providersQuery.error ? (
            providers.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-tunnels.png"
                title={t("tunnels.empty.title")}
                description={t("tunnels.empty.description")}
              />
            ) : (
              <div className="provider-list">
                {providers.map((provider) => (
                  <div className="provider-row" key={provider.id}>
                    <TunnelProviderKindIcon kind={provider.kind} />
                    <div className="provider-row-main">
                      <strong>
                        {provider.name}
                        <span
                          className={
                            provider.enabled
                              ? "provider-status-pill provider-status-pill-enabled"
                              : "provider-status-pill"
                          }
                        >
                          {provider.enabled
                            ? t("tunnels.status.enabled")
                            : t("tunnels.status.disabled")}
                        </span>
                      </strong>
                      <span>{tunnelProviderDescription(provider, t)}</span>
                      {!statusesQuery.error ? (
                        <small>
                          {statusesByProvider.get(provider.id)?.status ??
                            (provider.enabled
                              ? t("tunnels.status.enabled")
                              : t("tunnels.status.disabled"))}
                          {statusesByProvider.get(provider.id)?.refCount
                            ? ` / ${t("tunnels.status.refs", {
                                count: statusesByProvider.get(provider.id)
                                  ?.refCount,
                              })}`
                            : ""}
                        </small>
                      ) : null}
                      {statusesByProvider.get(provider.id)?.lastError ? (
                        <small className="danger-text">
                          {statusesByProvider.get(provider.id)?.lastError}
                        </small>
                      ) : null}
                      {currentServer ? (
                        <div className="provider-server-binding">
                          <span>
                            {bindingsForCurrentServer.has(provider.id)
                              ? t("tunnels.currentBinding.connected", {
                                  server: currentServer.name,
                                })
                              : t("tunnels.currentBinding.disconnected", {
                                  server: currentServer.name,
                                })}
                          </span>
                          <Button
                            disabled={
                              bindMutation.isPending || unbindMutation.isPending
                            }
                            type="button"
                            variant={
                              bindingsForCurrentServer.has(provider.id)
                                ? "secondary"
                                : "primary"
                            }
                            onClick={() => {
                              const binding = bindingsForCurrentServer.get(
                                provider.id,
                              );
                              if (binding) {
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
                            {bindingsForCurrentServer.has(provider.id)
                              ? t("tunnels.currentBinding.disconnect")
                              : t("tunnels.currentBinding.connect")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="provider-row-actions">
                      {provider.kind === "application" ? (
                        <Button
                          disabled={openApplicationMutation.isPending}
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            openApplicationMutation.mutate(provider.id)
                          }
                        >
                          <Play aria-hidden="true" size={15} />
                          {t("tunnels.actions.open")}
                        </Button>
                      ) : null}
                      <Button
                        disabled={updateMutation.isPending}
                        type="button"
                        variant="secondary"
                        onClick={() => editProvider(provider)}
                      >
                        <Pencil aria-hidden="true" size={15} />
                        {t("tunnels.actions.edit")}
                      </Button>
                      <Button
                        disabled={updateMutation.isPending}
                        type="button"
                        variant="secondary"
                        onClick={() => toggleProvider(provider)}
                      >
                        {provider.enabled ? (
                          <PowerOff aria-hidden="true" size={15} />
                        ) : (
                          <Power aria-hidden="true" size={15} />
                        )}
                        {provider.enabled
                          ? t("tunnels.actions.disable")
                          : t("tunnels.actions.enable")}
                      </Button>
                      <Button
                        disabled={deleteMutation.isPending}
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          deleteMutation.reset();
                          setDangerAction({ kind: "delete", provider });
                        }}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        {t("tunnels.actions.delete")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </section>
        {openApplicationMutation.error || deleteMutation.error ? (
          <p className="danger-text" role="alert">
            {(openApplicationMutation.error || deleteMutation.error)?.message}
          </p>
        ) : null}

        {!embedded && bindingsQuery.error ? (
          <div className="list-state list-state-error" role="alert">
            <strong>{t("tunnels.bindings.loadError")}</strong>
            <span>{bindingsQuery.error.message}</span>
            <Button variant="secondary" onClick={() => bindingsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
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
          <p className="danger-text" role="alert">
            {(bindMutation.error || unbindMutation.error)?.message}
          </p>
        ) : null}
      </div>
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
    </section>
  );
}

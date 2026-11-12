import { Unlink } from "lucide-react";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import type { TunnelBinding, TunnelProvider } from "./TunnelProvidersView";

interface TunnelBindingEditorProps {
  bindings: TunnelBinding[];
  providers: TunnelProvider[];
  servers: ServerProfile[];
  onBind: (providerId: string, serverId: string) => void;
  onUnbind: (providerId: string, serverId: string) => void;
  isSaving: boolean;
}

export function TunnelBindingEditor({
  bindings,
  providers,
  servers,
  onBind,
  onUnbind,
  isSaving,
}: TunnelBindingEditorProps) {
  const { t } = useAppSettings();
  const serverOptions = [
    { value: "none", label: t("tunnels.bindings.placeholder") },
    ...servers.map((server) => ({ value: server.id, label: server.name })),
  ];
  const bindingsByProvider = new Map<string, TunnelBinding[]>();
  for (const binding of bindings) {
    const providerBindings = bindingsByProvider.get(binding.providerId) ?? [];
    providerBindings.push(binding);
    bindingsByProvider.set(binding.providerId, providerBindings);
  }

  return (
    <Stack aria-labelledby="tunnel-bindings-title" component="section" gap={0}>
      <Stack gap={2} mb="sm">
        <Title id="tunnel-bindings-title" order={3}>
          {t("tunnels.bindings.title")}
        </Title>
        <Text c="dimmed" size="sm">
          {t("tunnels.bindings.description")}
        </Text>
      </Stack>

      {providers.length === 0 || servers.length === 0 ? (
        <Stack gap={2}>
          <Text fw={600} size="sm">
            {t("tunnels.bindings.empty.title")}
          </Text>
          <Text c="dimmed" size="sm">
            {t("tunnels.bindings.empty.description")}
          </Text>
        </Stack>
      ) : (
        <Stack gap="xs">
          {providers.map((provider) => (
            <Card key={provider.id} p="sm">
              <Group align="center" justify="space-between" wrap="nowrap">
                <Stack gap={4} miw={0}>
                  <Text fw={600} size="sm">
                    {provider.name}
                  </Text>
                  <Text c="dimmed" ff="monospace" size="xs" truncate>
                    {provider.kind === "application"
                      ? t("tunnels.bindings.application")
                      : provider.command}
                  </Text>
                  <Group gap={6}>
                    {(bindingsByProvider.get(provider.id) ?? []).map(
                      (binding) => (
                        <Badge
                          key={binding.id}
                          pr={2}
                          rightSection={
                            <Tooltip label={t("tunnels.bindings.unbind")}>
                              <ActionIcon
                                aria-label={t("tunnels.bindings.unbind")}
                                disabled={isSaving}
                                size="xs"
                                onClick={() =>
                                  onUnbind(provider.id, binding.serverId)
                                }
                              >
                                <Unlink aria-hidden="true" size={12} />
                              </ActionIcon>
                            </Tooltip>
                          }
                          tt="none"
                          variant="light"
                        >
                          {binding.serverName}
                        </Badge>
                      ),
                    )}
                  </Group>
                </Stack>
                <Select
                  ariaLabel={t("tunnels.bindings.aria", {
                    provider: provider.name,
                  })}
                  disabled={isSaving}
                  options={serverOptions}
                  value="none"
                  onValueChange={(serverId) => {
                    if (serverId !== "none") {
                      onBind(provider.id, serverId);
                    }
                  }}
                />
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

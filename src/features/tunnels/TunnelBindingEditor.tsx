import { Unlink } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";
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
    <section className="settings-panel" aria-labelledby="tunnel-bindings-title">
      <div className="section-heading">
        <h2 id="tunnel-bindings-title">{t("tunnels.bindings.title")}</h2>
        <span>{t("tunnels.bindings.description")}</span>
      </div>

      {providers.length === 0 || servers.length === 0 ? (
        <div className="list-state">
          <strong>{t("tunnels.bindings.empty.title")}</strong>
          <span>{t("tunnels.bindings.empty.description")}</span>
        </div>
      ) : (
        <div className="compatibility-list">
          {providers.map((provider) => (
            <div key={provider.id}>
              <strong>{provider.name}</strong>
              <span>
                {provider.kind === "application"
                  ? t("tunnels.bindings.application")
                  : provider.command}
              </span>
              {(bindingsByProvider.get(provider.id) ?? []).map((binding) => (
                <span className="binding-chip" key={binding.id}>
                  {binding.serverName}
                  <Button
                    className="binding-chip-action"
                    disabled={isSaving}
                    variant="ghost"
                    onClick={() => onUnbind(provider.id, binding.serverId)}
                  >
                    <Unlink aria-hidden="true" size={13} />
                    {t("tunnels.bindings.unbind")}
                  </Button>
                </span>
              ))}
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

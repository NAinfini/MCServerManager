import { useState } from "react";
import { useAppSettings } from "../../i18n";
import { ProfileImportExport } from "../profiles/ProfileImportExport";
import { TunnelProvidersView } from "../tunnels/TunnelProvidersView";
import { ServerPropertiesEditor } from "../config/ServerPropertiesEditor";
import { GamerulesEditor } from "../config/GamerulesEditor";
import { ServerUpdatesView } from "../updates/ServerUpdatesView";
import { DiagnosticsView } from "../diagnostics/DiagnosticsView";
import { ServerProfileSettings } from "./ServerProfileSettings";
import { ServerSetupChecklist } from "./ServerSetupChecklist";
import type { ServerProfile } from "./types";

interface ServerSettingsViewProps {
  server: ServerProfile;
  onOpenJava?: () => void;
}

const chipSections: Array<{ id: string; labelKey: string; advanced: boolean }> =
  [
    { id: "settings-setup", labelKey: "server.settings.nav.setup", advanced: false },
    { id: "settings-general", labelKey: "server.settings.nav.general", advanced: false },
    { id: "settings-properties", labelKey: "server.settings.nav.properties", advanced: false },
    { id: "settings-gamerules", labelKey: "server.settings.nav.gamerules", advanced: false },
    { id: "settings-network", labelKey: "server.settings.nav.network", advanced: true },
    { id: "settings-updates", labelKey: "server.settings.nav.updates", advanced: true },
    { id: "settings-advanced", labelKey: "server.settings.nav.advanced", advanced: true },
  ];

export function ServerSettingsView({
  server,
  onOpenJava,
}: ServerSettingsViewProps) {
  const { t } = useAppSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const goToSection = (id: string, advanced: boolean) => {
    if (advanced) {
      setAdvancedOpen(true);
    }
    requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="server-settings">
      <nav
        className="settings-chip-nav"
        aria-label={t("server.settings.nav.aria")}
      >
        {chipSections.map((chip) => (
          <button
            className="settings-chip"
            key={chip.id}
            type="button"
            onClick={() => goToSection(chip.id, chip.advanced)}
          >
            {t(chip.labelKey)}
          </button>
        ))}
      </nav>

      <div className="settings-sections">
        <section className="settings-section" id="settings-setup">
          <ServerSetupChecklist server={server} onOpenJava={onOpenJava} />
        </section>
        <section className="settings-section" id="settings-general">
          <ServerProfileSettings server={server} />
        </section>
        <section className="settings-section" id="settings-properties">
          <ServerPropertiesEditor server={server} />
        </section>
        <section className="settings-section" id="settings-gamerules">
          <GamerulesEditor server={server} />
        </section>

        <details
          className="disclosure settings-advanced"
          id="settings-advanced"
          open={advancedOpen}
          onToggle={(event) =>
            setAdvancedOpen(event.currentTarget.open)
          }
        >
          <summary>{t("server.settings.advancedTitle")}</summary>
          <div className="disclosure-body">
            <section className="settings-section" id="settings-network">
              <TunnelProvidersView servers={[server]} />
            </section>
            <section className="settings-section" id="settings-updates">
              <ServerUpdatesView server={server} />
            </section>
            <section className="settings-section" id="settings-diagnostics">
              <DiagnosticsView server={server} />
            </section>
            <section className="settings-section" id="settings-importexport">
              <ProfileImportExport server={server} />
            </section>
          </div>
        </details>
      </div>
    </div>
  );
}

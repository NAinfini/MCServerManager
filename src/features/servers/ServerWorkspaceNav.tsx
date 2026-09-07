import type { KeyboardEvent } from "react";
import type { ServerWorkspaceSection } from "../../app/router";
import { useAppSettings } from "../../i18n";
import { serverWorkspaceDefinitions } from "./serverWorkspace";

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
  );
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[index]?.focus();
}

export function ServerWorkspaceNav({
  serverName,
  section,
  onNavigate,
}: {
  serverName: string;
  section: ServerWorkspaceSection;
  onNavigate: (section: ServerWorkspaceSection, view?: string) => void;
}) {
  const { t } = useAppSettings();
  return (
    <nav
      aria-label={t("server.workspace.aria", { server: serverName })}
      className="workspace-navigation"
      onKeyDown={moveFocus}
    >
      {serverWorkspaceDefinitions.map((item) => (
        <button
          key={item.id}
          type="button"
          title={t(item.labelKey)}
          aria-label={t(item.labelKey)}
          aria-current={section === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id, item.defaultView)}
        >
          <item.icon size={17} aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

import { useEffect, type KeyboardEvent } from "react";
import { Button, Group } from "@mantine/core";
import type { ServerWorkspaceSection } from "../../app/router";
import { useAppSettings } from "../../i18n";
import { serverWorkspaceDefinitions } from "./serverWorkspace";

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
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
        : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[index]?.focus();
}

/* Number keys must not steal input from anywhere the user is typing, which
   includes the xterm helper textarea and Monaco's hidden input. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
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

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTypingTarget(event.target) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      const item = serverWorkspaceDefinitions[Number(event.key) - 1];
      if (item) onNavigate(item.id, item.defaultView);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onNavigate]);

  return (
    <Group
      aria-label={t("server.workspace.aria", { server: serverName })}
      component="nav"
      gap={2}
      px="lg"
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        flex: "none",
      }}
      wrap="nowrap"
      onKeyDown={moveFocus}
    >
      {serverWorkspaceDefinitions.map((item) => {
        const active = section === item.id;
        return (
          <Button
            aria-current={active ? "page" : undefined}
            c={active ? undefined : "dimmed"}
            color={active ? "azure" : "gray"}
            fw={active ? 600 : 500}
            key={item.id}
            leftSection={<item.icon aria-hidden="true" size={16} />}
            radius={0}
            style={{
              borderBottom: `2px solid ${active ? "var(--mantine-color-azure-6)" : "transparent"}`,
              marginBottom: -1,
            }}
            variant="subtle"
            onClick={() => onNavigate(item.id, item.defaultView)}
          >
            {t(item.labelKey)}
          </Button>
        );
      })}
    </Group>
  );
}

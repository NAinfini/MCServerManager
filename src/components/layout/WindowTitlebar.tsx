import { Minus, Square, X } from "lucide-react";
import { useAppSettings } from "../../i18n";
import { runDesktopWindowAction } from "../../lib/desktop-runtime";
import { Button } from "../ui/button";

async function runWindowAction(
  action: "minimize" | "toggleMaximize" | "close",
) {
  await runDesktopWindowAction(action);
}

export function WindowTitlebar() {
  const { t } = useAppSettings();

  return (
    <div className="window-titlebar">
      <div className="window-titlebar-brand">
        <span className="window-titlebar-mark">
          <img alt="" aria-hidden="true" src="./app-icon.png" />
        </span>
        <span>MC Server Manager</span>
      </div>
      <div className="window-titlebar-controls">
        <Button
          aria-label={t("window.minimize.aria")}
          className="window-control"
          title={t("window.minimize.title")}
          variant="ghost"
          onClick={() => void runWindowAction("minimize")}
        >
          <Minus aria-hidden="true" size={15} />
        </Button>
        <Button
          aria-label={t("window.maximize.aria")}
          className="window-control"
          title={t("window.maximize.title")}
          variant="ghost"
          onClick={() => void runWindowAction("toggleMaximize")}
        >
          <Square aria-hidden="true" size={13} />
        </Button>
        <Button
          aria-label={t("window.close.aria")}
          className="window-control window-control-close"
          title={t("window.close.title")}
          variant="ghost"
          onClick={() => void runWindowAction("close")}
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>
    </div>
  );
}

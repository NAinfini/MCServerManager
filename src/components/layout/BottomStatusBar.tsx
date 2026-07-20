import { Coffee, HardDrive, Globe, Info } from "lucide-react";
import { useAppSettings } from "../../i18n";

interface BottomStatusBarProps {
  selectedServer?: {
    javaPath?: string | null;
    maxMemoryMb?: number | null;
    minMemoryMb?: number | null;
    serverPort?: number | null;
  } | null;
}

function extractJavaVersion(javaPath?: string | null): string | null {
  if (!javaPath) return null;
  const match = javaPath.match(/(\d+)/);
  return match ? match[1] : null;
}

export function BottomStatusBar({ selectedServer }: BottomStatusBarProps) {
  const { t } = useAppSettings();
  const javaVersion = extractJavaVersion(selectedServer?.javaPath);
  const memory = selectedServer?.maxMemoryMb;
  const port = selectedServer?.serverPort;

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-item">
          <Coffee aria-hidden="true" size={12} />
          <span className="status-bar-copy">
            {javaVersion ? `Java ${javaVersion}` : t("status.javaUnset")}
          </span>
        </span>
        <span className="status-bar-item">
          <HardDrive aria-hidden="true" size={12} />
          <span className="status-bar-copy status-bar-mono">
            {memory ? `${memory} MB` : t("server.meta.unset")}
          </span>
        </span>
      </div>
      <div className="status-bar-center">
        <span className="status-bar-item">
          <Globe aria-hidden="true" size={12} />
          <span className="status-bar-copy status-bar-mono">
            {port ? t("server.meta.port", { port }) : t("server.meta.unset")}
          </span>
        </span>
      </div>
      <div className="status-bar-right">
        <span className="status-bar-item">
          <Info aria-hidden="true" size={12} />
          <span className="status-bar-copy">v0.1.0</span>
        </span>
      </div>
    </footer>
  );
}

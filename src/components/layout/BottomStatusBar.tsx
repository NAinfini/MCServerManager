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
          {javaVersion ? `Java ${javaVersion}` : t("status.javaUnset")}
        </span>
        <span className="status-bar-item">
          <HardDrive aria-hidden="true" size={12} />
          {memory ? <span className="status-bar-mono">{memory} MB</span> : t("server.meta.unset")}
        </span>
      </div>
      <div className="status-bar-center">
        <span className="status-bar-item">
          <Globe aria-hidden="true" size={12} />
          {port ? (
            <span className="status-bar-mono">
              {t("server.meta.port", { port })}
            </span>
          ) : (
            t("server.meta.unset")
          )}
        </span>
      </div>
      <div className="status-bar-right">
        <span className="status-bar-item">
          <Info aria-hidden="true" size={12} />
          v0.1.0
        </span>
      </div>
    </footer>
  );
}

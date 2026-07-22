import { getLoaderBranding } from "../../features/loaders/loaderBranding";
import { cn } from "../../lib/cn";

interface ServerCoverProps {
  loaderType?: string | null;
  size?: number;
  className?: string;
}

// Deterministic cover gradient derived from the loader type so a server keeps a
// stable identity across the dashboard, sidebar, and detail header.
const coverGradients: Record<string, [string, string]> = {
  paper: ["#14b8a6", "#0f766e"],
  fabric: ["#f0a838", "#b45309"],
  forge: ["#f97316", "#c2410c"],
  neoforge: ["#ef4444", "#b21c1c"],
  vanilla: ["#64748b", "#334155"],
};

function gradientFor(loaderType?: string | null): [string, string] {
  const key = (loaderType ?? "").toLowerCase();
  return coverGradients[key] ?? coverGradients.vanilla;
}

export function ServerCover({
  loaderType,
  size = 48,
  className,
}: ServerCoverProps) {
  const branding = getLoaderBranding(loaderType);
  const [from, to] = gradientFor(loaderType);
  const radius = size >= 40 ? 8 : 6;

  return (
    <span
      aria-hidden="true"
      className={cn("server-cover", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {branding.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          className="server-cover-glyph"
          src={branding.iconSrc}
          style={{ width: Math.round(size * 0.58), height: Math.round(size * 0.58) }}
        />
      ) : (
        <span className="server-cover-fallback">{branding.shortLabel}</span>
      )}
    </span>
  );
}

import { getLoaderBranding } from "../../features/loaders/loaderBranding";
import { cn } from "../../lib/cn";

interface ServerCoverProps {
  loaderType?: string | null;
  size?: number;
  className?: string;
}

export function ServerCover({
  loaderType,
  size = 48,
  className,
}: ServerCoverProps) {
  const branding = getLoaderBranding(loaderType);
  const radius = size >= 40 ? 8 : 6;

  return (
    <span
      aria-hidden="true"
      className={cn("server-cover", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {branding.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          className="server-cover-glyph"
          src={branding.iconSrc}
          style={{
            width: Math.round(size * 0.58),
            height: Math.round(size * 0.58),
          }}
        />
      ) : (
        <span className="server-cover-fallback">{branding.shortLabel}</span>
      )}
    </span>
  );
}

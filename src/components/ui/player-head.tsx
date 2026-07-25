import { useState } from "react";
import { cn } from "../../lib/cn";

interface PlayerHeadProps {
  username: string;
  uuid?: string | null;
  size?: number;
  className?: string;
}

/**
 * Rendered skins come from a public head service. The generated head below is
 * always painted first so an offline machine or an unknown player still shows a
 * head instead of an empty box; the real skin replaces it once it loads.
 */
const headServiceBase = "https://mc-heads.net/avatar";

export function playerHeadUrl(
  username: string,
  uuid: string | null | undefined,
  pixelSize: number,
) {
  const identity = (uuid ?? "").trim() || username.trim();
  if (!identity) return null;
  return `${headServiceBase}/${encodeURIComponent(identity)}/${pixelSize}`;
}

function identityHue(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

export function PlayerHead({
  username,
  uuid,
  size = 24,
  className,
}: PlayerHeadProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const source = playerHeadUrl(username, uuid, size * 2);
  const hue = identityHue(uuid?.trim() || username);

  return (
    <span
      aria-hidden="true"
      className={cn("player-head", className)}
      style={{ width: size, height: size }}
    >
      <svg
        className="player-head-generated"
        height={size}
        viewBox="0 0 8 8"
        width={size}
      >
        <rect fill={`hsl(${hue} 34% 62%)`} height="8" width="8" />
        <rect fill={`hsl(${hue} 38% 28%)`} height="2" width="8" />
        <rect fill={`hsl(${hue} 38% 28%)`} height="2" width="1" y="2" />
        <rect fill={`hsl(${hue} 38% 28%)`} height="2" width="1" x="7" y="2" />
        <rect fill="#f5f7fa" height="1" width="1" x="2" y="3" />
        <rect fill="#f5f7fa" height="1" width="1" x="5" y="3" />
        <rect fill={`hsl(${hue} 30% 40%)`} height="1" width="3" x="2.5" y="5" />
      </svg>
      {source && failedSrc !== source ? (
        <img
          alt=""
          className={cn(
            "player-head-skin",
            loadedSrc === source && "player-head-skin-loaded",
          )}
          height={size}
          src={source}
          width={size}
          onError={() => setFailedSrc(source)}
          onLoad={() => setLoadedSrc(source)}
        />
      ) : null}
    </span>
  );
}

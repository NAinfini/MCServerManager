import { User } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";

interface PlayerHeadProps {
  username: string;
  uuid?: string | null;
  size?: number;
  className?: string;
}

/**
 * Rendered skins come from a public head service. A plain user glyph is shown
 * first so an offline machine or an unknown player still shows something; the
 * real skin replaces it once it loads.
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

export function PlayerHead({
  username,
  uuid,
  size = 24,
  className,
}: PlayerHeadProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const source = playerHeadUrl(username, uuid, size * 2);

  return (
    <span
      aria-hidden="true"
      className={cn("player-head", className)}
      style={{ width: size, height: size }}
    >
      <User
        className="player-head-generated"
        size={Math.round(size * 0.7)}
        strokeWidth={2}
      />
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

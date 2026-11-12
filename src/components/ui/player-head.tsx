import { User } from "lucide-react";
import { Avatar } from "@mantine/core";

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
  return (
    <Avatar
      alt=""
      aria-hidden="true"
      className={className}
      radius="xs"
      size={size}
      src={playerHeadUrl(username, uuid, size * 2)}
      styles={{ image: { imageRendering: "pixelated" } }}
    >
      <User size={Math.round(size * 0.7)} strokeWidth={2} />
    </Avatar>
  );
}

import { Text, ThemeIcon } from "@mantine/core";
import { getLoaderBranding } from "../../features/loaders/loaderBranding";

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

  return (
    <ThemeIcon
      aria-hidden="true"
      className={className}
      color="gray"
      radius={size >= 40 ? "md" : "sm"}
      size={size}
      variant="default"
    >
      {branding.iconSrc ? (
        <img
          alt=""
          src={branding.iconSrc}
          style={{
            width: Math.round(size * 0.58),
            height: Math.round(size * 0.58),
            objectFit: "contain",
            filter: "brightness(0) invert(1)",
            opacity: 0.9,
          }}
        />
      ) : (
        <Text fw={700} fz={Math.round(size * 0.32)} tt="uppercase">
          {branding.shortLabel}
        </Text>
      )}
    </ThemeIcon>
  );
}

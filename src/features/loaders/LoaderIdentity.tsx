import { Badge, Image } from "@mantine/core";
import { getLoaderBranding } from "./loaderBranding";

interface LoaderPillProps {
  loaderType?: string | null;
  minecraftVersion?: string | null;
}

export function LoaderPill({ loaderType, minecraftVersion }: LoaderPillProps) {
  const branding = getLoaderBranding(loaderType);
  const label = [branding.label, minecraftVersion].filter(Boolean).join(" ");

  return (
    <Badge
      color="gray"
      leftSection={
        branding.iconSrc ? (
          <Image
            alt=""
            aria-hidden="true"
            h={14}
            src={branding.iconSrc}
            w={14}
          />
        ) : (
          <span aria-hidden="true">{branding.shortLabel}</span>
        )
      }
      radius="sm"
      tt="none"
      variant="light"
    >
      {label}
    </Badge>
  );
}

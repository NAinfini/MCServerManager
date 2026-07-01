import { getLoaderBranding } from "./loaderBranding";

interface LoaderIconProps {
  className?: string;
  loaderType?: string | null;
}

export function LoaderIcon({
  className = "loader-icon",
  loaderType,
}: LoaderIconProps) {
  const branding = getLoaderBranding(loaderType);

  if (branding.iconSrc) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={className}
        src={branding.iconSrc}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${className} loader-icon-fallback`}
    >
      {branding.shortLabel}
    </span>
  );
}

interface LoaderPillProps {
  loaderType?: string | null;
  minecraftVersion?: string | null;
}

export function LoaderPill({
  loaderType,
  minecraftVersion,
}: LoaderPillProps) {
  const branding = getLoaderBranding(loaderType);
  const label = [branding.label, minecraftVersion].filter(Boolean).join(" ");

  return (
    <span className="loader-pill">
      <LoaderIcon loaderType={loaderType} />
      <span>{label}</span>
    </span>
  );
}

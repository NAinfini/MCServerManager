import { Select } from "../../components/ui/select";
import { getLoaderBranding } from "./loaderBranding";

export const loaderOptions = [
  "vanilla",
  "paper",
  "forge",
  "neoForge",
  "fabric",
  "quilt",
].map((value) => {
  const branding = getLoaderBranding(value);

  return {
    iconAlt: "",
    iconSrc: branding.iconSrc,
    label: branding.label,
    value,
  };
});

interface LoaderSelectProps {
  ariaLabel?: string;
  describedBy?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function LoaderSelect({
  ariaLabel = "Loader",
  describedBy,
  disabled = false,
  name,
  onValueChange = () => {},
  value = "paper",
}: LoaderSelectProps) {
  return (
    <Select
      ariaLabel={ariaLabel}
      describedBy={describedBy}
      disabled={disabled}
      name={name}
      options={loaderOptions}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

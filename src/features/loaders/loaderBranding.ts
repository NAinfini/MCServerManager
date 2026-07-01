export interface LoaderBranding {
  iconAlt: string;
  iconSrc?: string;
  label: string;
  shortLabel: string;
}

const loaderBrandingByType: Record<string, LoaderBranding> = {
  vanilla: {
    iconAlt: "Vanilla loader",
    iconSrc: "/brand/vanilla-logo.svg",
    label: "Vanilla",
    shortLabel: "V",
  },
  paper: {
    iconAlt: "Paper loader",
    iconSrc: "/brand/paper-logo.svg",
    label: "Paper",
    shortLabel: "P",
  },
  forge: {
    iconAlt: "Forge loader",
    iconSrc: "/brand/forge-logo.svg",
    label: "Forge",
    shortLabel: "F",
  },
  neoForge: {
    iconAlt: "NeoForge loader",
    iconSrc: "/brand/neoforge-logo.png",
    label: "NeoForge",
    shortLabel: "NF",
  },
  fabric: {
    iconAlt: "Fabric loader",
    iconSrc: "/brand/fabric-logo.svg",
    label: "Fabric",
    shortLabel: "FB",
  },
};

export function getLoaderBranding(loaderType?: string | null): LoaderBranding {
  if (loaderType && loaderBrandingByType[loaderType]) {
    return loaderBrandingByType[loaderType];
  }

  return {
    iconAlt: `${loaderType || "Unknown"} loader`,
    label: loaderType || "Unknown",
    shortLabel: (loaderType || "?").slice(0, 2).toUpperCase(),
  };
}

export function getLoaderLabel(loaderType?: string | null) {
  return getLoaderBranding(loaderType).label;
}

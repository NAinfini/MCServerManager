import { publicAssetUrl } from "../../lib/public-asset";

export const marketplaceProviders = ["Modrinth", "BBSMC", "Hangar"] as const;
export type MarketplaceProvider = (typeof marketplaceProviders)[number];

export const serverPackMarketplaceProviders = [
  "Modrinth",
  "BBSMC",
] as const satisfies readonly MarketplaceProvider[];
export type ServerPackMarketplaceProvider =
  (typeof serverPackMarketplaceProviders)[number];

export const marketplaceDiscoveryQueries: Record<
  ServerPackMarketplaceProvider,
  string
> = {
  Modrinth: "server",
  BBSMC: "",
};

const providerBrandingByName: Record<
  string,
  { iconAlt: string; iconSrc: string }
> = {
  Modrinth: { iconAlt: "Modrinth", iconSrc: "/brand/modrinth-logo.svg" },
  CurseForge: { iconAlt: "CurseForge", iconSrc: "/brand/curseforge-logo.svg" },
  Hangar: { iconAlt: "Hangar", iconSrc: "/brand/hangar-logo.svg" },
  BBSMC: { iconAlt: "BBSMC", iconSrc: "/brand/bbsmc-logo.png" },
};

export function getMarketplaceProviderBranding(provider: string) {
  const branding = providerBrandingByName[provider];
  return branding
    ? {
        ...branding,
        iconSrc: publicAssetUrl(branding.iconSrc),
      }
    : null;
}

export function marketplaceProviderOption(provider: string) {
  const branding = getMarketplaceProviderBranding(provider);
  return {
    iconAlt: branding?.iconAlt ?? "",
    iconSrc: branding?.iconSrc,
    value: provider,
    label: provider,
  };
}

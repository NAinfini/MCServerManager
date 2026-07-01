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
  return providerBrandingByName[provider] ?? null;
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

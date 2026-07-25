import {
  MarketplaceBrowser,
  type MarketplaceCreateSelection,
} from "../marketplace/MarketplaceBrowser";

export type { MarketplaceCreateSelection } from "../marketplace/MarketplaceBrowser";

interface CreateServerMarketplaceBrowserProps {
  onSelect: (selection: MarketplaceCreateSelection) => void;
  onDetailModeChange?: (isDetailMode: boolean) => void;
}

/** Creation reuses the same marketplace search, result, detail and version flow. */
export function CreateServerMarketplaceBrowser({
  onDetailModeChange,
  onSelect,
}: CreateServerMarketplaceBrowserProps) {
  return (
    <MarketplaceBrowser
      mode="create"
      onDetailModeChange={onDetailModeChange}
      onSelect={onSelect}
    />
  );
}

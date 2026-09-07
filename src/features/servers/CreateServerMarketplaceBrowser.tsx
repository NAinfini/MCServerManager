import type { ReactNode } from "react";
import {
  MarketplaceBrowser,
  type MarketplaceCreateSelection,
} from "../marketplace/MarketplaceBrowser";

export type { MarketplaceCreateSelection } from "../marketplace/MarketplaceBrowser";

interface CreateServerMarketplaceBrowserProps {
  onSelect: (selection: MarketplaceCreateSelection) => void;
  onDetailModeChange?: (isDetailMode: boolean) => void;
  detailAction?: ReactNode;
}

/** Creation reuses the same marketplace search, result, detail and version flow. */
export function CreateServerMarketplaceBrowser({
  detailAction,
  onDetailModeChange,
  onSelect,
}: CreateServerMarketplaceBrowserProps) {
  return (
    <MarketplaceBrowser
      detailAction={detailAction}
      mode="create"
      onDetailModeChange={onDetailModeChange}
      onSelect={onSelect}
    />
  );
}

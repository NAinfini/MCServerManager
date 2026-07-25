import type { ServerProfile } from "../../domain/server";
import { MarketplaceBrowser } from "./MarketplaceBrowser";

export function ServerMarketplaceView({ server }: { server: ServerProfile }) {
  return <MarketplaceBrowser server={server} />;
}

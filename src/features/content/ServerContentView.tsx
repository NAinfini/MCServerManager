import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";
import { ServerMarketplaceView } from "../marketplace/ServerMarketplaceView";
import { ContentUpdatePolicyView } from "./ContentUpdatePolicyView";
import { InstalledContentView } from "./InstalledContentView";

type ContentSection = "installed" | "browse";

export function ServerContentView({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const [section, setSection] = useState<ContentSection>("installed");

  return (
    <Tabs.Root
      className="content-workspace"
      value={section}
      onValueChange={(value) => setSection(value as ContentSection)}
    >
      <Tabs.List
        className="content-inner-tabs"
        aria-label={t("content.tabs.aria")}
      >
        <Tabs.Trigger value="installed">
          {t("content.tabs.installed")}
        </Tabs.Trigger>
        <Tabs.Trigger value="browse">{t("content.tabs.browse")}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content className="content-inner-panel" value="installed">
        <InstalledContentView
          server={server}
          onBrowse={() => setSection("browse")}
        />
        <details className="disclosure content-policy-advanced">
          <summary>{t("content.policy.advancedTitle")}</summary>
          <div className="disclosure-body">
            <ContentUpdatePolicyView server={server} />
          </div>
        </details>
      </Tabs.Content>
      <Tabs.Content className="content-inner-panel" value="browse">
        <ServerMarketplaceView server={server} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

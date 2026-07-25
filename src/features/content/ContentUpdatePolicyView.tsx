import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import {
  getContentUpdatePolicy,
  listInstalledContent,
  saveContentUpdatePolicy,
  type ContentUpdatePolicyMode,
  type InstalledContent,
} from "./contentApi";
import { contentKeys } from "./queries";

interface ContentUpdatePolicyViewProps {
  server: ServerProfile;
}

type Preference = "automatic" | "notify" | "manual";

const preferenceToPolicy: Record<Preference, ContentUpdatePolicyMode> = {
  automatic: "batch_confirm",
  notify: "notify_only",
  manual: "manual_only",
};

function policyToPreference(policy: ContentUpdatePolicyMode): Preference {
  if (policy === "notify_only") return "notify";
  if (policy === "batch_confirm") return "automatic";
  return "manual";
}

export function ContentUpdatePolicyView({ server }: ContentUpdatePolicyViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [preference, setPreference] = useState<Preference>("manual");
  const policyQuery = useQuery({
    queryKey: contentKeys.updatePolicy(server.id),
    queryFn: () => getContentUpdatePolicy(server.id, null),
  });
  const contentQuery = useQuery({
    queryKey: contentKeys.installed(server.id),
    queryFn: () => listInstalledContent(server.id),
  });

  useEffect(() => {
    if (policyQuery.data) setPreference(policyToPreference(policyQuery.data.policy));
  }, [policyQuery.data]);

  const savePreference = useMutation({
    mutationFn: (next: Preference) => saveContentUpdatePolicy(server.id, preferenceToPolicy[next]),
    onSuccess: (saved) => {
      setPreference(policyToPreference(saved.policy));
      void queryClient.invalidateQueries({ queryKey: contentKeys.updatePolicy(server.id) });
    },
  });
  const saveException = useMutation({
    mutationFn: ({ content, policy }: { content: InstalledContent; policy: "pin_current" | "ignore_update" }) =>
      saveContentUpdatePolicy(server.id, policy, {
        contentId: content.contentId ?? content.id,
        pinnedVersion: policy === "pin_current" ? content.version ?? null : null,
        ignoredUpdate: null,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: contentKeys.updatePolicy(server.id) }),
  });

  if (policyQuery.isLoading || contentQuery.isLoading) {
    return <section className="settings-panel content-update-policy" aria-label={t("content.policy.title")}><LoadingState message={t("content.policy.loading")} /></section>;
  }
  if (policyQuery.error || contentQuery.error) {
    const error = policyQuery.error ?? contentQuery.error;
    return (
      <section className="settings-panel content-update-policy" aria-label={t("content.policy.title")}>
        <div aria-label={t("content.policy.loadError")} className="list-state list-state-error" role="alert">
          <strong>{t("content.policy.loadError")}</strong><span>{error?.message}</span>
          <Button variant="secondary" onClick={() => { void policyQuery.refetch(); void contentQuery.refetch(); }}><RefreshCw aria-hidden="true" size={15} />{t("common.retry")}</Button>
        </div>
      </section>
    );
  }

  const options: Array<{ value: Preference; title: string; body: string }> = [
    { value: "automatic", title: t("content.policy.automatic"), body: t("content.policy.automaticDescription") },
    { value: "notify", title: t("content.policy.notify"), body: t("content.policy.notifyDescription") },
    { value: "manual", title: t("content.policy.manual"), body: t("content.policy.manualDescription") },
  ];

  return (
    <section className="settings-panel content-update-policy" aria-label={t("content.policy.title")}>
      <div className="content-toolbar"><div><strong>{t("content.policy.title")}</strong><span>{t("content.policy.description")}</span></div></div>
      <div aria-label={t("content.policy.defaultBehavior")} className="settings-grid" role="radiogroup">
        {options.map((option) => (
          <button
            aria-checked={preference === option.value}
            className={preference === option.value ? "button button-primary" : "button button-secondary"}
            disabled={savePreference.isPending}
            key={option.value}
            role="radio"
            type="button"
            onClick={() => savePreference.mutate(option.value)}
          >
            {preference === option.value ? <Check aria-hidden="true" size={16} /> : <Bell aria-hidden="true" size={16} />}
            <span><strong>{option.title}</strong><small>{option.body}</small></span>
          </button>
        ))}
      </div>
      {savePreference.error || saveException.error ? <div className="inline-error" role="alert">{(savePreference.error ?? saveException.error)?.message}</div> : null}
      <div className="list-state">
        <div><strong>{t("content.policy.exceptions")}</strong><span>{t("content.policy.exceptionsDescription")}</span></div>
        {(contentQuery.data ?? []).length === 0 ? <p>{t("content.policy.exceptionsEmpty")}</p> : (
          <ul>
            {(contentQuery.data ?? []).map((content) => (
              <li key={content.id}>
                <span><strong>{content.name}</strong><small>{content.version ?? t("common.unknown")}</small></span>
                <span>
                  <Button disabled={saveException.isPending} variant="secondary" onClick={() => saveException.mutate({ content, policy: "pin_current" })}>{t("content.policy.keepCurrent")}</Button>
                  <Button disabled={saveException.isPending} variant="ghost" onClick={() => saveException.mutate({ content, policy: "ignore_update" })}>{t("content.policy.ignore")}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

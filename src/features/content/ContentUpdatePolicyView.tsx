import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Pin, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";
import {
  getContentUpdatePolicy,
  planContentUpdates,
  saveContentUpdatePolicy,
  type ContentUpdatePlan,
  type ContentUpdatePolicyMode,
} from "./contentApi";

interface ContentUpdatePolicyViewProps {
  server: ServerProfile;
}

interface PolicyDraft {
  serverId: string;
  policy: ContentUpdatePolicyMode;
  contentId: string;
  pinnedVersion: string;
  ignoredUpdate: string;
}

function draftsEqual(left: PolicyDraft, right: PolicyDraft) {
  return (
    left.serverId === right.serverId &&
    left.policy === right.policy &&
    left.contentId === right.contentId &&
    left.pinnedVersion === right.pinnedVersion &&
    left.ignoredUpdate === right.ignoredUpdate
  );
}

export function ContentUpdatePolicyView({
  server,
}: ContentUpdatePolicyViewProps) {
  const { t } = useAppSettings();
  const [policy, setPolicy] = useState<ContentUpdatePolicyMode>("manual_only");
  const [contentId, setContentId] = useState("");
  const [pinnedVersion, setPinnedVersion] = useState("");
  const [ignoredUpdate, setIgnoredUpdate] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateCurrentVersion, setCandidateCurrentVersion] = useState("");
  const [candidateLatestVersion, setCandidateLatestVersion] = useState("");
  const [candidateWarning, setCandidateWarning] = useState("");
  const [installAnyway, setInstallAnyway] = useState(false);
  const baselineRef = useRef<PolicyDraft | null>(null);
  const policyLabels: Record<ContentUpdatePolicyMode, string> = {
    manual_only: t("content.policy.manualOnly"),
    notify_only: t("content.policy.notifyOnly"),
    batch_confirm: t("content.policy.batchConfirm"),
    pin_current: t("content.policy.pinCurrent"),
    ignore_update: t("content.policy.ignoreUpdate"),
  };
  const policyOptions = Object.entries(policyLabels).map(([value, label]) => ({
    value,
    label,
  }));
  const installAnywayOptions = [
    { value: "no", label: t("content.policy.requireInstallAnyway") },
    { value: "yes", label: t("content.policy.installAnywayConfirmed") },
  ] as const;
  const policyQuery = useQuery({
    queryKey: ["contentUpdatePolicy", server.id, null],
    queryFn: () => getContentUpdatePolicy(server.id, null),
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      saveContentUpdatePolicy(server.id, policy, {
        contentId: contentId.trim() || null,
        pinnedVersion:
          policy === "pin_current" ? pinnedVersion.trim() || null : null,
        ignoredUpdate:
          policy === "ignore_update" ? ignoredUpdate.trim() || null : null,
      }),
    onSuccess: (saved) => {
      applyPolicyDraft({
        serverId: server.id,
        policy: saved.policy,
        contentId: saved.contentId ?? "",
        pinnedVersion: saved.pinnedVersion ?? "",
        ignoredUpdate: saved.ignoredUpdate ?? "",
      });
    },
  });
  const planMutation = useMutation<ContentUpdatePlan, Error>({
    mutationFn: () =>
      planContentUpdates(server.id, {
        availableUpdates:
          candidateName.trim() && candidateLatestVersion.trim()
            ? [
                {
                  contentId: contentId.trim() || candidateName.trim(),
                  name: candidateName.trim(),
                  currentVersion: candidateCurrentVersion.trim() || null,
                  latestVersion: candidateLatestVersion.trim(),
                  warnings: candidateWarning.trim()
                    ? [candidateWarning.trim()]
                    : [],
                },
              ]
            : [],
        confirmBatch: policy === "batch_confirm",
        installAnyway,
      }),
  });

  useEffect(() => {
    if (policyQuery.data) {
      const nextDraft = {
        serverId: server.id,
        policy: policyQuery.data.policy,
        contentId: policyQuery.data.contentId ?? "",
        pinnedVersion: policyQuery.data.pinnedVersion ?? "",
        ignoredUpdate: policyQuery.data.ignoredUpdate ?? "",
      };
      const currentDraft = {
        serverId: server.id,
        policy,
        contentId,
        pinnedVersion,
        ignoredUpdate,
      };
      const baseline = baselineRef.current;
      if (
        baseline?.serverId !== server.id ||
        (baseline !== null && draftsEqual(currentDraft, baseline))
      ) {
        applyPolicyDraft(nextDraft);
      }
    }
  }, [
    contentId,
    ignoredUpdate,
    pinnedVersion,
    policy,
    policyQuery.data,
    server.id,
  ]);

  function applyPolicyDraft(draft: PolicyDraft) {
    baselineRef.current = draft;
    setPolicy(draft.policy);
    setContentId(draft.contentId);
    setPinnedVersion(draft.pinnedVersion);
    setIgnoredUpdate(draft.ignoredUpdate);
  }

  return (
    <section
      className="settings-panel content-update-policy"
      aria-label={t("content.policy.title")}
    >
      <div className="content-toolbar">
        <div>
          <strong>{t("content.policy.title")}</strong>
          <span>{t("content.policy.description")}</span>
        </div>
        <Button
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          variant="primary"
        >
          <Pin aria-hidden="true" size={15} />
          {t("content.policy.save")}
        </Button>
      </div>

      <div className="settings-grid">
        <label>
          <span>{t("content.policy.defaultBehavior")}</span>
          <Select
            ariaLabel={t("content.policy.defaultBehavior")}
            options={policyOptions}
            value={policy}
            onValueChange={(value) =>
              setPolicy(value as ContentUpdatePolicyMode)
            }
          />
        </label>
        <label>
          <span>{t("content.policy.compatibilityOverride")}</span>
          <Select
            ariaLabel={t("content.policy.compatibilityOverride")}
            options={installAnywayOptions}
            value={installAnyway ? "yes" : "no"}
            onValueChange={(value) => setInstallAnyway(value === "yes")}
          />
        </label>
      </div>

      {policy === "pin_current" || policy === "ignore_update" ? (
        <div className="settings-grid">
          <label>
            <span>{t("content.policy.contentId")}</span>
            <TextField
              value={contentId}
              onChange={(event) => setContentId(event.target.value)}
            />
          </label>
          {policy === "pin_current" ? (
            <label>
              <span>{t("content.policy.pinnedVersion")}</span>
              <TextField
                value={pinnedVersion}
                onChange={(event) => setPinnedVersion(event.target.value)}
              />
            </label>
          ) : (
            <label>
              <span>{t("content.policy.ignoredUpdate")}</span>
              <TextField
                value={ignoredUpdate}
                onChange={(event) => setIgnoredUpdate(event.target.value)}
              />
            </label>
          )}
        </div>
      ) : null}

      <div className="settings-grid">
        <label>
          <span>{t("content.policy.candidateName")}</span>
          <TextField
            value={candidateName}
            onChange={(event) => setCandidateName(event.target.value)}
          />
        </label>
        <label>
          <span>{t("content.policy.currentVersion")}</span>
          <TextField
            value={candidateCurrentVersion}
            onChange={(event) => setCandidateCurrentVersion(event.target.value)}
          />
        </label>
        <label>
          <span>{t("content.policy.latestVersion")}</span>
          <TextField
            value={candidateLatestVersion}
            onChange={(event) => setCandidateLatestVersion(event.target.value)}
          />
        </label>
        <label>
          <span>{t("content.policy.candidateWarning")}</span>
          <TextField
            value={candidateWarning}
            onChange={(event) => setCandidateWarning(event.target.value)}
          />
        </label>
      </div>

      {policyQuery.error ? (
        <div className="inline-error">{policyQuery.error.message}</div>
      ) : null}
      {saveMutation.error ? (
        <div className="inline-error">{saveMutation.error.message}</div>
      ) : null}
      {planMutation.error ? (
        <div className="inline-error">{planMutation.error.message}</div>
      ) : null}

      <div className="content-policy-actions">
        <Button
          disabled={planMutation.isPending}
          onClick={() => planMutation.mutate()}
          variant="secondary"
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("content.policy.previewUpdates")}
        </Button>
        <span>
          <Bell aria-hidden="true" size={14} />
          {policyLabels[policy]}
        </span>
      </div>

      {planMutation.data ? (
        <div className="list-state">
          <strong>
            {t("content.policy.updatesPlanned", {
              count: planMutation.data.plannedUpdates.length,
            })}
          </strong>
          <span>
            {planMutation.data.plannedUpdates.length > 0
              ? planMutation.data.plannedUpdates.join(", ")
              : t("content.policy.noAutomaticInstall")}
          </span>
          {planMutation.data.warnings.map((warning) => (
            <span className="content-warning" key={warning}>
              <ShieldAlert aria-hidden="true" size={14} />
              {warning}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

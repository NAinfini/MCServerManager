import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { updateServerProfile } from "../servers/api";
import {
  installJavaRuntime,
  planJavaRuntime,
  type ManagedJavaPlan,
} from "./javaApi";

/* What the user is trying to get Java for. `serverId` is the whole reason the
   flow used to lose people: acquiring a runtime and pointing a server at it
   were two unrelated screens, so finishing the download left the server exactly
   as broken as before. Carrying the server through means one action finishes
   the job. */
export interface JavaTarget {
  majorVersion: number;
  maxMajorVersion: number | null;
  serverId: string | null;
}

/* One implementation of "get this server onto a Java it can run", shared by the
   Java page and by the entry point inside a server. Two copies of a license
   consent are two chances for them to disagree about what was agreed to. */
export function useJavaProvisioning({
  onFinished,
  serverNameFor,
}: {
  onFinished?: () => Promise<void> | void;
  serverNameFor?: (serverId: string) => string | undefined;
} = {}) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<JavaTarget | null>(null);
  const [plan, setPlan] = useState<ManagedJavaPlan | null>(null);
  const [consent, setConsent] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.servers.profiles,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.java.runtimes });
    await onFinished?.();
  };

  const closeDialog = () => {
    setTarget(null);
    setPlan(null);
    setConsent(false);
  };

  /* Pointing a server at a runtime it can use. Separate from acquiring one,
     because most of the time nothing needs downloading at all. */
  const applyMutation = useMutation({
    mutationFn: (input: { serverId: string; javaPath: string }) =>
      updateServerProfile({ id: input.serverId, javaPath: input.javaPath }),
    onSuccess: refresh,
  });

  const planMutation = useMutation({
    mutationFn: (next: JavaTarget) =>
      planJavaRuntime(next.majorVersion, next.maxMajorVersion),
    onSuccess: async (result, next) => {
      /* A plan that resolves to a runtime already installed is not a download
         to consent to — it is the answer. Showing it as a notice was the dead
         end: correct, and with nothing to press. */
      if (result.action === "reuse" && result.runtime?.path) {
        if (next.serverId) {
          await applyMutation.mutateAsync({
            serverId: next.serverId,
            javaPath: result.runtime.path,
          });
        } else {
          await refresh();
        }
        closeDialog();
        return;
      }
      setPlan(result);
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      const runtime = await installJavaRuntime(plan!, consent);
      if (target?.serverId && runtime.path) {
        await updateServerProfile({
          id: target.serverId,
          javaPath: runtime.path,
        });
      }
      return runtime;
    },
    onSuccess: async () => {
      await refresh();
      closeDialog();
    },
  });

  const start = (next: JavaTarget) => {
    planMutation.reset();
    installMutation.reset();
    setConsent(false);
    setPlan(null);
    setTarget(next);
    planMutation.mutate(next);
  };

  const apply = (serverId: string, javaPath: string) =>
    applyMutation.mutate({ serverId, javaPath });

  const appliesTo = target?.serverId
    ? (serverNameFor?.(target.serverId) ?? null)
    : null;

  /* A license has to be read before it is agreed to, which is the one thing in
     this flow that earns an interruption. Everything else it used to interrupt
     for now happens without one. */
  const dialog = (
    <DialogSurface
      className="java-install-dialog"
      description={t("java.install.description")}
      open={target !== null}
      title={t("java.install.title", { version: target?.majorVersion ?? "" })}
      footer={
        <>
          <Button
            disabled={installMutation.isPending}
            variant="ghost"
            onClick={closeDialog}
          >
            {t("common.cancel")}
          </Button>
          {/* The lookup can fail — a filtered route to the Adoptium API is the
              common one — and cancelling out just to press the same button
              again is not a recovery. */}
          {planMutation.error && target ? (
            <Button
              disabled={planMutation.isPending}
              variant="primary"
              onClick={() => planMutation.mutate(target)}
            >
              {t("common.retry")}
            </Button>
          ) : (
            <Button
              disabled={!plan || !consent || installMutation.isPending}
              variant="primary"
              onClick={() => installMutation.mutate()}
            >
              {t("java.managed.install")}
            </Button>
          )}
        </>
      }
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      {planMutation.isPending ? (
        <LoadingState message={t("java.install.preparing")} />
      ) : null}

      {planMutation.error ? (
        <div className="inline-error" role="alert">
          {planMutation.error.message}
        </div>
      ) : null}

      {plan ? (
        <>
          <dl className="java-install-summary">
            <div>
              <dt>{t("java.install.build")}</dt>
              <dd>
                {plan.vendor} {plan.version}
              </dd>
            </div>
            <div>
              <dt>{t("java.install.destination")}</dt>
              <dd>{t("java.install.destinationValue")}</dd>
            </div>
            {appliesTo ? (
              <div>
                <dt>{t("java.install.appliesTo")}</dt>
                <dd>{appliesTo}</dd>
              </div>
            ) : null}
          </dl>
          <label className="java-managed-consent">
            <Checkbox
              aria-label={t("java.managed.consent")}
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            <span>
              {t("java.managed.consent")}{" "}
              <a
                href={plan.licenseUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {t("java.managed.license")}
              </a>
            </span>
          </label>
        </>
      ) : null}

      {installMutation.error ? (
        <div className="inline-error" role="alert">
          {installMutation.error.message}
        </div>
      ) : null}
    </DialogSurface>
  );

  return {
    apply,
    applyError: applyMutation.error?.message ?? null,
    busy:
      planMutation.isPending ||
      installMutation.isPending ||
      applyMutation.isPending,
    dialog,
    start,
  };
}

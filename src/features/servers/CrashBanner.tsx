import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { disableCrashedMod, getCrashExplanation, startServer } from "../process/api";
import { processKeys } from "../process/queries";
import { useServerRuntime } from "./ServerRuntimeContext";

/* A crashed server says why, and offers the fix when there is one. */
export function CrashBanner({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const runtime = useServerRuntime();
  const crashed = runtime.status === "crashed";
  const explanationQuery = useQuery({
    queryKey: [...processKeys.status(serverId), "crash"],
    queryFn: () => getCrashExplanation(serverId),
    enabled: crashed,
  });
  const fixMutation = useMutation({
    mutationFn: async (modFile: string) => {
      await disableCrashedMod(serverId, modFile);
      await startServer(serverId);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: processKeys.status(serverId),
        }),
        queryClient.invalidateQueries({ queryKey: processKeys.summary }),
      ]),
  });
  const explanation = explanationQuery.data;
  if (!crashed || !explanation) return null;
  const mod = explanation.modName ?? explanation.modFile ?? "";

  return (
    <div className="crash-banner" role="alert">
      <AlertTriangle aria-hidden="true" size={16} />
      <div className="crash-banner-body">
        <strong>{t(`crash.${explanation.kind}.title`, { mod })}</strong>
        <p>{t(`crash.${explanation.kind}.description`, { mod })}</p>
        {explanation.detail ? <pre>{explanation.detail}</pre> : null}
        {explanation.reportFile ? (
          <small>{t("crash.report", { file: explanation.reportFile })}</small>
        ) : null}
        {fixMutation.error ? (
          <small className="inline-error">{fixMutation.error.message}</small>
        ) : null}
      </div>
      {explanation.kind === "clientOnlyMod" && explanation.modFile ? (
        <Button
          disabled={fixMutation.isPending}
          variant="primary"
          onClick={() => fixMutation.mutate(explanation.modFile as string)}
        >
          {t("crash.disableAndRestart")}
        </Button>
      ) : null}
    </div>
  );
}

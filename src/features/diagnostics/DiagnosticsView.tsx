import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Activity, Stethoscope } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { formatDateTime } from "../../lib/date-format";
import type { ServerProfile } from "../../domain/server";

interface DiagnosticCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

interface DiagnosticRun {
  id: string;
  serverId: string;
  status: "pass" | "warn" | "fail";
  results: DiagnosticCheck[];
  createdAt: string;
}

interface DiagnosticsViewProps {
  server: ServerProfile;
}

function diagnosticStatusLabel(
  status: DiagnosticRun["status"] | DiagnosticCheck["status"],
  t: (key: string) => string,
) {
  return t(`diagnostics.status.${status}`);
}

export function DiagnosticsView({ server }: DiagnosticsViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: queryKeys.diagnostics.runs(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun[]>(
        "list_diagnostic_runs",
        {
          serverId: server.id,
        },
      ),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun>(
        "run_server_diagnostics",
        {
          serverId: server.id,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.diagnostics.runs(server.id),
      });
    },
  });
  const latest = runMutation.data ?? historyQuery.data?.[0] ?? null;

  return (
    <section className="settings-panel" aria-label={t("diagnostics.aria")}>
      <div className="section-heading">
        <h2>{t("diagnostics.title")}</h2>
        <Button
          disabled={runMutation.isPending}
          variant="secondary"
          onClick={() => runMutation.mutate()}
        >
          <Stethoscope aria-hidden="true" size={15} />
          {t("diagnostics.run")}
        </Button>
      </div>
      {historyQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("diagnostics.loadError")}</strong>
          <span>{historyQuery.error.message}</span>
          <Button variant="secondary" onClick={() => historyQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {runMutation.error ? (
        <p className="danger-text" role="alert">
          {runMutation.error.message}
        </p>
      ) : null}
      {!historyQuery.error && latest ? (
        <>
          <div className="update-status-grid">
            <div>
              <span>{t("diagnostics.status")}</span>
              <strong
                className={`diagnostic-status diagnostic-status-${latest.status}`}
              >
                {diagnosticStatusLabel(latest.status, t)}
              </strong>
            </div>
            <div>
              <span>{t("diagnostics.runAt")}</span>
              <strong>{formatDateTime(latest.createdAt, language)}</strong>
            </div>
          </div>
          <div className="compatibility-list">
            {latest.results.map((result) => (
              <div className="diagnostic-result" key={result.name}>
                <strong
                  className={`diagnostic-status diagnostic-status-${result.status}`}
                >
                  {diagnosticStatusLabel(result.status, t)}
                </strong>
                <span>{result.message}</span>
              </div>
            ))}
          </div>
        </>
      ) : !historyQuery.error ? (
        <div className="list-state">
          <Activity aria-hidden="true" size={18} />
          <strong>{t("diagnostics.empty.title")}</strong>
          <span>{t("diagnostics.empty.description")}</span>
        </div>
      ) : null}
    </section>
  );
}

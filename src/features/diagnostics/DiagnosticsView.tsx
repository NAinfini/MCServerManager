import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Activity, Stethoscope } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DiagnosticsView({ server }: DiagnosticsViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["diagnosticRuns", server.id],
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun[]>("list_diagnostic_runs", {
        serverId: server.id,
      }),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<DiagnosticRun>("run_server_diagnostics", {
        serverId: server.id,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["diagnosticRuns", server.id],
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
        <p className="danger-text">{historyQuery.error.message}</p>
      ) : null}
      {runMutation.error ? (
        <p className="danger-text">{runMutation.error.message}</p>
      ) : null}
      {latest ? (
        <>
          <div className="update-status-grid">
            <div>
              <span>{t("diagnostics.status")}</span>
              <strong>{latest.status}</strong>
            </div>
            <div>
              <span>{t("diagnostics.runAt")}</span>
              <strong>{formatDate(latest.createdAt)}</strong>
            </div>
          </div>
          <div className="compatibility-list">
            {latest.results.map((result) => (
              <div key={result.name}>
                <strong>{result.status}</strong>
                <span>{result.message}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="list-state">
          <Activity aria-hidden="true" size={18} />
          <strong>{t("diagnostics.empty.title")}</strong>
          <span>{t("diagnostics.empty.description")}</span>
        </div>
      )}
    </section>
  );
}

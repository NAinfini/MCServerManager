import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AppShell } from "./components/layout/AppShell";
import { CloseBehaviorDialog } from "./features/app/CloseBehaviorDialog";
import { getProcessSummary } from "./features/process/api";
import {
  cancelProvisioningJob,
  listRecoverableProvisioningJobs,
  retryProvisioningJob,
  runProvisioningJob,
  type ProvisioningJob,
} from "./features/servers/provisioningApi";
import { AppSettingsProvider, useAppSettings } from "./i18n";
import {
  invokeDesktopCommand,
  isDesktopRuntimeAvailable,
  onDesktopCloseRequested,
  runDesktopWindowAction,
} from "./lib/desktop-runtime";
import { installRendererLogger } from "./lib/app-logger";
import "./styles.css";
import "./styles/preview/tokens.css";
import "./styles/preview/shell.css";
import "./styles/preview/components.css";
import "./styles/preview/pages.css";

const queryClient = new QueryClient();

function AppErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { t } = useAppSettings();

  return (
    <div className="app-crash-panel" role="alert">
      <div>
        <p className="eyebrow">{t("app.error.eyebrow")}</p>
        <h1>{t("app.error.title")}</h1>
        <p>{error.message}</p>
      </div>
      <button
        className="button button-primary"
        type="button"
        onClick={onRetry}
      >
        {t("app.error.retry")}
      </button>
    </div>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "MC Server Manager view failed to render.",
      error,
      info.componentStack,
    );
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <AppErrorFallback
        error={this.state.error}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <AppErrorBoundary>
          <AppRuntime />
        </AppErrorBoundary>
      </AppSettingsProvider>
    </QueryClientProvider>
  );
}

function AppRuntime() {
  const { t } = useAppSettings();
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const processSummaryQuery = useQuery({
    queryKey: ["processSummary"],
    queryFn: getProcessSummary,
    refetchInterval: 1500,
  });
  const runningServerCount = processSummaryQuery.data?.runningCount ?? null;
  const runningServerCountRef = useRef(runningServerCount);

  useEffect(() => {
    installRendererLogger();
  }, [t]);

  useEffect(() => {
    runningServerCountRef.current = runningServerCount;
  }, [runningServerCount]);

  useEffect(() => {
    if (!isDesktopRuntimeAvailable()) {
      return;
    }

    let isMounted = true;
    let removeCloseListener: (() => void) | undefined;

    const openCloseDialog = () => {
      if (isMounted) {
        setOperationError(null);
        setIsCloseDialogOpen(true);
      }
    };

    onDesktopCloseRequested(() => {
      void (async () => {
        try {
          const preferences = await invokeDesktopCommand<{
            closeBehavior?: "minimize" | "quit";
          }>("get_app_preferences");
          const closeBehavior = preferences.closeBehavior ?? "minimize";

          if (closeBehavior === "minimize") {
            await runDesktopWindowAction("hide");
            return;
          }

          if (runningServerCountRef.current === 0) {
            await invokeDesktopCommand("request_app_quit");
            return;
          }

          openCloseDialog();
        } catch (error) {
          console.error("Failed to apply window close behavior.", error);
          setOperationError(t("close.errors.applyBehavior"));
          openCloseDialog();
        }
      })();
    })
      .then((unlisten) => {
        if (isMounted) {
          removeCloseListener = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((error: unknown) => {
        console.error(
          "Failed to register window close behavior handler.",
          error,
        );
      });

    return () => {
      isMounted = false;
      removeCloseListener?.();
    };
  }, []);

  const handleMinimizeToTray = async () => {
    try {
      await runDesktopWindowAction("hide");
      setIsCloseDialogOpen(false);
      setOperationError(null);
    } catch (error) {
      console.error("Failed to minimize MC Server Manager to tray.", error);
      setOperationError(t("close.errors.minimize"));
    }
  };

  const handleQuit = async () => {
    try {
      await invokeDesktopCommand("request_app_quit");
    } catch (error) {
      console.error("Failed to quit MC Server Manager.", error);
      setOperationError(t("close.errors.quit"));
    }
  };

  return (
    <>
      <ProvisioningRecoveryNotice />
      <AppShell processSummary={processSummaryQuery.data ?? null} />
      <CloseBehaviorDialog
        isOpen={isCloseDialogOpen}
        operationError={operationError}
        runningServerCount={runningServerCount}
        onCancel={() => {
          setOperationError(null);
          setIsCloseDialogOpen(false);
        }}
        onMinimizeToTray={handleMinimizeToTray}
        onQuit={handleQuit}
      />
    </>
  );
}

function ProvisioningRecoveryNotice() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: ["recoverableProvisioningJobs"],
    queryFn: listRecoverableProvisioningJobs,
    refetchInterval: 5000,
  });
  const actionMutation = useMutation({
    mutationFn: async ({ action, job }: { action: "resume" | "cleanup"; job: ProvisioningJob }) => {
      if (action === "cleanup") return cancelProvisioningJob(job.id);
      return job.stage === "failed"
        ? retryProvisioningJob(job.id)
        : runProvisioningJob(job.id);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["recoverableProvisioningJobs"] });
      if (result.stage === "ready") {
        await queryClient.invalidateQueries({ queryKey: ["serverProfiles"] });
      }
    },
  });
  if (jobsQuery.error) {
    return (
      <aside className="provisioning-recovery-notice" role="alert">
        <strong>{t("provisioning.recovery.loadError")}</strong>
        <span className="danger-text">{jobsQuery.error.message}</span>
      </aside>
    );
  }
  const jobs = jobsQuery.data || [];
  if (jobs.length === 0) return null;

  return (
    <aside className="provisioning-recovery-notice" role="status">
      <div className="provisioning-recovery-list">
        <strong>{t("provisioning.recovery.title")}</strong>
        {actionMutation.error ? <span className="danger-text">{actionMutation.error.message}</span> : null}
        {jobs.map((job) => {
          const committed = job.progress?.committed === true;
          return (
            <div className="provisioning-recovery-job" key={job.id}>
              <span>{t("provisioning.recovery.description", { target: job.targetDir })}</span>
              <div className="provisioning-recovery-actions">
                <button
                  className="button button-primary"
                  disabled={actionMutation.isPending}
                  type="button"
                  onClick={() => actionMutation.mutate({ action: "resume", job })}
                >
                  {t("provisioning.recovery.resume")}
                </button>
                <button
                  className="button button-secondary"
                  disabled={actionMutation.isPending || committed}
                  title={committed ? t("provisioning.recovery.cleanupCommitted") : undefined}
                  type="button"
                  onClick={() => actionMutation.mutate({ action: "cleanup", job })}
                >
                  {t("provisioning.recovery.cleanup")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default App;

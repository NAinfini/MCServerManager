import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import type { ProvisioningJob, ProvisioningStage } from "./provisioningApi";

const activeStages: ProvisioningStage[] = [
  "downloading",
  "verifying",
  "extracting",
  "installingRuntime",
  "installingLoader",
  "writingConfiguration",
  "awaitingEula",
  "committing",
  "starting",
];

function progressValue(job: ProvisioningJob) {
  if (job.stage === "ready") return 100;
  const stage = job.stage === "failed" ? job.error?.stage : job.stage;
  const index = activeStages.indexOf(stage as ProvisioningStage);
  return index < 0 ? 0 : Math.round((index / activeStages.length) * 100);
}

interface ProvisioningProgressProps {
  job: ProvisioningJob;
  busy?: boolean;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

export function ProvisioningProgress({
  job,
  busy = false,
  onRetry,
  onCancel,
}: ProvisioningProgressProps) {
  const { t } = useAppSettings();
  const displayedStage = job.stage === "failed" ? job.error?.stage : job.stage;
  const canCancel =
    job.stage !== "ready" &&
    job.stage !== "failed" &&
    job.progress.committed !== true;

  return (
    <section className="provisioning-progress" aria-live="polite">
      <div className="provisioning-progress-heading">
        <div>
          <strong>{t("provisioning.progress.title")}</strong>
          <span>{t(`provisioning.stage.${displayedStage || "planned"}`)}</span>
        </div>
        {job.stage === "ready" ? <CheckCircle2 aria-hidden="true" size={20} /> : null}
      </div>
      <progress
        aria-label={t("provisioning.progress.aria")}
        aria-valuenow={progressValue(job)}
        max={100}
        value={progressValue(job)}
      />
      {/* Install is the longest step in the wizard and used to show a single
          line of text. The checklist names what is done, what is running, and
          what is still ahead. */}
      <ol className="provisioning-stage-list">
        {activeStages.map((stage) => {
          const index = activeStages.indexOf(stage);
          const currentIndex = activeStages.indexOf(
            displayedStage as ProvisioningStage,
          );
          const done =
            job.stage === "ready" ||
            job.progress.completedStages?.includes(stage) === true ||
            (currentIndex >= 0 && index < currentIndex);
          const current = index === currentIndex && job.stage !== "ready";
          return (
            <li
              className="provisioning-stage-item"
              data-state={
                current
                  ? job.stage === "failed"
                    ? "failed"
                    : "current"
                  : done
                    ? "done"
                    : "pending"
              }
              key={stage}
            >
              {done ? (
                <CheckCircle2 aria-hidden="true" size={14} />
              ) : current && job.stage === "failed" ? (
                <AlertTriangle aria-hidden="true" size={14} />
              ) : (
                <Circle aria-hidden="true" size={14} />
              )}
              <span>{t(`provisioning.stage.${stage}`)}</span>
            </li>
          );
        })}
      </ol>
      {job.error ? (
        <div className="form-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{job.error.message}</span>
        </div>
      ) : null}
      <div className="provisioning-progress-actions">
        {job.error?.retryable ? (
          <Button disabled={busy} variant="primary" onClick={() => onRetry(job.id)}>
            {t("provisioning.action.retry")}
          </Button>
        ) : null}
        {canCancel ? (
          <Button disabled={busy} variant="secondary" onClick={() => onCancel(job.id)}>
            {t("provisioning.action.cancel")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

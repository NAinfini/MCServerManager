import {
  Alert,
  Group,
  List,
  Loader,
  Progress,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
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

function formatElapsed(createdAt: string, updatedAt: string) {
  const start = Date.parse(createdAt);
  const end = Date.parse(updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
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
  const stageIndex = activeStages.indexOf(displayedStage as ProvisioningStage);
  /* The backend reports stage transitions only — no byte or file counts — so the
     elapsed figure is derived from the job timestamps rather than invented. */
  const elapsed = formatElapsed(job.createdAt, job.updatedAt);
  const canCancel =
    job.stage !== "ready" &&
    job.stage !== "failed" &&
    job.progress.committed !== true;

  return (
    <Stack aria-live="polite" component="section" gap="md">
      {/* The stage is the headline. A fixed "Installing" title with the stage
          demoted to a subtitle told the user nothing they could not already see
          from the spinner. */}
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Text fw={600} size="md">
            {t(`provisioning.stage.${displayedStage || "planned"}`)}
          </Text>
          <Text c="dimmed" ff="monospace" size="xs">
            {[
              stageIndex >= 0
                ? t("provisioning.progress.stageCounter", {
                    current: stageIndex + 1,
                    total: activeStages.length,
                  })
                : null,
              elapsed,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </div>
        {job.stage === "ready" ? (
          <ThemeIcon color="green" radius="xl" variant="light">
            <CheckCircle2 aria-hidden="true" size={16} />
          </ThemeIcon>
        ) : null}
      </Group>
      <Progress.Root size="sm">
        <Progress.Section
          animated={job.stage !== "ready" && job.stage !== "failed"}
          aria-label={t("provisioning.progress.aria")}
          color={job.stage === "failed" ? "red" : undefined}
          value={progressValue(job)}
        />
      </Progress.Root>
      {/* Install is the longest step in the wizard and used to show a single
          line of text. The checklist names what is done, what is running, and
          what is still ahead. */}
      <List listStyleType="none" size="sm" spacing={6} type="ordered">
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
          const failed = current && job.stage === "failed";
          return (
            <List.Item
              c={failed ? "red" : current || done ? undefined : "dimmed"}
              data-state={
                current
                  ? failed
                    ? "failed"
                    : "current"
                  : done
                    ? "done"
                    : "pending"
              }
              fw={current ? 600 : undefined}
              icon={
                done ? (
                  <CheckCircle2
                    aria-hidden="true"
                    color="var(--mantine-color-green-6)"
                    size={14}
                  />
                ) : failed ? (
                  <AlertTriangle aria-hidden="true" size={14} />
                ) : current ? (
                  <Loader size={12} />
                ) : (
                  <Circle aria-hidden="true" size={14} />
                )
              }
              key={stage}
            >
              {t(`provisioning.stage.${stage}`)}
            </List.Item>
          );
        })}
      </List>
      {job.error ? (
        <Alert
          color="red"
          icon={<AlertTriangle aria-hidden="true" size={16} />}
          role="alert"
          variant="light"
        >
          {job.error.message}
        </Alert>
      ) : null}
      <Group gap="sm">
        {job.error?.retryable ? (
          <Button
            disabled={busy}
            variant="primary"
            onClick={() => onRetry(job.id)}
          >
            {t("provisioning.action.retry")}
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => onCancel(job.id)}
          >
            {t("provisioning.action.cancel")}
          </Button>
        ) : null}
      </Group>
    </Stack>
  );
}

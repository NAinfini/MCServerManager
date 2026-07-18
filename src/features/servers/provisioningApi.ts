import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type {
  CompatibilityWarning,
  ExplicitEulaAcceptance,
  GuidedServerConfiguration,
  LoaderType,
  RestartPolicy,
  ServerCreationSource,
  ServerLaunchSpec,
  ValidatedJavaRuntime,
} from "./types";

export type ProvisioningStage =
  | "planned"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installingRuntime"
  | "installingLoader"
  | "writingConfiguration"
  | "awaitingEula"
  | "committing"
  | "starting"
  | "ready"
  | "failed";

export interface ProvisioningError {
  code: string;
  stage: string;
  message: string;
  detail: unknown;
  retryable: boolean;
  cleanupRequired: boolean;
}

export interface SourceProvisioningPlan {
  source: ServerCreationSource;
  pack?: { format: string; name: string; versionId?: string | null };
  minecraftVersion?: string | null;
  loaderType?: LoaderType | null;
  loaderVersion?: string | null;
  requiredJavaMajor?: number | null;
  warnings: CompatibilityWarning[];
  launchSpec?: ServerLaunchSpec;
  [key: string]: unknown;
}

export interface ServerPlanningInput {
  source: ServerCreationSource;
  name?: string;
  prepareInstall?: boolean;
  rootDir?: string;
  loaderType?: LoaderType;
  minecraftVersion?: string;
  loaderVersion?: string;
}

export interface FinalProvisioningPlan extends SourceProvisioningPlan {
  targetDir: string;
  profile: {
    name: string;
    loaderType: LoaderType;
    minecraftVersion: string;
    loaderVersion?: string | null;
    autoStart: boolean;
    restartPolicy: RestartPolicy;
  };
  configuration: GuidedServerConfiguration;
  compatibilityWarnings: CompatibilityWarning[];
  acknowledgedWarningCodes: string[];
  eula: ExplicitEulaAcceptance;
  javaRuntime: ValidatedJavaRuntime;
  launchSpec: ServerLaunchSpec & { validated: true };
}

export interface ProvisioningJob {
  id: string;
  serverId: string | null;
  stage: ProvisioningStage;
  plan: Record<string, unknown>;
  progress: {
    completedStages?: string[];
    resumeStage?: string | null;
    committed?: boolean;
  };
  stagingDir: string | null;
  targetDir: string;
  error: ProvisioningError | null;
  createdAt: string;
  updatedAt: string;
}

export interface JavaRuntimePlan {
  action: "reuse" | "install";
  majorVersion: number;
  runtime?: Omit<ValidatedJavaRuntime, "validated">;
  vendor?: string;
  version?: string;
  licenseUrl?: string;
  [key: string]: unknown;
}

export function planServerProvisioning(input: ServerPlanningInput) {
  return invokeDesktopCommandWithErrorHandling<SourceProvisioningPlan>(
    "plan_server_provisioning",
    { input },
  );
}

export function planJavaRuntime(majorVersion: number) {
  return invokeDesktopCommandWithErrorHandling<JavaRuntimePlan>(
    "plan_java_runtime",
    { input: { majorVersion } },
  );
}

export function installJavaRuntime(plan: JavaRuntimePlan, consent: boolean) {
  return invokeDesktopCommandWithErrorHandling<Omit<ValidatedJavaRuntime, "validated">>(
    "install_java_runtime",
    { input: { plan, consent } },
  );
}

export function createProvisioningJob(plan: FinalProvisioningPlan) {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob>(
    "create_provisioning_job",
    { input: { plan } },
  );
}

export function getProvisioningJob(jobId: string) {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob>(
    "get_provisioning_job",
    { input: { jobId } },
  );
}

export function listRecoverableProvisioningJobs() {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob[]>(
    "list_recoverable_provisioning_jobs",
  );
}

export function runProvisioningJob(jobId: string) {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob>(
    "run_provisioning_job",
    { input: { jobId } },
  );
}

export function retryProvisioningJob(jobId: string) {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob>(
    "retry_provisioning_job",
    { input: { jobId } },
  );
}

export function cancelProvisioningJob(jobId: string) {
  return invokeDesktopCommandWithErrorHandling<ProvisioningJob>(
    "cancel_provisioning_job",
    { input: { jobId } },
  );
}

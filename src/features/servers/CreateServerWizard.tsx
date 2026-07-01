import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Upload,
  Server,
  FolderOpen,
  Package,
  FileArchive,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { createServerProfile, getDefaultServerRoot } from "./api";
import {
  CreateServerMarketplaceBrowser,
  type MarketplaceCreateSelection,
} from "./CreateServerMarketplaceBrowser";
import { WizardStepIndicator } from "./WizardStepIndicator";
import type { CreateServerProfileInput, LoaderType, ServerCreationSource } from "./types";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { LoaderSelect } from "../loaders/LoaderSelect";
import { listLoaderMinecraftVersions, listLoaderVersions } from "./api";
import {
  installCurseForgeFile,
  installBbsmcPublicFile,
  installModrinthVersion,
} from "../marketplace/marketplaceApi";

type WizardStep = 0 | 1 | 2 | 3;
type SubView = "main" | "marketplace";
type PendingPicker = "file" | "folder";

const loaderTypes = [
  "vanilla",
  "paper",
  "forge",
  "neoForge",
  "fabric",
] as const;
const sourceKinds = [
  "blank",
  "existingFolder",
  "marketplaceModpack",
  "localModpackFile",
] as const;

function createSchema(t: (key: string) => string) {
  return z
    .object({
      sourceKind: z.enum(sourceKinds),
      name: z.string().trim().min(1, t("createServer.validation.nameRequired")),
      rootDir: z.string().trim().min(1, t("createServer.validation.folderRequired")),
      loaderType: z.enum(loaderTypes),
      minecraftVersion: z
        .string()
        .trim()
        .min(1, t("createServer.validation.minecraftRequired")),
      loaderVersion: z
        .string()
        .trim()
        .min(1, t("createServer.validation.loaderRequired")),
      javaPath: z.string().trim().optional(),
      serverPort: z.coerce.number().int().min(1).max(65535).optional(),
      minMemoryMb: z.coerce.number().int().positive().optional(),
      maxMemoryMb: z.coerce.number().int().positive().optional(),
      restartEnabled: z.boolean().default(true),
      restartMaxAttempts: z.coerce.number().int().min(0).default(3),
      restartCooldownSeconds: z.coerce.number().int().min(0).default(30),
      autoStart: z.boolean().default(false),
      marketplaceProvider: z.string().trim().optional(),
      marketplaceProjectId: z.string().trim().optional(),
      marketplaceVersionId: z.string().trim().optional(),
      localModpackPath: z.string().trim().optional(),
    })
    .refine(
      (value) =>
        !value.minMemoryMb ||
        !value.maxMemoryMb ||
        value.minMemoryMb <= value.maxMemoryMb,
      {
        message: t("createServer.validation.memoryOrder"),
        path: ["maxMemoryMb"],
      },
    )
    .refine(
      (value) =>
        value.sourceKind !== "marketplaceModpack" ||
        Boolean(value.marketplaceProjectId),
      {
        message: t("createServer.validation.marketplaceRequired"),
        path: ["marketplaceProjectId"],
      },
    )
    .refine(
      (value) =>
        value.sourceKind !== "marketplaceModpack" ||
        Boolean(value.marketplaceVersionId),
      {
        message: t("createServer.validation.marketplaceVersionRequired"),
        path: ["marketplaceVersionId"],
      },
    )
    .refine(
      (value) =>
        value.sourceKind !== "localModpackFile" ||
        Boolean(value.localModpackPath),
      {
        message: t("createServer.validation.localFileRequired"),
        path: ["localModpackPath"],
      },
    );
}

type FormInput = z.input<ReturnType<typeof createSchema>>;
type FormValues = z.output<ReturnType<typeof createSchema>>;

interface CreateServerWizardProps {
  onCreated?: () => void;
  onHeaderBackChange?: (handler: (() => void) | null) => void;
  onHeaderHiddenChange?: (hidden: boolean) => void;
  showHeading?: boolean;
}

async function pickFolder(): Promise<string | null> {
  const result = await invokeDesktopCommand<{ path: string | null }>(
    "show_open_dialog",
    { kind: "folder" },
  );
  return result?.path ?? null;
}

async function pickFile(): Promise<string | null> {
  const result = await invokeDesktopCommand<{ path: string | null }>(
    "show_open_dialog",
    {
      kind: "file",
      filters: [
        { name: "Modpack or server jar", extensions: ["zip", "mrpack", "jar"] },
      ],
    },
  );
  return result?.path ?? null;
}

function pickerErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function installMarketplaceSelection(
  serverId: string,
  selection: MarketplaceCreateSelection,
) {
  if (selection.provider === "Modrinth") {
    await installModrinthVersion(
      serverId,
      selection.projectId,
      selection.versionId,
    );
    return;
  }
  if (selection.provider === "CurseForge") {
    await installCurseForgeFile(
      serverId,
      selection.projectId,
      selection.versionId,
      selection.title,
      selection.versionName,
    );
    return;
  }
  await installBbsmcPublicFile(serverId, selection.versionId, selection.title);
}

function toSource(values: FormValues): ServerCreationSource {
  if (values.sourceKind === "marketplaceModpack") {
    return {
      kind: "marketplaceModpack",
      provider: values.marketplaceProvider || "Modrinth",
      projectId: values.marketplaceProjectId || "",
      versionId: values.marketplaceVersionId || "",
    };
  }
  if (values.sourceKind === "localModpackFile") {
    return { kind: "localModpackFile", path: values.localModpackPath || "" };
  }
  return { kind: values.sourceKind };
}

function normalizeNumber(value?: number) {
  return Number.isFinite(value) ? value : null;
}

function toSelectOptions(options: Array<{ value: string; label: string }>) {
  return options.map((option) => ({
    label: option.label,
    value: option.value,
  }));
}

function singleSelectOption(value: string | null | undefined): SelectOption[] {
  return value ? [{ label: value, value }] : [];
}

export function CreateServerWizard({
  onCreated,
  onHeaderBackChange,
  onHeaderHiddenChange,
  showHeading = true,
}: CreateServerWizardProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(0);
  const [subView, setSubView] = useState<SubView>("main");
  const [sourceKind, setSourceKind] = useState<string>("blank");
  const [importedPath, setImportedPath] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingPicker, setPendingPicker] = useState<PendingPicker | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [, setMarketplaceDetailOpen] = useState(false);
  const [marketplaceSelection, setMarketplaceSelection] =
    useState<MarketplaceCreateSelection | null>(null);

  const schema = useMemo(() => createSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sourceKind: "blank",
      loaderType: "paper",
      minecraftVersion: "",
      loaderVersion: "",
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      restartEnabled: true,
      restartMaxAttempts: 3,
      restartCooldownSeconds: 30,
      autoStart: false,
    },
  });

  // Version loading state
  const [minecraftOptions, setMinecraftOptions] = useState<SelectOption[]>([]);
  const [loaderVersionOptions, setLoaderVersionOptions] = useState<SelectOption[]>([]);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [isLoadingMinecraftVersions, setIsLoadingMinecraftVersions] = useState(false);
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false);
  const [folderPickerError, setFolderPickerError] = useState<string | null>(null);
  const [rootDirUserSelected, setRootDirUserSelected] = useState(false);

  const loaderType = useWatch({ control, name: "loaderType" }) as LoaderType;
  const serverName = useWatch({ control, name: "name" });
  const minecraftVersion = useWatch({ control, name: "minecraftVersion" });
  const marketplaceFieldsLocked =
    sourceKind === "marketplaceModpack" && marketplaceSelection !== null;
  const marketplaceLocksLoader =
    marketplaceFieldsLocked && Boolean(marketplaceSelection.loaderType);
  const marketplaceLocksMinecraftVersion =
    marketplaceFieldsLocked && Boolean(marketplaceSelection.minecraftVersion);
  const marketplaceLocksLoaderVersion =
    marketplaceFieldsLocked && Boolean(marketplaceSelection.loaderVersion);

  useEffect(() => {
    let isCurrent = true;
    setVersionError(null);
    setMinecraftOptions([]);
    setLoaderVersionOptions([]);
    if (
      marketplaceFieldsLocked &&
      marketplaceSelection?.loaderType === loaderType &&
      marketplaceSelection.minecraftVersion
    ) {
      setMinecraftOptions(singleSelectOption(marketplaceSelection.minecraftVersion));
      setValue("minecraftVersion", marketplaceSelection.minecraftVersion, {
        shouldValidate: true,
      });
      if (marketplaceSelection.loaderVersion) {
        setLoaderVersionOptions(singleSelectOption(marketplaceSelection.loaderVersion));
        setValue("loaderVersion", marketplaceSelection.loaderVersion, {
          shouldValidate: true,
        });
      }
      setIsLoadingMinecraftVersions(false);
      return () => { isCurrent = false; };
    }
    setValue("minecraftVersion", "", { shouldValidate: false });
    setValue("loaderVersion", "", { shouldValidate: false });
    setIsLoadingMinecraftVersions(true);
    listLoaderMinecraftVersions(loaderType)
      .then((options) => {
        if (!isCurrent) return;
        setMinecraftOptions(toSelectOptions(options));
      })
      .catch((caught) => {
        if (!isCurrent) return;
        setVersionError(
          caught instanceof Error
            ? caught.message
            : "Unable to load Minecraft versions.",
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoadingMinecraftVersions(false);
      });
    return () => { isCurrent = false; };
  }, [loaderType, marketplaceFieldsLocked, marketplaceSelection, setValue]);

  useEffect(() => {
    let isCurrent = true;
    setVersionError(null);
    setLoaderVersionOptions([]);
    if (
      marketplaceFieldsLocked &&
      marketplaceSelection?.minecraftVersion === minecraftVersion &&
      marketplaceSelection.loaderVersion
    ) {
      setLoaderVersionOptions(singleSelectOption(marketplaceSelection.loaderVersion));
      setValue("loaderVersion", marketplaceSelection.loaderVersion, {
        shouldValidate: true,
      });
      setIsLoadingLoaderVersions(false);
      return () => { isCurrent = false; };
    }
    setValue("loaderVersion", "", { shouldValidate: false });
    if (!minecraftVersion) {
      return () => { isCurrent = false; };
    }
    setIsLoadingLoaderVersions(true);
    listLoaderVersions(loaderType, minecraftVersion)
      .then((options) => {
        if (!isCurrent) return;
        setLoaderVersionOptions(toSelectOptions(options));
      })
      .catch((caught) => {
        if (!isCurrent) return;
        setVersionError(
          caught instanceof Error
            ? caught.message
            : "Unable to load loader versions.",
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoadingLoaderVersions(false);
      });
    return () => { isCurrent = false; };
  }, [loaderType, marketplaceFieldsLocked, marketplaceSelection, minecraftVersion, setValue]);

  useEffect(() => {
    if (rootDirUserSelected || sourceKind === "existingFolder") {
      return;
    }

    let isCurrent = true;
    setFolderPickerError(null);
    getDefaultServerRoot(serverName || "server")
      .then((path) => {
        if (!isCurrent) return;
        setValue("rootDir", path, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: true,
        });
      })
      .catch((caught) => {
        if (!isCurrent) return;
        setFolderPickerError(
          caught instanceof Error
            ? caught.message
            : t("profileSettings.folderPickerError"),
        );
      });

    return () => {
      isCurrent = false;
    };
  }, [rootDirUserSelected, serverName, setValue, sourceKind, t]);

  const mutation = useMutation({
    mutationFn: async (input: CreateServerProfileInput) => {
      const profile = await createServerProfile(input);
      if (input.source.kind === "marketplaceModpack" && marketplaceSelection) {
        await installMarketplaceSelection(profile.id, marketplaceSelection);
      }
      return profile;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["serverProfiles"] });
      onCreated?.();
    },
  });

  const wizardSteps = useMemo(
    () => [
      { label: t("wizard.step.source") },
      { label: t("wizard.step.configure") },
      { label: t("wizard.step.java") },
      { label: t("wizard.step.review") },
    ],
    [t],
  );

  // Source selection handlers
  const handleBlankServer = () => {
    setPickerError(null);
    setMarketplaceSelection(null);
    setRootDirUserSelected(false);
    setSourceKind("blank");
    setImportedPath(null);
    setValue("sourceKind", "blank");
    setStep(1);
  };

  const handleImportFolder = async () => {
    setPickerError(null);
    setMarketplaceSelection(null);
    setPendingPicker("folder");
    try {
      const path = await pickFolder();
      if (path) {
        setRootDirUserSelected(true);
        setSourceKind("existingFolder");
        setImportedPath(path);
        setValue("sourceKind", "existingFolder");
        setValue("rootDir", path);
        setStep(1);
      }
    } catch (error) {
      setPickerError(pickerErrorMessage(error, t("createServer.pickerError")));
    } finally {
      setPendingPicker(null);
    }
  };

  const handleLocalFile = async () => {
    setPickerError(null);
    setMarketplaceSelection(null);
    setPendingPicker("file");
    try {
      const path = await pickFile();
      if (path) {
        setRootDirUserSelected(false);
        setSourceKind("localModpackFile");
        setImportedPath(path);
        setValue("sourceKind", "localModpackFile");
        setValue("localModpackPath", path);
        setStep(1);
      }
    } catch (error) {
      setPickerError(pickerErrorMessage(error, t("createServer.pickerError")));
    } finally {
      setPendingPicker(null);
    }
  };

  const handleMarketplace = () => {
    setPickerError(null);
    setMarketplaceDetailOpen(false);
    setSubView("marketplace");
  };

  useEffect(() => {
    if (!onHeaderBackChange) return;
    if (subView === "marketplace") {
      onHeaderBackChange(() => setSubView("main"));
      return () => onHeaderBackChange(null);
    }
    onHeaderBackChange(null);
    return undefined;
  }, [onHeaderBackChange, subView]);

  useEffect(() => {
    if (!onHeaderHiddenChange) return;
    onHeaderHiddenChange(false);
    return () => onHeaderHiddenChange(false);
  }, [onHeaderHiddenChange]);

  const handleMarketplaceSelect = (selection: MarketplaceCreateSelection) => {
    setMarketplaceSelection(selection);
    setRootDirUserSelected(false);
    setSourceKind("marketplaceModpack");
    setImportedPath(null);
    setValue("sourceKind", "marketplaceModpack");
    setValue("marketplaceProvider", selection.provider);
    setValue("marketplaceProjectId", selection.projectId);
    setValue("marketplaceVersionId", selection.versionId);
    setValue("name", selection.title);
    if (selection.loaderType) {
      setValue("loaderType", selection.loaderType);
    }
    if (selection.minecraftVersion) {
      setValue("minecraftVersion", selection.minecraftVersion);
    }
    if (selection.loaderVersion) {
      setValue("loaderVersion", selection.loaderVersion);
    }
    setMarketplaceDetailOpen(false);
    setSubView("main");
    setStep(1);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        const name = file.name.toLowerCase();
        if (
          name.endsWith(".zip") ||
          name.endsWith(".mrpack") ||
          name.endsWith(".jar")
        ) {
          const path = (file as unknown as { path?: string }).path ?? file.name;
          setRootDirUserSelected(false);
          setSourceKind("localModpackFile");
          setImportedPath(path);
          setValue("sourceKind", "localModpackFile");
          setValue("localModpackPath", path);
          setStep(1);
        }
      }
    },
    [setValue],
  );

  const pickServerFolder = async () => {
    setFolderPickerError(null);
    try {
      const result = await invokeDesktopCommand<{ path: string | null }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result?.path) {
        setRootDirUserSelected(true);
        setValue("rootDir", result.path, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
        await trigger("rootDir");
      }
    } catch (caught) {
      setFolderPickerError(
        caught instanceof Error
          ? caught.message
          : t("profileSettings.folderPickerError"),
      );
    }
  };

  const goBack = () => {
    if (step > 0) setStep((step - 1) as WizardStep);
  };

  const goNext = async () => {
    if (step === 1) {
      const valid = await trigger(["name", "rootDir", "loaderType", "minecraftVersion", "loaderVersion"]);
      if (!valid) return;
    }
    if (step < 3) setStep((step + 1) as WizardStep);
  };

  const handleStepClick = (targetStep: number) => {
    if (targetStep < step) {
      setStep(targetStep as WizardStep);
    }
  };

  const doSubmit = handleSubmit((values) =>
    mutation.mutateAsync({
      source: toSource(values),
      name: values.name,
      rootDir: values.rootDir,
      loaderType: values.loaderType as LoaderType,
      minecraftVersion: values.minecraftVersion,
      loaderVersion: values.loaderVersion,
      javaPath: values.javaPath || null,
      serverPort: normalizeNumber(values.serverPort ?? 25565),
      minMemoryMb: normalizeNumber(values.minMemoryMb ?? 1024),
      maxMemoryMb: normalizeNumber(values.maxMemoryMb ?? 4096),
      restartPolicy: {
        enabled: values.restartEnabled ?? true,
        maxAttempts: values.restartMaxAttempts ?? 3,
        cooldownSeconds: values.restartCooldownSeconds ?? 30,
      },
    }),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && step === 3 && !mutation.isPending) {
      e.preventDefault();
      doSubmit();
    }
  };

  // Marketplace sub-view
  if (subView === "marketplace") {
    return (
      <section className="create-server-panel" aria-label={t("createServer.aria")}>
        <div className="wizard-marketplace-step">
          <CreateServerMarketplaceBrowser
            onDetailModeChange={setMarketplaceDetailOpen}
            onSelect={handleMarketplaceSelect}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      className="create-server-panel"
      aria-label={t("createServer.aria")}
      onKeyDown={handleKeyDown}
    >
      {showHeading ? (
        <div className="section-heading">
          <div>
            <h2>{t("createServer.title")}</h2>
            <span>{t("createServer.description")}</span>
          </div>
        </div>
      ) : null}

      <WizardStepIndicator
        currentStep={step}
        steps={wizardSteps}
        onStepClick={handleStepClick}
      />

      <form
        className="wizard-step-content"
        id="server-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 3) doSubmit();
        }}
      >
        <input type="hidden" {...register("sourceKind")} />
        <input type="hidden" {...register("marketplaceProvider")} />
        <input type="hidden" {...register("marketplaceProjectId")} />
        <input type="hidden" {...register("marketplaceVersionId")} />
        <input type="hidden" {...register("localModpackPath")} />

        {/* Step 0: Source selection */}
        {step === 0 && (
          <div className="wizard-pick-view">
            <button
              aria-label={t("createServer.openModpackFile")}
              className={`wizard-dropzone ${isDragOver ? "wizard-dropzone-active" : ""}`}
              disabled={pendingPicker !== null}
              type="button"
              onClick={handleLocalFile}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <Upload aria-hidden="true" size={20} />
              <span>
                {pendingPicker === "file"
                  ? t("createServer.openingFilePicker")
                  : t("createServer.dropzone")}
              </span>
            </button>

            {pickerError ? (
              <div className="wizard-picker-error" role="alert">
                {pickerError}
              </div>
            ) : null}

            <div className="wizard-actions">
              <button
                className="wizard-action"
                disabled={pendingPicker !== null}
                type="button"
                onClick={handleBlankServer}
              >
                <Server aria-hidden="true" size={24} />
                <span>{t("createServer.newBlank")}</span>
              </button>
              <button
                className="wizard-action"
                disabled={pendingPicker !== null}
                type="button"
                onClick={handleImportFolder}
              >
                <FolderOpen aria-hidden="true" size={24} />
                <span>
                  {pendingPicker === "folder"
                    ? t("createServer.openingFolderPicker")
                    : t("createServer.importFolder")}
                </span>
              </button>
              <button
                className="wizard-action"
                disabled={pendingPicker !== null}
                type="button"
                onClick={handleMarketplace}
              >
                <Package aria-hidden="true" size={24} />
                <span>{t("createServer.browseMarketplace")}</span>
              </button>
              <button
                className="wizard-action"
                disabled={pendingPicker !== null}
                type="button"
                onClick={handleLocalFile}
              >
                <FileArchive aria-hidden="true" size={24} />
                <span>{t("createServer.openModpackFile")}</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Configuration */}
        {step === 1 && (
          <div className="wizard-form-step">
            {importedPath ? (
              <div className="create-source-summary">
                <FileArchive aria-hidden="true" size={12} />
                <strong>{importedPath}</strong>
              </div>
            ) : null}

            <label>
              <span>{t("profileSettings.name")}</span>
              <TextField
                {...register("name")}
                aria-describedby={errors.name ? "server-name-error" : undefined}
                aria-invalid={Boolean(errors.name)}
                autoComplete="off"
                placeholder={t("profileSettings.name")}
              />
              {errors.name ? (
                <small id="server-name-error">{errors.name.message}</small>
              ) : null}
            </label>

            <label>
              <span>{t("profileSettings.loader")}</span>
              <Controller
                control={control}
                name="loaderType"
                render={({ field }) => (
                  <LoaderSelect
                    name={field.name}
                    disabled={marketplaceLocksLoader}
                    value={field.value}
                    onValueChange={(value) => field.onChange(value)}
                  />
                )}
              />
            </label>

            <div className="form-grid">
              <label>
                <span>{t("profileSettings.minecraftVersion")}</span>
                <Controller
                  control={control}
                  name="minecraftVersion"
                  render={({ field }) => (
                    <Select
                      ariaLabel={t("profileSettings.minecraftVersion")}
                      disabled={
                        marketplaceLocksMinecraftVersion ||
                        isLoadingMinecraftVersions ||
                        minecraftOptions.length === 0
                      }
                      options={minecraftOptions}
                      placeholder={
                        isLoadingMinecraftVersions
                          ? t("createServer.form.loading")
                          : t("createServer.form.selectVersion")
                      }
                      value={field.value || ""}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                {errors.minecraftVersion ? (
                  <small>{errors.minecraftVersion.message}</small>
                ) : null}
              </label>
              <label>
                <span>{t("profileSettings.loaderVersion")}</span>
                <Controller
                  control={control}
                  name="loaderVersion"
                  render={({ field }) => (
                    <Select
                      ariaLabel={t("profileSettings.loaderVersion")}
                      disabled={
                        marketplaceLocksLoaderVersion ||
                        !minecraftVersion ||
                        isLoadingLoaderVersions ||
                        loaderVersionOptions.length === 0
                      }
                      options={loaderVersionOptions}
                      placeholder={
                        isLoadingLoaderVersions
                          ? t("createServer.form.loading")
                          : t("createServer.form.selectVersion")
                      }
                      value={field.value || ""}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                {errors.loaderVersion ? (
                  <small>{errors.loaderVersion.message}</small>
                ) : null}
              </label>
            </div>

            <label>
              <span>{t("profileSettings.serverFolder")}</span>
              <div className="field-with-action">
                <TextField
                  {...register("rootDir")}
                  aria-describedby={errors.rootDir ? "server-root-error" : undefined}
                  aria-invalid={Boolean(errors.rootDir)}
                  placeholder={t("profileSettings.serverFolder")}
                  readOnly
                  onClick={pickServerFolder}
                />
                <Button variant="secondary" type="button" onClick={pickServerFolder}>
                  <FolderOpen aria-hidden="true" size={15} />
                  {t("profileSettings.browse")}
                </Button>
              </div>
              {errors.rootDir ? (
                <small id="server-root-error">{errors.rootDir.message}</small>
              ) : null}
              {folderPickerError ? <small>{folderPickerError}</small> : null}
            </label>

            {versionError ? (
              <div aria-live="polite" className="form-error" role="alert">
                {versionError}
              </div>
            ) : null}
          </div>
        )}

        {/* Step 2: Java & Memory */}
        {step === 2 && (
          <div className="wizard-form-step">
            <label>
              <span>{t("profileSettings.javaPath")}</span>
              <TextField
                {...register("javaPath")}
                autoComplete="off"
                placeholder={t("profileSettings.javaPathAuto")}
              />
            </label>

            <div className="form-grid">
              <label>
                <span>{t("profileSettings.minMemory")}</span>
                <TextField
                  {...register("minMemoryMb")}
                  type="number"
                  min={256}
                  step={256}
                  placeholder="1024"
                />
                {errors.minMemoryMb ? (
                  <small>{errors.minMemoryMb.message}</small>
                ) : null}
              </label>
              <label>
                <span>{t("profileSettings.maxMemory")}</span>
                <TextField
                  {...register("maxMemoryMb")}
                  type="number"
                  min={512}
                  step={256}
                  placeholder="4096"
                />
                {errors.maxMemoryMb ? (
                  <small>{errors.maxMemoryMb.message}</small>
                ) : null}
              </label>
            </div>

            <label>
              <span>{t("profileSettings.port")}</span>
              <TextField
                {...register("serverPort")}
                type="number"
                min={1}
                max={65535}
                placeholder="25565"
              />
              {errors.serverPort ? (
                <small>{errors.serverPort.message}</small>
              ) : null}
            </label>

            <div className="checkbox-row">
              <input type="checkbox" {...register("autoStart")} id="auto-start" />
              <label htmlFor="auto-start">
                <span>{t("profileSettings.autoStart")}</span>
              </label>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="wizard-review-step">
            <h3 className="wizard-review-title">{t("wizard.review.title")}</h3>
            <ReviewSummary getValues={getValues} t={t} sourceKind={sourceKind} importedPath={importedPath} marketplaceSelection={marketplaceSelection} />
            {mutation.error ? (
              <div aria-live="polite" className="form-error" role="alert">
                {mutation.error.message}
              </div>
            ) : null}
          </div>
        )}
      </form>

      {/* Navigation buttons */}
      <div className="wizard-nav-bar">
        {step > 0 && (
          <Button variant="ghost" type="button" onClick={goBack}>
            <ChevronLeft aria-hidden="true" size={14} />
            {t("wizard.nav.back")}
          </Button>
        )}
        <div className="wizard-nav-spacer" />
        {step > 0 && step < 3 && (
          <Button variant="primary" type="button" onClick={goNext}>
            {t("wizard.nav.next")}
            <ChevronRight aria-hidden="true" size={14} />
          </Button>
        )}
        {step === 3 && (
          <Button
            variant="primary"
            type="button"
            disabled={mutation.isPending}
            onClick={() => doSubmit()}
          >
            {mutation.isPending
              ? t("createServer.form.creating")
              : t("wizard.review.create")}
          </Button>
        )}
      </div>
    </section>
  );
}

/* Review summary sub-component */
function ReviewSummary({
  getValues,
  t,
  sourceKind,
  importedPath,
  marketplaceSelection,
}: {
  getValues: () => FormInput;
  t: (key: string) => string;
  sourceKind: string;
  importedPath: string | null;
  marketplaceSelection: MarketplaceCreateSelection | null;
}) {
  const values = getValues();
  const warnings: string[] = [];

  if (!values.maxMemoryMb || (values.maxMemoryMb as number) < 2048) {
    warnings.push(t("createServer.validation.memoryLow"));
  }

  const sourceLabel = marketplaceSelection
    ? marketplaceSelection.title
    : importedPath
      ? importedPath.split(/[\\/]/).pop() || sourceKind
      : sourceKind;

  return (
    <div className="wizard-review-card">
      <dl className="wizard-review-fields">
        <div className="wizard-review-row">
          <dt>{t("wizard.step.source")}</dt>
          <dd>{sourceLabel}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.name")}</dt>
          <dd>{values.name || "—"}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.loader")}</dt>
          <dd>{values.loaderType}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.minecraftVersion")}</dt>
          <dd>{values.minecraftVersion || "—"}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.loaderVersion")}</dt>
          <dd>{values.loaderVersion || "—"}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.serverFolder")}</dt>
          <dd className="wizard-review-path">{values.rootDir || "—"}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.port")}</dt>
          <dd>{String(values.serverPort || 25565)}</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.minMemory")}</dt>
          <dd>{String(values.minMemoryMb || 1024)} MB</dd>
        </div>
        <div className="wizard-review-row">
          <dt>{t("profileSettings.maxMemory")}</dt>
          <dd>{String(values.maxMemoryMb || 4096)} MB</dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <div className="wizard-review-warnings">
          <strong>
            <AlertTriangle aria-hidden="true" size={13} />
            {t("wizard.review.warnings")}
          </strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

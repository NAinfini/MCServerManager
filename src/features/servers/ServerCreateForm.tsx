import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { FolderOpen } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { LoaderSelect } from "../loaders/LoaderSelect";
import { listLoaderMinecraftVersions, listLoaderVersions } from "./api";
import type {
  CreateServerProfileInput,
  LoaderType,
  ServerCreationSource,
} from "./types";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";

const loaderTypes = [
  "vanilla",
  "paper",
  "forge",
  "neoForge",
  "fabric",
  "quilt",
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

interface ServerCreateFormProps {
  onSubmit: (input: CreateServerProfileInput) => Promise<void> | void;
  isSubmitting?: boolean;
  error?: string | null;
  defaultSourceKind?: string;
  defaultLocalModpackPath?: string | null;
  defaultRootDir?: string | null;
  defaultName?: string | null;
  defaultMarketplaceProvider?: string | null;
  defaultMarketplaceProjectId?: string | null;
  defaultMarketplaceVersionId?: string | null;
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

export function ServerCreateForm({
  onSubmit,
  isSubmitting = false,
  error = null,
  defaultSourceKind,
  defaultLocalModpackPath,
  defaultRootDir,
  defaultName,
  defaultMarketplaceProvider,
  defaultMarketplaceProjectId,
  defaultMarketplaceVersionId,
}: ServerCreateFormProps) {
  const { t } = useAppSettings();
  const schema = useMemo(() => createSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sourceKind:
        (defaultSourceKind as (typeof sourceKinds)[number]) || "blank",
      loaderType: "paper",
      minecraftVersion: "",
      loaderVersion: "",
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      restartEnabled: true,
      restartMaxAttempts: 3,
      restartCooldownSeconds: 30,
      name: defaultName || undefined,
      localModpackPath: defaultLocalModpackPath || undefined,
      rootDir: defaultRootDir || undefined,
      marketplaceProvider: defaultMarketplaceProvider || "Modrinth",
      marketplaceProjectId: defaultMarketplaceProjectId || undefined,
      marketplaceVersionId: defaultMarketplaceVersionId || undefined,
    },
  });
  const sourceDetail = defaultName || defaultLocalModpackPath || defaultRootDir;
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [minecraftOptions, setMinecraftOptions] = useState<SelectOption[]>([]);
  const [loaderVersionOptions, setLoaderVersionOptions] = useState<
    SelectOption[]
  >([]);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [isLoadingMinecraftVersions, setIsLoadingMinecraftVersions] =
    useState(false);
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false);
  const loaderType = useWatch({ control, name: "loaderType" }) as LoaderType;
  const minecraftVersion = useWatch({ control, name: "minecraftVersion" });

  useEffect(() => {
    let isCurrent = true;
    setVersionError(null);
    setMinecraftOptions([]);
    setLoaderVersionOptions([]);
    setValue("minecraftVersion", "", { shouldValidate: false });
    setValue("loaderVersion", "", { shouldValidate: false });
    setIsLoadingMinecraftVersions(true);
    listLoaderMinecraftVersions(loaderType)
      .then((options) => {
        if (!isCurrent) return;
        const selectOptions = toSelectOptions(options);
        setMinecraftOptions(selectOptions);
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
        if (isCurrent) {
          setIsLoadingMinecraftVersions(false);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [loaderType, setValue]);

  useEffect(() => {
    let isCurrent = true;
    setVersionError(null);
    setLoaderVersionOptions([]);
    setValue("loaderVersion", "", { shouldValidate: false });
    if (!minecraftVersion) {
      return () => {
        isCurrent = false;
      };
    }
    setIsLoadingLoaderVersions(true);
    listLoaderVersions(loaderType, minecraftVersion)
      .then((options) => {
        if (!isCurrent) return;
        const selectOptions = toSelectOptions(options);
        setLoaderVersionOptions(selectOptions);
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
        if (isCurrent) {
          setIsLoadingLoaderVersions(false);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [loaderType, minecraftVersion, setValue]);

  const pickServerFolder = async () => {
    setPickerError(null);
    try {
      const result = await invokeDesktopCommand<{ path: string | null }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result?.path) {
        setValue("rootDir", result.path, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
        await trigger("rootDir");
      }
    } catch (caught) {
      setPickerError(
        caught instanceof Error
          ? caught.message
          : t("profileSettings.folderPickerError"),
      );
    }
  };

  return (
    <form
      className="create-server-form"
      id="server-create-form"
      onSubmit={handleSubmit((values) =>
        onSubmit({
          source: toSource(values),
          name: values.name,
          rootDir: values.rootDir,
          loaderType: values.loaderType as LoaderType,
          minecraftVersion: values.minecraftVersion,
          loaderVersion: values.loaderVersion,
          javaPath: null,
          serverPort: normalizeNumber(values.serverPort ?? 25565),
          minMemoryMb: normalizeNumber(values.minMemoryMb ?? 1024),
          maxMemoryMb: normalizeNumber(values.maxMemoryMb ?? 4096),
          restartPolicy: {
            enabled: values.restartEnabled ?? true,
            maxAttempts: values.restartMaxAttempts ?? 3,
            cooldownSeconds: values.restartCooldownSeconds ?? 30,
          },
        }),
      )}
    >
      <input type="hidden" {...register("sourceKind")} />
      <input type="hidden" {...register("marketplaceProvider")} />
      <input type="hidden" {...register("marketplaceProjectId")} />
      <input type="hidden" {...register("marketplaceVersionId")} />
      <input type="hidden" {...register("localModpackPath")} />

      {sourceDetail ? (
        <div className="create-source-summary">
          <strong>{sourceDetail}</strong>
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
          <Button variant="secondary" onClick={pickServerFolder}>
            <FolderOpen aria-hidden="true" size={15} />
            {t("profileSettings.browse")}
          </Button>
        </div>
        {errors.rootDir ? (
          <small id="server-root-error">{errors.rootDir.message}</small>
        ) : null}
        {pickerError ? <small>{pickerError}</small> : null}
      </label>

      <label>
        <span>{t("profileSettings.loader")}</span>
        <Controller
          control={control}
          name="loaderType"
          render={({ field }) => (
            <LoaderSelect
              name={field.name}
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
                  isLoadingMinecraftVersions || minecraftOptions.length === 0
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

      {versionError ? (
        <div aria-live="polite" className="form-error" role="alert">
          {versionError}
        </div>
      ) : null}

      {error ? (
        <div aria-live="polite" className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <Button disabled={isSubmitting} type="submit" variant="primary">
        {isSubmitting
          ? t("createServer.form.creating")
          : t("createServer.form.createProfile")}
      </Button>
    </form>
  );
}

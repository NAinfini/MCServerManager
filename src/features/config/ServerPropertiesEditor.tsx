import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Save, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import type { ServerProfile } from "../../domain/server";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";

interface ServerPropertyEntry {
  key: string;
  value: string;
  known: boolean;
}

interface ServerPropertiesDocument {
  serverId: string;
  entries: ServerPropertyEntry[];
  raw: string;
  restartRequired?: boolean;
}

interface ServerPropertiesEditorProps {
  server: ServerProfile;
}

type PropertyGroup = "basic" | "world" | "players" | "performance" | "network";

interface PropertyDefinition {
  key: keyof ServerPropertiesForm;
  group: PropertyGroup;
  kind?: "boolean" | "difficulty" | "gamemode" | "levelType";
}

const booleanOptions: readonly SelectOption[] = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

const gamemodeOptions: readonly SelectOption[] = [
  { value: "survival", label: "survival" },
  { value: "creative", label: "creative" },
  { value: "adventure", label: "adventure" },
  { value: "spectator", label: "spectator" },
];

const difficultyOptions: readonly SelectOption[] = [
  { value: "peaceful", label: "peaceful" },
  { value: "easy", label: "easy" },
  { value: "normal", label: "normal" },
  { value: "hard", label: "hard" },
];

const levelTypeOptions: readonly SelectOption[] = [
  { value: "minecraft:normal", label: "normal" },
  { value: "minecraft:flat", label: "flat" },
  { value: "minecraft:large_biomes", label: "large biomes" },
  { value: "minecraft:amplified", label: "amplified" },
  { value: "minecraft:single_biome_surface", label: "single biome" },
];

const optionalInteger = z.string().regex(/^$|^\d+$/, "Enter a whole number");
const optionalPort = z
  .string()
  .regex(
    /^$|^([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/,
    "Enter a port from 1 to 65535",
  );
const optionalDistance = z
  .string()
  .regex(/^$|^(?:[2-9]|[12]\d|3[0-2])$/, "Enter a value from 2 to 32");

export const serverPropertiesSchema = z.object({
  motd: z.string().max(256, "Keep the message under 256 characters"),
  "level-name": z.string().max(255, "Keep the world name under 255 characters"),
  "server-port": optionalPort,
  gamemode: z.enum(["", "survival", "creative", "adventure", "spectator"]),
  difficulty: z.enum(["", "peaceful", "easy", "normal", "hard"]),
  "max-players": optionalInteger,
  "online-mode": z.enum(["", "true", "false"]),
  "white-list": z.enum(["", "true", "false"]),
  "enforce-whitelist": z.enum(["", "true", "false"]),
  "enable-command-block": z.enum(["", "true", "false"]),
  "allow-flight": z.enum(["", "true", "false"]),
  pvp: z.enum(["", "true", "false"]),
  "view-distance": optionalDistance,
  "simulation-distance": optionalDistance,
  "level-seed": z.string().max(255, "Keep the seed under 255 characters"),
  "level-type": z.enum([
    "",
    "minecraft:normal",
    "minecraft:flat",
    "minecraft:large_biomes",
    "minecraft:amplified",
    "minecraft:single_biome_surface",
  ]),
  "generate-structures": z.enum(["", "true", "false"]),
  "force-gamemode": z.enum(["", "true", "false"]),
  hardcore: z.enum(["", "true", "false"]),
  "spawn-protection": optionalInteger,
  "player-idle-timeout": optionalInteger,
  "max-tick-time": optionalInteger,
  "max-world-size": optionalInteger,
  "entity-broadcast-range-percentage": optionalInteger,
  "network-compression-threshold": z
    .string()
    .regex(/^$|^-?\d+$/, "Enter a whole number"),
  "sync-chunk-writes": z.enum(["", "true", "false"]),
  "server-ip": z.string().max(255, "Keep the address under 255 characters"),
  "enable-query": z.enum(["", "true", "false"]),
  "query.port": optionalPort,
  "enable-rcon": z.enum(["", "true", "false"]),
  "rcon.port": optionalPort,
  "rcon.password": z
    .string()
    .max(255, "Keep the password under 255 characters"),
  "prevent-proxy-connections": z.enum(["", "true", "false"]),
  "hide-online-players": z.enum(["", "true", "false"]),
  "rate-limit": optionalInteger,
});

export type ServerPropertiesForm = z.infer<typeof serverPropertiesSchema>;

export const propertyDefinitions: readonly PropertyDefinition[] = [
  { key: "motd", group: "basic" },
  { key: "gamemode", group: "basic", kind: "gamemode" },
  { key: "difficulty", group: "basic", kind: "difficulty" },
  { key: "pvp", group: "basic", kind: "boolean" },
  { key: "enable-command-block", group: "basic", kind: "boolean" },
  { key: "allow-flight", group: "basic", kind: "boolean" },
  { key: "online-mode", group: "basic", kind: "boolean" },
  { key: "level-name", group: "world" },
  { key: "level-seed", group: "world" },
  { key: "level-type", group: "world", kind: "levelType" },
  { key: "generate-structures", group: "world", kind: "boolean" },
  { key: "force-gamemode", group: "world", kind: "boolean" },
  { key: "hardcore", group: "world", kind: "boolean" },
  { key: "spawn-protection", group: "world" },
  { key: "max-players", group: "players" },
  { key: "white-list", group: "players", kind: "boolean" },
  { key: "enforce-whitelist", group: "players", kind: "boolean" },
  { key: "player-idle-timeout", group: "players" },
  { key: "view-distance", group: "performance" },
  { key: "simulation-distance", group: "performance" },
  { key: "max-tick-time", group: "performance" },
  { key: "max-world-size", group: "performance" },
  { key: "entity-broadcast-range-percentage", group: "performance" },
  { key: "network-compression-threshold", group: "performance" },
  { key: "sync-chunk-writes", group: "performance", kind: "boolean" },
  { key: "server-port", group: "network" },
  { key: "server-ip", group: "network" },
  { key: "enable-query", group: "network", kind: "boolean" },
  { key: "query.port", group: "network" },
  { key: "enable-rcon", group: "network", kind: "boolean" },
  { key: "rcon.port", group: "network" },
  { key: "rcon.password", group: "network" },
  { key: "prevent-proxy-connections", group: "network", kind: "boolean" },
  { key: "hide-online-players", group: "network", kind: "boolean" },
  { key: "rate-limit", group: "network" },
];

const propertyGroups: readonly PropertyGroup[] = [
  "basic",
  "world",
  "players",
  "performance",
  "network",
];

export function serverPropertiesDefaultValues(
  entries: ServerPropertyEntry[],
): ServerPropertiesForm {
  const byKey = new Map(entries.map((entry) => [entry.key, entry.value]));
  return Object.fromEntries(
    propertyDefinitions.map(({ key }) => [key, byKey.get(key) ?? ""]),
  ) as ServerPropertiesForm;
}

export function filterPropertyGroups(search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  return propertyGroups
    .map((group) => ({
      group,
      definitions: propertyDefinitions.filter(
        (definition) =>
          definition.group === group &&
          (!normalizedSearch ||
            definition.key.toLowerCase().includes(normalizedSearch)),
      ),
    }))
    .filter(({ definitions }) => definitions.length > 0);
}

function selectOptions(kind: PropertyDefinition["kind"]) {
  switch (kind) {
    case "boolean":
      return booleanOptions;
    case "difficulty":
      return difficultyOptions;
    case "gamemode":
      return gamemodeOptions;
    case "levelType":
      return levelTypeOptions;
    default:
      return null;
  }
}

export function ServerPropertiesEditor({
  server,
}: ServerPropertiesEditorProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [restartRequired, setRestartRequired] = useState(false);
  const baselineRef = useRef<ServerPropertiesForm | null>(null);
  const [values, setValues] = useState<ServerPropertiesForm>(() =>
    serverPropertiesDefaultValues([]),
  );
  const form = useForm<ServerPropertiesForm>({
    defaultValues: serverPropertiesDefaultValues([]),
    resolver: zodResolver(serverPropertiesSchema),
  });
  const propertiesQuery = useQuery({
    queryKey: queryKeys.properties.server(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerPropertiesDocument>(
        "read_server_properties",
        {
          serverId: server.id,
        },
      ),
  });
  const saveMutation = useMutation({
    mutationFn: (updates: ServerPropertyEntry[]) =>
      invokeDesktopCommandWithErrorHandling<ServerPropertiesDocument>(
        "save_server_properties",
        {
          input: { serverId: server.id, updates },
        },
      ),
    onSuccess: async (saved) => {
      const nextValues = serverPropertiesDefaultValues(saved.entries);
      baselineRef.current = nextValues;
      setValues(nextValues);
      form.reset(nextValues);
      setRestartRequired(saved.restartRequired === true);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.properties.server(server.id),
      });
    },
  });

  useEffect(() => {
    if (!propertiesQuery.data) {
      return;
    }
    const nextValues = serverPropertiesDefaultValues(
      propertiesQuery.data.entries,
    );
    if (!baselineRef.current || !form.formState.isDirty) {
      baselineRef.current = nextValues;
      setValues(nextValues);
      form.reset(nextValues);
    }
  }, [form, form.formState.isDirty, propertiesQuery.data]);

  useUnsavedGuard({
    isDirty: form.formState.isDirty,
    message: t("properties.unsaved.confirm"),
    onDiscard: () => {
      if (baselineRef.current) {
        setValues(baselineRef.current);
        form.reset(baselineRef.current);
      }
    },
  });

  const hasPropertiesFile = Boolean(
    propertiesQuery.data &&
    (propertiesQuery.data.raw.length > 0 ||
      propertiesQuery.data.entries.length > 0),
  );
  const groupedDefinitions = filterPropertyGroups(search);
  const updateValue = <Key extends keyof ServerPropertiesForm>(
    key: Key,
    value: ServerPropertiesForm[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    form.setValue(key, value as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <section className="settings-panel" aria-label={t("properties.aria")}>
      <div className="section-heading">
        <h2>{t("properties.title")}</h2>
        <span>{t("properties.description")}</span>
      </div>
      {propertiesQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("properties.loadError.title")}</strong>
          <span>{propertiesQuery.error.message}</span>
          <Button variant="secondary" onClick={() => propertiesQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {propertiesQuery.data && !hasPropertiesFile ? (
        <div className="list-state" role="status">
          <strong>{t("properties.empty.title")}</strong>
          <span>{t("properties.empty.description")}</span>
        </div>
      ) : null}
      {propertiesQuery.data && hasPropertiesFile ? (
        <form
          className="create-server-form"
          onSubmit={form.handleSubmit((values) => {
            const baseline =
              baselineRef.current ?? serverPropertiesDefaultValues([]);
            saveMutation.mutate(
              propertyDefinitions
                .filter(({ key }) => values[key] !== baseline[key])
                .map(({ key }) => ({ key, value: values[key], known: true })),
            );
          })}
        >
          <label>
            {t("properties.search")}
            <span className="field-with-icon">
              <Search aria-hidden="true" size={15} />
              <TextField
                placeholder={t("properties.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>
          {groupedDefinitions.map(({ group, definitions }) => (
            <fieldset className="settings-section" key={group}>
              <legend>{t(`properties.group.${group}`)}</legend>
              <div className="settings-grid">
                {definitions.map((definition) => {
                  const error = form.formState.errors[definition.key]?.message;
                  const options = selectOptions(definition.kind);
                  return (
                    <label key={definition.key}>
                      {definition.key}
                      {options ? (
                        <Select
                          ariaLabel={definition.key}
                          key={`${definition.key}-${values[definition.key]}`}
                          options={options}
                          value={values[definition.key]}
                          onValueChange={(value) =>
                            updateValue(
                              definition.key,
                              value as ServerPropertiesForm[typeof definition.key],
                            )
                          }
                        />
                      ) : (
                        <TextField
                          aria-invalid={Boolean(error)}
                          value={values[definition.key]}
                          onChange={(event) =>
                            updateValue(definition.key, event.target.value)
                          }
                        />
                      )}
                      {error ? (
                        <small className="danger-text" role="alert">
                          {error}
                        </small>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {groupedDefinitions.length === 0 ? (
            <p className="settings-notice">{t("properties.searchEmpty")}</p>
          ) : null}
          {saveMutation.error ? (
            <p className="danger-text" role="alert">
              {saveMutation.error.message}
            </p>
          ) : null}
          {restartRequired ? (
            <p className="settings-notice" role="status">
              {t("properties.restartRequired")}
            </p>
          ) : null}
          <Button
            disabled={saveMutation.isPending || !form.formState.isDirty}
            type="submit"
            variant="primary"
          >
            <Save aria-hidden="true" size={15} />
            {t("properties.save")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

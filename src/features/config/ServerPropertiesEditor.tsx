import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";

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

const editableKeys = [
  "motd",
  "level-name",
  "server-port",
  "gamemode",
  "difficulty",
  "max-players",
  "online-mode",
  "white-list",
  "enable-command-block",
  "allow-flight",
  "pvp",
  "view-distance",
  "simulation-distance",
];
const booleanOptions = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
] as const;

function entryValue(entries: ServerPropertyEntry[], key: string) {
  return entries.find((entry) => entry.key === key)?.value ?? "";
}

function editableValues(entries: ServerPropertyEntry[]) {
  return Object.fromEntries(
    editableKeys.map((key) => [key, entryValue(entries, key)]),
  );
}

function valuesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  return editableKeys.every((key) => (left[key] ?? "") === (right[key] ?? ""));
}

export function ServerPropertiesEditor({
  server,
}: ServerPropertiesEditorProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const propertiesQuery = useQuery({
    queryKey: ["serverProperties", server.id],
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerPropertiesDocument>("read_server_properties", {
        serverId: server.id,
      }),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [restartRequired, setRestartRequired] = useState(false);
  const baselineRef = useRef<{
    serverId: string;
    values: Record<string, string>;
  } | null>(null);
  const saveMutation = useMutation({
    mutationFn: (updates: ServerPropertyEntry[]) =>
      invokeDesktopCommandWithErrorHandling<ServerPropertiesDocument>("save_server_properties", {
        input: {
          serverId: server.id,
          updates,
        },
      }),
    onSuccess: async (saved) => {
      const nextValues = editableValues(saved.entries);
      baselineRef.current = { serverId: saved.serverId, values: nextValues };
      setValues(nextValues);
      setRestartRequired(saved.restartRequired === true);
      await queryClient.invalidateQueries({
        queryKey: ["serverProperties", server.id],
      });
    },
  });

  useEffect(() => {
    if (!propertiesQuery.data) {
      return;
    }
    const nextValues = editableValues(propertiesQuery.data.entries);
    setValues((currentValues) => {
      const baseline = baselineRef.current;
      const isNewDocument =
        baseline?.serverId !== propertiesQuery.data.serverId;
      if (
        isNewDocument ||
        (baseline !== null && valuesEqual(currentValues, baseline.values))
      ) {
        baselineRef.current = {
          serverId: propertiesQuery.data.serverId,
          values: nextValues,
        };
        return nextValues;
      }

      return currentValues;
    });
  }, [propertiesQuery.data]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const baseline = baselineRef.current?.values || {};
    saveMutation.mutate(
      editableKeys
        .filter((key) => (values[key] ?? "") !== (baseline[key] ?? ""))
        .map((key) => ({
          key,
          value: values[key] ?? "",
          known: true,
        })),
    );
  }

  return (
    <section className="settings-panel" aria-label={t("properties.aria")}>
      <div className="section-heading">
        <h2>{t("properties.title")}</h2>
        <span>{t("properties.description")}</span>
      </div>
      {propertiesQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("properties.loadError.title")}</strong>
          <span>{propertiesQuery.error.message}</span>
        </div>
      ) : null}
      {propertiesQuery.data ? (
        <form className="create-server-form" onSubmit={handleSubmit}>
          {editableKeys.map((key) => {
            const isBoolean = [
              "online-mode",
              "white-list",
              "enable-command-block",
              "allow-flight",
              "pvp",
            ].includes(key);
            return (
              <label key={key}>
                {key}
                {isBoolean ? (
                  <Select
                    ariaLabel={key}
                    options={booleanOptions}
                    value={values[key] ?? "false"}
                    onValueChange={(value) =>
                      setValues({ ...values, [key]: value })
                    }
                  />
                ) : (
                  <TextField
                    value={values[key] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [key]: event.target.value })
                    }
                  />
                )}
              </label>
            );
          })}
          {saveMutation.error ? (
            <p className="danger-text">{saveMutation.error.message}</p>
          ) : null}
          {restartRequired ? (
            <p className="settings-notice" role="status">
              {t("properties.restartRequired")}
            </p>
          ) : null}
          <Button
            disabled={saveMutation.isPending}
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

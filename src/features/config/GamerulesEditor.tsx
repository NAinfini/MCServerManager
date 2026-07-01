import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Send } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { sendServerCommand } from "../process/api";
import type { ServerProfile } from "../servers/types";

interface GamerulesEditorProps {
  server: ServerProfile;
}

const gameruleOptions = [
  { value: "keepInventory", labelKey: "gamerules.keepInventory" },
  { value: "mobGriefing", labelKey: "gamerules.mobGriefing" },
  { value: "doDaylightCycle", labelKey: "gamerules.doDaylightCycle" },
  { value: "doWeatherCycle", labelKey: "gamerules.doWeatherCycle" },
  { value: "doImmediateRespawn", labelKey: "gamerules.doImmediateRespawn" },
  { value: "playersSleepingPercentage", labelKey: "gamerules.playersSleepingPercentage" },
  { value: "randomTickSpeed", labelKey: "gamerules.randomTickSpeed" },
  { value: "spawnRadius", labelKey: "gamerules.spawnRadius" },
] as const;
type GameruleKey = (typeof gameruleOptions)[number]["value"];

const booleanOptions = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
] as const;

const numericRules = new Set([
  "playersSleepingPercentage",
  "randomTickSpeed",
  "spawnRadius",
]);

export function GamerulesEditor({ server }: GamerulesEditorProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [rule, setRule] = useState<GameruleKey>(gameruleOptions[0].value);
  const [value, setValue] = useState("true");
  const isNumericRule = numericRules.has(rule);
  const command = `gamerule ${rule} ${value.trim()}`;
  const mutation = useMutation({
    mutationFn: () => sendServerCommand(server.id, command),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["processEvents", server.id],
      });
    },
  });

  function updateRule(nextRule: string) {
    setRule(nextRule as GameruleKey);
    setValue(numericRules.has(nextRule) ? "" : "true");
    mutation.reset();
  }

  return (
    <section className="settings-panel" aria-label={t("gamerules.aria")}>
      <div className="section-heading">
        <div>
          <h2>{t("gamerules.title")}</h2>
          <span>{t("gamerules.description")}</span>
        </div>
        <Gamepad2 aria-hidden="true" size={18} />
      </div>
      <div className="gamerule-grid">
        <label>
          {t("gamerules.rule")}
          <Select
            ariaLabel={t("gamerules.rule")}
            options={gameruleOptions.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            value={rule}
            onValueChange={updateRule}
          />
        </label>
        <label>
          {t("gamerules.value")}
          {isNumericRule ? (
            <TextField
              inputMode="numeric"
              placeholder={t("gamerules.placeholder.number")}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <Select
              ariaLabel={t("gamerules.valueAria")}
              options={booleanOptions}
              value={value}
              onValueChange={setValue}
            />
          )}
        </label>
        <Button
          disabled={mutation.isPending || value.trim() === ""}
          variant="primary"
          onClick={() => mutation.mutate()}
        >
          <Send aria-hidden="true" size={15} />
          {t("gamerules.apply")}
        </Button>
      </div>
      <code className="command-preview">{command}</code>
      {mutation.error ? (
        <p className="danger-text">{mutation.error.message}</p>
      ) : null}
    </section>
  );
}

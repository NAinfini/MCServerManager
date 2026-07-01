import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { TextArea } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";
import {
  readPlayerLists,
  savePlayerList,
  type PlayerListDocument,
  type PlayerListEntry,
} from "./api";

interface PlayerListsViewProps {
  server: ServerProfile;
}

function labelFor(list: PlayerListDocument) {
  return list.fileName.replace(".json", "");
}

function entryLabel(entry: PlayerListEntry) {
  return entry.name ?? entry.ip ?? "Unnamed entry";
}

function updateEntryLabel(
  entry: PlayerListEntry,
  nextLabel: string,
  list: PlayerListDocument,
): PlayerListEntry {
  if (list.listType === "bannedIps") {
    return { ...entry, ip: nextLabel };
  }
  return { ...entry, name: nextLabel };
}

export function PlayerListsView({ server }: PlayerListsViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingSaveList, setPendingSaveList] =
    useState<PlayerListDocument | null>(null);
  const listsQuery = useQuery({
    queryKey: ["playerLists", server.id],
    queryFn: () => readPlayerLists(server.id),
  });
  const saveMutation = useMutation({
    mutationFn: (list: PlayerListDocument) =>
      savePlayerList({
        serverId: server.id,
        listType: list.listType,
        entries: parseDraft(drafts[list.listType] ?? "", list),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["playerLists", server.id] }),
        queryClient.invalidateQueries({ queryKey: ["players", server.id] }),
      ]);
      setPendingSaveList(null);
    },
  });
  const lists = listsQuery.data?.lists ?? [];

  function draftFor(list: PlayerListDocument) {
    return drafts[list.listType] ?? list.entries.map(entryLabel).join("\n");
  }

  return (
    <section className="settings-panel" aria-label={t("players.lists.title")}>
      <div className="section-heading">
        <h2>{t("players.lists.title")}</h2>
        <span>{t("players.lists.description")}</span>
      </div>
      {listsQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("players.lists.loadError.title")}</strong>
          <span>{listsQuery.error.message}</span>
        </div>
      ) : null}
      {lists.map((list) => (
        <div className="download-panel" key={list.listType}>
          <div className="section-heading">
            <h3>{labelFor(list)}</h3>
            <span>{t("players.lists.entries", { count: list.entries.length })}</span>
          </div>
          {list.error ? <p className="danger-text">{list.error}</p> : null}
          <TextArea
            aria-label={`${labelFor(list)} entries`}
            value={draftFor(list)}
            onChange={(event) =>
              setDrafts({ ...drafts, [list.listType]: event.target.value })
            }
          />
          <Button
            disabled={Boolean(list.error) || saveMutation.isPending}
            variant="secondary"
            onClick={() => {
              saveMutation.reset();
              setPendingSaveList(list);
            }}
          >
            <Save aria-hidden="true" size={15} />
            {t("players.lists.save", { list: labelFor(list) })}
          </Button>
        </div>
      ))}
      {saveMutation.error ? (
        <p className="danger-text">{saveMutation.error.message}</p>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.savePlayerList")}
        description={t("danger.playerList.save.description", {
          list: pendingSaveList ? labelFor(pendingSaveList) : "",
          server: server.name,
        })}
        error={saveMutation.error?.message ?? null}
        isConfirming={saveMutation.isPending}
        isOpen={pendingSaveList !== null}
        title={t("danger.playerList.save.title")}
        onCancel={() => setPendingSaveList(null)}
        onConfirm={() => {
          if (pendingSaveList) {
            saveMutation.mutate(pendingSaveList);
          }
        }}
      />
    </section>
  );
}

function parseDraft(
  value: string,
  list: PlayerListDocument,
): PlayerListEntry[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (list.listType === "bannedIps") {
        const existing = list.entries.find((entry) => entry.ip === line);
        return existing ? updateEntryLabel(existing, line, list) : { ip: line };
      }
      const existing = list.entries.find((entry) => entry.name === line);
      return existing ? updateEntryLabel(existing, line, list) : { name: line };
    });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import * as Toolbar from "@radix-ui/react-toolbar";
import * as Separator from "@radix-ui/react-separator";
import { Copy, Eraser, RefreshCw } from "lucide-react";
import {
  getServerProcessStatus,
  sendServerCommand,
  listProcessEvents,
  type ProcessEvent,
} from "../process/api";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { CommandSuggestions } from "./CommandSuggestions";
import { MC_COMMANDS } from "./mcCommands";

interface ConsoleViewProps {
  serverId: string;
}

const commandTemplates = [
  { labelKey: "console.templates.list", command: "list" },
  { labelKey: "console.templates.save", command: "save-all flush" },
  { labelKey: "console.templates.whitelistReload", command: "whitelist reload" },
  { labelKey: "console.templates.whitelistOn", command: "whitelist on" },
  { labelKey: "console.templates.whitelistOff", command: "whitelist off" },
  { labelKey: "console.templates.stop", command: "stop" },
];

export function ConsoleView({ serverId }: ConsoleViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writtenEventIdsRef = useRef<Set<string>>(new Set());
  const commandHistoryRef = useRef<string[]>([]);
  const [terminalReadyToken, setTerminalReadyToken] = useState(0);
  const [commandText, setCommandText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [terminalLoadError, setTerminalLoadError] = useState<string | null>(
    null,
  );
  const normalizedSearch = searchText.trim().toLowerCase();
  const eventsQuery = useQuery({
    queryKey: ["processEvents", serverId],
    queryFn: () => listProcessEvents(serverId),
    refetchInterval: 1000,
  });
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", serverId],
    queryFn: () => getServerProcessStatus(serverId),
    refetchInterval: 1500,
  });
  const canSendCommand = processQuery.data?.status === "running";

  useEffect(() => {
    if (!terminalElementRef.current) {
      return;
    }

    let isMounted = true;

    setTerminalLoadError(null);
    import("@xterm/xterm")
      .then(({ Terminal }) => {
        if (!isMounted || !terminalElementRef.current) {
          return;
        }

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, monospace",
          fontSize: 12,
          rows: 10,
          theme: {
            background: "#0d0d1a",
            foreground: "#e0ddd0",
          },
        });
        terminal.open(terminalElementRef.current);
        terminalRef.current = terminal;
        setTerminalReadyToken((value) => value + 1);
      })
      .catch((error: unknown) => {
        console.error("Failed to load server console terminal.", error);
        if (isMounted) {
          setTerminalLoadError(t("console.loadError"));
        }
      });

    return () => {
      isMounted = false;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      writtenEventIdsRef.current = new Set();
    };
  }, [serverId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !eventsQuery.data) {
      return;
    }

    const shouldRewrite = normalizedSearch.length > 0;
    if (shouldRewrite) {
      terminal.clear();
      writtenEventIdsRef.current = new Set();
    }
    for (const event of [...eventsQuery.data].reverse()) {
      if (!shouldRewrite && writtenEventIdsRef.current.has(event.id)) {
        continue;
      }
      if (
        normalizedSearch &&
        !`${event.level} ${event.message}`
          .toLowerCase()
          .includes(normalizedSearch)
      ) {
        continue;
      }
      writtenEventIdsRef.current.add(event.id);
      const prefix = event.level === "error" ? "[error]" : "[info]";
      terminal.writeln(`${prefix} ${event.message}`);
    }
  }, [eventsQuery.data, normalizedSearch, terminalReadyToken]);

  const sendCommandMutation = useMutation({
    mutationFn: () => sendServerCommand(serverId, commandText),
    onSuccess: async () => {
      const sentCommand = commandText.trim();
      if (sentCommand) {
        commandHistoryRef.current = [
          ...commandHistoryRef.current,
          sentCommand,
        ].slice(-50);
      }
      setHistoryIndex(null);
      setCommandText("");
      setShowSuggestions(false);
      await queryClient.invalidateQueries({
        queryKey: ["processEvents", serverId],
      });
    },
  });
  const commandQuery = useMemo(() => {
    const trimmed = commandText.trimStart();
    return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  }, [commandText]);
  const hasSuggestionMatches = useMemo(() => {
    const query = commandQuery.toLowerCase();
    return (
      query.length > 0 &&
      !query.includes(" ") &&
      MC_COMMANDS.some((entry) => entry.command.startsWith(query))
    );
  }, [commandQuery]);
  const suggestionsVisible = showSuggestions && hasSuggestionMatches;
  const selectSuggestion = (command: string) => {
    const hasSlash = commandText.trimStart().startsWith("/");
    setCommandText(hasSlash ? `/${command}` : command);
    setShowSuggestions(false);
  };
  const visibleEvents = useMemo(
    () =>
      eventsQuery.data?.filter((event) =>
        `${event.level} ${event.message}`
          .toLowerCase()
          .includes(normalizedSearch),
      ) ?? [],
    [eventsQuery.data, normalizedSearch],
  );
  const recentWarnings = visibleEvents
    .filter((event) => event.level === "error" || event.level === "warning")
    .slice(0, 5);
  const copyConsole = async () => {
    await navigator.clipboard.writeText(
      [...visibleEvents]
        .reverse()
        .map((event: ProcessEvent) => `[${event.level}] ${event.message}`)
        .join("\n"),
    );
  };

  return (
    <div className="console-panel" aria-label={t("console.aria")}>
      <div className="section-heading">
        <h2>{t("console.title")}</h2>
        <span>
          {eventsQuery.isFetching ? t("console.syncing") : t("console.live")} /{" "}
          {t("console.events", { count: visibleEvents.length })}
        </span>
      </div>
      <Toolbar.Root className="console-toolbar" aria-label={t("console.actions")}>
        <TextField
          aria-label={t("console.search")}
          placeholder={t("console.search")}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Toolbar.Separator asChild>
          <Separator.Root
            orientation="vertical"
            className="console-toolbar-separator"
          />
        </Toolbar.Separator>
        <Toolbar.Button
          className="button button-secondary"
          type="button"
          onClick={() => {
            terminalRef.current?.clear();
            writtenEventIdsRef.current = new Set();
          }}
        >
          <Eraser size={14} />
          {t("console.clear")}
        </Toolbar.Button>
        <Toolbar.Button
          className="button button-secondary"
          disabled={visibleEvents.length === 0}
          type="button"
          onClick={copyConsole}
        >
          <Copy size={14} />
          {t("console.copy")}
        </Toolbar.Button>
        <Toolbar.Button
          className="button button-secondary"
          disabled={eventsQuery.isFetching}
          type="button"
          onClick={() => eventsQuery.refetch()}
        >
          <RefreshCw size={14} />
          {t("common.refresh")}
        </Toolbar.Button>
      </Toolbar.Root>
      <div className="console-workspace">
        <div className="console-main">
          {eventsQuery.error ? (
            <div className="list-state list-state-error">
              <strong>{t("console.eventsError.title")}</strong>
              <span>{eventsQuery.error.message}</span>
              <Button variant="secondary" onClick={() => eventsQuery.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {terminalLoadError ? (
            <div className="inline-error console-load-error">
              {terminalLoadError}
            </div>
          ) : null}
          {!eventsQuery.error && eventsQuery.data?.length === 0 ? (
            <EmptyState
              illustration="/illustrations/no-console-output.png"
              title={t("console.empty.title")}
              description={t("console.empty.description")}
            />
          ) : null}
          <div className="xterm-host" ref={terminalElementRef} />
        </div>
        <aside className="console-side-panel" aria-label={t("console.side.aria")}>
          <div className="console-side-card">
            <h3>{t("console.side.status")}</h3>
            <dl>
              <div>
                <dt>{t("console.side.process")}</dt>
                <dd>{processQuery.data?.status ?? t("common.unknown")}</dd>
              </div>
              <div>
                <dt>{t("console.side.events")}</dt>
                <dd>{visibleEvents.length}</dd>
              </div>
              <div>
                <dt>{t("console.side.commands")}</dt>
                <dd>
                  {canSendCommand
                    ? t("console.side.ready")
                    : t("console.side.startRequired")}
                </dd>
              </div>
            </dl>
          </div>
          <div className="console-side-card">
            <h3>{t("console.side.recentWarnings")}</h3>
            {recentWarnings.length > 0 ? (
              <ul className="console-warning-list">
                {recentWarnings.map((event) => (
                  <li key={event.id}>{event.message}</li>
                ))}
              </ul>
            ) : (
              <p>{t("console.side.noWarnings")}</p>
            )}
          </div>
        </aside>
      </div>
      <div className="command-template-bar" aria-label={t("console.templates.aria")}>
        {commandTemplates.map((template) => (
          <Button
            key={template.command}
            type="button"
            variant="secondary"
            onClick={() => {
              setCommandText(template.command);
              setShowSuggestions(false);
            }}
          >
            {t(template.labelKey)}
          </Button>
        ))}
      </div>
      <form
        className="console-command-form"
        onSubmit={(event) => {
          event.preventDefault();
          sendCommandMutation.mutate();
        }}
      >
        <label htmlFor={`console-command-${serverId}`}>
          {t("console.command.label")}
        </label>
        <div className="cmd-suggest-container">
          <TextField
            id={`console-command-${serverId}`}
            placeholder={t("console.command.placeholder")}
            value={commandText}
            onChange={(event) => {
              const value = event.target.value;
              setCommandText(value);
              setShowSuggestions(value.trim().length > 0);
            }}
            onKeyDown={(event) => {
              if (suggestionsVisible) {
                return;
              }
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
              }
              const history = commandHistoryRef.current;
              if (history.length === 0) {
                return;
              }
              event.preventDefault();
              const nextIndex =
                event.key === "ArrowUp"
                  ? historyIndex === null
                    ? history.length - 1
                    : Math.max(historyIndex - 1, 0)
                  : historyIndex === null
                    ? history.length - 1
                    : Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(nextIndex);
              setCommandText(history[nextIndex]);
            }}
          />
          <CommandSuggestions
            input={commandText}
            onSelect={selectSuggestion}
            visible={suggestionsVisible}
          />
        </div>
        <Button
          disabled={
            !canSendCommand ||
            commandText.trim().length === 0 ||
            sendCommandMutation.isPending ||
            processQuery.isLoading
          }
          type="submit"
        >
          {t("console.send")}
        </Button>
      </form>
      {!canSendCommand && !processQuery.isLoading ? (
        <div className="inline-error console-command-error">
          {t("console.command.startFirst")}
        </div>
      ) : null}
      {sendCommandMutation.error ? (
        <div className="inline-error console-command-error">
          {sendCommandMutation.error.message}
        </div>
      ) : null}
    </div>
  );
}

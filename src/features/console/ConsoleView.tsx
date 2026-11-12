import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button as MantineButton,
  Group,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, Copy, Eraser, Search } from "lucide-react";
import {
  sendServerCommand,
  listProcessEvents,
  type ProcessEvent,
} from "../process/api";
import { processKeys } from "../process/queries";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { formatProcessEventMessage } from "../process/eventMessage";
import { useServerRuntime } from "../servers/ServerRuntimeContext";
import {
  CommandSuggestions,
  applyCompletion,
  hasCommandSuggestions,
} from "./CommandSuggestions";

interface ConsoleViewProps {
  serverId: string;
}

/* Log lines carry their own severity in the text, and a modded server prints
   hundreds per minute, so colour does the first pass of reading. */
const ANSI_RESET = "\u001b[0m";
const ANSI = {
  error: "\u001b[38;2;240;113;120m",
  warning: "\u001b[38;2;232;166;74m",
  join: "\u001b[38;2;95;206;128m",
  info: "\u001b[38;2;125;184;255m",
  quiet: "\u001b[38;2;143;149;162m",
};

export function colorizeConsoleLine(level: string, message: string) {
  const isChat = /(?:^|\]:?\s)(?:\[Not Secure\]\s)?<[^>]+>\s/.test(message);
  const color = isChat
    ? null
    : level === "error" || /\/(?:ERROR|FATAL)\]/.test(message)
      ? ANSI.error
      : level === "warning" || /\/WARN\]/.test(message)
        ? ANSI.warning
        : /\b(?:joined|left) the game\b/.test(message)
          ? ANSI.join
          : /^(?:Server process|Stop requested|Restart|Auto restarting|>)/.test(
                message,
              )
            ? ANSI.info
            : /\/(?:INFO|DEBUG)\]/.test(message)
              ? ANSI.quiet
              : null;
  return color ? `${color}${message}${ANSI_RESET}` : message;
}

/* The app's own lifecycle lines, said in the user's language and set apart
   from the log, so the moment a server became joinable or finished stopping
   is easy to spot. */
const LIFECYCLE_LINE =
  /^(?:Server process|Stop requested|Force stop requested|Restart|Auto restart)/;
const SETTLED_LINE = /^Server process (?:ready|stopped)\.$/;

const quickCommands = [
  { labelKey: "console.templates.list", command: "list" },
  { labelKey: "console.templates.save", command: "save-all flush" },
  { labelKey: "console.templates.stop", command: "stop" },
];

/* Everything here fills the input rather than running — which is what makes a
   template with an argument worth offering. `ban ` lands in the box with the
   cursor after it, so the menu teaches the syntax instead of hiding it, and a
   destructive command still needs a deliberate Enter. Grouped rather than laid
   out as one wall of buttons: a dozen more chips on this bar would cost more
   scanning than they save typing. */
const commandGroups = [
  {
    id: "players",
    labelKey: "console.group.players",
    options: [
      { value: "say ", labelKey: "console.command.say" },
      { value: "tell ", labelKey: "console.command.tell" },
      { value: "gamemode survival ", labelKey: "console.command.gamemode" },
      { value: "op ", labelKey: "console.command.op" },
      { value: "deop ", labelKey: "console.command.deop" },
      { value: "kick ", labelKey: "console.command.kick" },
      { value: "ban ", labelKey: "console.command.ban" },
      { value: "pardon ", labelKey: "console.command.pardon" },
    ],
  },
  {
    id: "world",
    labelKey: "console.group.world",
    options: [
      { value: "time set day", labelKey: "console.command.timeDay" },
      { value: "time set night", labelKey: "console.command.timeNight" },
      { value: "weather clear", labelKey: "console.command.weatherClear" },
      { value: "weather rain", labelKey: "console.command.weatherRain" },
      { value: "difficulty normal", labelKey: "console.command.difficulty" },
      { value: "seed", labelKey: "console.command.seed" },
    ],
  },
  {
    id: "maintenance",
    labelKey: "console.group.maintenance",
    options: [
      /* The backup pair. `save-off` before copying the world and `save-on`
         after is the only safe way to take a copy of a running server, and it
         is the one sequence people get wrong from memory. */
      { value: "save-off", labelKey: "console.command.saveOff" },
      { value: "save-on", labelKey: "console.command.saveOn" },
      { value: "reload", labelKey: "console.command.reload" },
      { value: "difficulty", labelKey: "console.command.readDifficulty" },
    ],
  },
  {
    id: "whitelist",
    labelKey: "console.whitelist.label",
    options: [
      { value: "whitelist add ", labelKey: "console.whitelist.add" },
      { value: "whitelist remove ", labelKey: "console.whitelist.remove" },
      { value: "whitelist reload", labelKey: "console.whitelist.reload" },
      { value: "whitelist on", labelKey: "console.whitelist.on" },
      { value: "whitelist off", labelKey: "console.whitelist.off" },
    ],
  },
];

export function ConsoleView({ serverId }: ConsoleViewProps) {
  const { t } = useAppSettings();
  const terminalInputId = useId();
  const runtime = useServerRuntime();
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
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const normalizedSearch = searchText.trim().toLowerCase();
  const eventsQuery = useQuery({
    queryKey: processKeys.events(serverId),
    queryFn: () => listProcessEvents(serverId),
  });
  const canSendCommand = runtime.status === "running";

  useEffect(() => {
    if (!terminalElementRef.current) {
      return;
    }

    let isMounted = true;

    let observer: ResizeObserver | null = null;

    setTerminalLoadError(null);
    Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      .then(([{ Terminal }, { FitAddon }]) => {
        if (!isMounted || !terminalElementRef.current) {
          return;
        }

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: false,
          disableStdin: true,
          fontFamily:
            "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 1.35,
          /* Opening size only. The fit below is what decides how tall the
             console actually is; a terminal pinned at ten rows showed a
             letterbox of output inside a panel several times its height. */
          rows: 10,
          theme: {
            background: "#0e1014",
            foreground: "#dfe3ea",
            selectionBackground: "#3f4450",
            /* A thin, quiet thumb: the default slider read as a stray grey
               box sitting at the end of the output. */
            scrollbarSliderBackground: "rgba(143, 149, 162, 0.18)",
            scrollbarSliderHoverBackground: "rgba(143, 149, 162, 0.32)",
            scrollbarSliderActiveBackground: "rgba(143, 149, 162, 0.42)",
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalElementRef.current);
        const terminalInput =
          terminalElementRef.current.querySelector<HTMLTextAreaElement>(
            ".xterm-helper-textarea",
          );
        if (terminalInput) {
          terminalInput.id = terminalInputId;
          terminalInput.name = "serverConsoleTerminalInput";
        }
        terminalRef.current = terminal;
        const fit = () => {
          /* The host is hidden while another workspace view is open, and
             proposing a size for a zero-height box throws inside the addon. */
          const host = terminalElementRef.current;
          if (!host || host.clientHeight === 0 || host.clientWidth === 0) {
            return;
          }
          fitAddon.fit();
        };
        fit();
        /* Fitting inside the observer callback resizes what it observes, which
           the browser reports as a "ResizeObserver loop" error on every drag. */
        let frame = 0;
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(fit);
        });
        observer.observe(terminalElementRef.current);
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
      observer?.disconnect();
      observer = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      writtenEventIdsRef.current = new Set();
    };
  }, [serverId, terminalInputId, t]);

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
      terminal.writeln(
        LIFECYCLE_LINE.test(event.message)
          ? `${SETTLED_LINE.test(event.message) ? ANSI.join : event.level === "error" ? ANSI.error : ANSI.info}── ${formatProcessEventMessage(event.message, t)} ──${ANSI_RESET}`
          : colorizeConsoleLine(event.level, event.message),
      );
    }
  }, [eventsQuery.data, normalizedSearch, terminalReadyToken, t]);

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
        queryKey: processKeys.events(serverId),
      });
    },
  });
  /* The list decides what it can offer for the token being typed — a command
     name or one of its arguments — so asking it is the only way to know whether
     there is anything to show. */
  const hasSuggestionMatches = useMemo(
    () => hasCommandSuggestions(commandText),
    [commandText],
  );
  const suggestionsVisible = showSuggestions && hasSuggestionMatches;
  const selectSuggestion = (completion: string) => {
    setCommandText(applyCompletion(commandText, completion));
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
  const copyConsole = async () => {
    await navigator.clipboard.writeText(
      [...visibleEvents]
        .reverse()
        .map((event: ProcessEvent) => `[${event.level}] ${event.message}`)
        .join("\n"),
    );
  };
  const fillCommand = (command: string) => {
    setCommandText(command);
    setShowSuggestions(false);
    setQuickMenuOpen(false);
    document.getElementById(`console-command-${serverId}`)?.focus();
  };

  return (
    <Stack
      aria-label={t("console.aria")}
      gap={0}
      h="100%"
      mih={0}
      style={{ flex: 1 }}
    >
      <Group gap="xs" px="sm" py={6} wrap="nowrap">
        <TextInput
          aria-label={t("console.search")}
          flex={1}
          leftSection={<Search aria-hidden="true" size={14} />}
          maw={320}
          placeholder={t("console.search")}
          size="xs"
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
        <Text
          c="dimmed"
          ff="monospace"
          size="xs"
          style={{ whiteSpace: "nowrap" }}
        >
          {t("console.events", { count: visibleEvents.length })}
        </Text>
        <Box flex={1} />
        <Menu
          opened={quickMenuOpen}
          position="bottom-end"
          returnFocus={false}
          width={240}
          onChange={setQuickMenuOpen}
        >
          <Menu.Target>
            <MantineButton
              aria-label={t("console.templates.aria")}
              color="gray"
              rightSection={<ChevronDown aria-hidden="true" size={14} />}
              size="xs"
              variant="subtle"
            >
              {t("console.templates.aria")}
            </MantineButton>
          </Menu.Target>
          <Menu.Dropdown>
            <ScrollArea.Autosize mah={380} type="auto">
              {quickCommands.map((template) => (
                <Menu.Item
                  key={template.command}
                  title={template.command}
                  onClick={() => fillCommand(template.command)}
                >
                  {t(template.labelKey)}
                </Menu.Item>
              ))}
              {commandGroups.map((group) => (
                <Fragment key={group.id}>
                  <Menu.Divider />
                  <Menu.Label>{t(group.labelKey)}</Menu.Label>
                  {group.options.map((option) => (
                    <Menu.Item
                      key={option.value}
                      title={option.value.trim()}
                      onClick={() => fillCommand(option.value)}
                    >
                      {t(option.labelKey)}
                    </Menu.Item>
                  ))}
                </Fragment>
              ))}
            </ScrollArea.Autosize>
          </Menu.Dropdown>
        </Menu>
        <Tooltip label={t("console.clear")}>
          <ActionIcon
            aria-label={t("console.clear")}
            onClick={() => {
              terminalRef.current?.clear();
            }}
          >
            <Eraser aria-hidden="true" size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("console.copy")}>
          <ActionIcon
            aria-label={t("console.copy")}
            disabled={visibleEvents.length === 0}
            onClick={copyConsole}
          >
            <Copy aria-hidden="true" size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Stack
        bg="#0e1014"
        gap={0}
        mih={220}
        pos="relative"
        style={{ flex: "1 1 auto", overflow: "hidden" }}
      >
        {eventsQuery.error ? (
          <Alert
            color="red"
            m="sm"
            role="alert"
            title={t("console.eventsError.title")}
            variant="light"
          >
            <Stack align="flex-start" gap="xs">
              <Text size="sm">{eventsQuery.error.message}</Text>
              <Button variant="secondary" onClick={() => eventsQuery.refetch()}>
                {t("common.retry")}
              </Button>
            </Stack>
          </Alert>
        ) : null}
        {terminalLoadError ? (
          <Alert color="red" m="sm" role="alert" variant="light">
            {terminalLoadError}
          </Alert>
        ) : null}
        {!eventsQuery.error && eventsQuery.data?.length === 0 ? (
          <Text c="dimmed" px="md" pt="sm" size="sm">
            {t("console.empty.description")}
          </Text>
        ) : null}
        <div className="xterm-host" ref={terminalElementRef} />
      </Stack>

      {commandText.trim() && !canSendCommand && !runtime.isLoading ? (
        <Text c="yellow" px="sm" pt={6} role="status" size="xs">
          {t("console.command.startFirst")}
        </Text>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendCommandMutation.mutate();
        }}
      >
        <Group gap="xs" p="sm" wrap="nowrap">
          <Box flex={1} miw={0} pos="relative">
            <TextInput
              aria-label={t("console.command.label")}
              autoComplete="off"
              id={`console-command-${serverId}`}
              leftSection={
                <Text aria-hidden="true" c="dimmed" ff="monospace" fw={600}>
                  /
                </Text>
              }
              placeholder={
                canSendCommand || runtime.isLoading
                  ? t("console.command.placeholder")
                  : runtime.status === "stopping"
                    ? t("processEvents.stopRequested")
                    : t("console.command.startFirst")
              }
              styles={{
                input: { fontFamily: "var(--mantine-font-family-monospace)" },
              }}
              value={commandText}
              onChange={(event) => {
                const value = event.currentTarget.value;
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
                if (event.key === "ArrowUp") {
                  const nextIndex =
                    historyIndex === null
                      ? history.length - 1
                      : Math.max(historyIndex - 1, 0);
                  setHistoryIndex(nextIndex);
                  setCommandText(history[nextIndex]);
                  return;
                }
                if (historyIndex === null) {
                  return;
                }
                if (historyIndex >= history.length - 1) {
                  setHistoryIndex(null);
                  setCommandText("");
                  return;
                }
                setHistoryIndex(historyIndex + 1);
                setCommandText(history[historyIndex + 1]);
              }}
            />
            <CommandSuggestions
              input={commandText}
              onSelect={selectSuggestion}
              visible={suggestionsVisible}
            />
          </Box>
          <Button
            disabled={
              !canSendCommand ||
              commandText.trim().length === 0 ||
              sendCommandMutation.isPending ||
              runtime.isLoading
            }
            style={{ flexShrink: 0 }}
            type="submit"
          >
            {t("console.send")}
          </Button>
        </Group>
      </form>
      {sendCommandMutation.error ? (
        <Alert color="red" mb="sm" mx="sm" role="alert" variant="light">
          {sendCommandMutation.error.message}
        </Alert>
      ) : null}
    </Stack>
  );
}

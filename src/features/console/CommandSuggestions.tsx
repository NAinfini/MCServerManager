import { useEffect, useMemo, useState } from "react";
import { Code, Group, Kbd, Paper, Text, UnstyledButton } from "@mantine/core";
import { useAppSettings } from "../../i18n";
import {
  MC_COMMANDS,
  completeArgument,
  findMcCommand,
  type McCommand,
} from "./mcCommands";

interface CommandSuggestionsProps {
  input: string;
  onSelect: (completion: string) => void;
  visible: boolean;
}

interface SuggestionEntry {
  value: string;
  label: string;
  description: string;
  usage?: string;
}

const MAX_SUGGESTIONS = 8;

/* Which token the completion applies to, and what has been typed of it. The
   command name is only the first of them: `gamemode crea` is a request to
   complete `crea`, not to start over from `gamemode`. */
export function parseCommandInput(input: string) {
  const withoutSlash = input.startsWith("/") ? input.slice(1) : input;
  const tokens = withoutSlash.split(" ");
  return {
    hasSlash: input.startsWith("/"),
    commandName: tokens[0] ?? "",
    /* -1 while the command name itself is still being typed. */
    argumentIndex: tokens.length - 2,
    prefix: tokens[tokens.length - 1] ?? "",
    completedTokens: tokens.slice(0, -1),
  };
}

function suggestionsFor(input: string): SuggestionEntry[] {
  const trimmed = input.trimStart();
  if (trimmed.length === 0) return [];
  const parsed = parseCommandInput(trimmed);

  if (parsed.argumentIndex < 0) {
    const query = parsed.commandName.toLowerCase();
    if (query.length === 0) return [];
    return MC_COMMANDS.filter((entry) =>
      entry.command.toLowerCase().startsWith(query),
    )
      .slice(0, MAX_SUGGESTIONS)
      .map((entry: McCommand) => ({
        value: entry.command,
        label: `/${entry.command}`,
        description: entry.description,
        usage: entry.usage,
      }));
  }

  const command = findMcCommand(parsed.commandName);
  if (!command) return [];
  return completeArgument(command, parsed.argumentIndex, parsed.prefix)
    .slice(0, MAX_SUGGESTIONS)
    .map((value) => ({
      value,
      label: value,
      description: command.description,
      usage: command.usage,
    }));
}

/* The completion replaces only the token being typed, so the part of the line
   already accepted survives. */
export function applyCompletion(input: string, completion: string) {
  const trimmed = input.trimStart();
  const parsed = parseCommandInput(trimmed);
  const tokens = [...parsed.completedTokens, completion];
  return `${parsed.hasSlash ? "/" : ""}${tokens.join(" ")}`;
}

export function hasCommandSuggestions(input: string) {
  return suggestionsFor(input).length > 0;
}

export function CommandSuggestions({
  input,
  onSelect,
  visible,
}: CommandSuggestionsProps) {
  const { t } = useAppSettings();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const suggestions = useMemo(() => suggestionsFor(input), [input]);

  useEffect(() => {
    setDismissed(false);
    setHighlightedIndex(0);
  }, [input]);

  const isOpen = visible && !dismissed && suggestions.length > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        onSelect(suggestions[highlightedIndex].value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, suggestions, highlightedIndex, onSelect]);

  if (!isOpen) {
    return null;
  }

  return (
    <Paper
      bottom="100%"
      left={0}
      mah={260}
      mb={4}
      p={4}
      pos="absolute"
      right={0}
      role="listbox"
      shadow="md"
      style={{ overflowY: "auto", zIndex: 10 }}
      withBorder
    >
      <Group justify="space-between" px="xs" py={4} wrap="nowrap">
        <Text c="dimmed" size="xs">
          {t("console.suggestions.source")}
        </Text>
        <Text aria-hidden="true" c="dimmed" size="xs">
          <Kbd size="xs">↑↓</Kbd> {t("console.suggestions.select")} ·{" "}
          <Kbd size="xs">{t("console.suggestions.tab")}</Kbd>{" "}
          {t("console.suggestions.fill")}
        </Text>
      </Group>
      {suggestions.map((suggestion, index) => (
        <UnstyledButton
          aria-selected={index === highlightedIndex}
          bg={
            index === highlightedIndex
              ? "var(--mantine-color-default-hover)"
              : undefined
          }
          display="flex"
          key={suggestion.value}
          px="xs"
          py={6}
          role="option"
          style={{ alignItems: "baseline", borderRadius: 6, gap: 12 }}
          w="100%"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion.value);
          }}
          onMouseEnter={() => setHighlightedIndex(index)}
        >
          <Text
            ff="monospace"
            fw={600}
            size="sm"
            style={{ whiteSpace: "nowrap" }}
          >
            {suggestion.label}
          </Text>
          <Text c="dimmed" size="xs" truncate>
            {suggestion.description}
            {suggestion.usage ? (
              <>
                {" "}
                <Code>{suggestion.usage}</Code>
              </>
            ) : null}
          </Text>
        </UnstyledButton>
      ))}
    </Paper>
  );
}

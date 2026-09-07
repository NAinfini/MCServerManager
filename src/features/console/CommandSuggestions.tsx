import { useEffect, useMemo, useState } from "react";
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
    <div className="cmd-suggest-list" role="listbox">
      <div className="cmd-suggest-header">
        <span>{t("console.suggestions.source")}</span>
        <span aria-hidden="true">
          <kbd>↑↓</kbd> {t("console.suggestions.select")} ·{" "}
          <kbd>{t("console.suggestions.tab")}</kbd>{" "}
          {t("console.suggestions.fill")}
        </span>
      </div>
      {suggestions.map((suggestion, index) => (
        <button
          className={
            index === highlightedIndex
              ? "cmd-suggest-item cmd-suggest-item-active"
              : "cmd-suggest-item"
          }
          key={suggestion.value}
          role="option"
          aria-selected={index === highlightedIndex}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion.value);
          }}
          onMouseEnter={() => setHighlightedIndex(index)}
        >
          <strong>{suggestion.label}</strong>
          <span className="cmd-suggest-copy">
            <span>{suggestion.description}</span>
            {suggestion.usage ? <code>{suggestion.usage}</code> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

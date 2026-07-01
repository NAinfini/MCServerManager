import { useEffect, useMemo, useState } from "react";
import { MC_COMMANDS } from "./mcCommands";

interface CommandSuggestionsProps {
  input: string;
  onSelect: (command: string) => void;
  visible: boolean;
}

const MAX_SUGGESTIONS = 8;

export function CommandSuggestions({
  input,
  onSelect,
  visible,
}: CommandSuggestionsProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query = useMemo(() => {
    const trimmed = input.trimStart();
    const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    return withoutSlash.toLowerCase();
  }, [input]);

  const suggestions = useMemo(() => {
    if (query.length === 0) {
      return [];
    }
    return MC_COMMANDS.filter((entry) =>
      entry.command.toLowerCase().startsWith(query),
    ).slice(0, MAX_SUGGESTIONS);
  }, [query]);

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
      } else if (event.key === "Enter") {
        event.preventDefault();
        onSelect(suggestions[highlightedIndex].command);
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
      {suggestions.map((suggestion, index) => (
        <button
          className={
            index === highlightedIndex
              ? "cmd-suggest-item cmd-suggest-item-active"
              : "cmd-suggest-item"
          }
          key={suggestion.command}
          role="option"
          aria-selected={index === highlightedIndex}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion.command);
          }}
          onMouseEnter={() => setHighlightedIndex(index)}
        >
          <strong>{suggestion.command}</strong>
          <span>{suggestion.description}</span>
        </button>
      ))}
    </div>
  );
}

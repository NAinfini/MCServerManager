import { KeyboardEvent, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ActionIcon,
  Group,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Button } from "./button";

interface EditableStringListProps {
  addLabel: string;
  emptyText: string;
  inputLabel: string;
  itemLabel: (index: number) => string;
  placeholder?: string;
  removeLabel: (value: string) => string;
  values: string[];
  onChange: (values: string[]) => void;
}

export function EditableStringList({
  addLabel,
  emptyText,
  inputLabel,
  itemLabel,
  onChange,
  placeholder,
  removeLabel,
  values,
}: EditableStringListProps) {
  const [pendingValue, setPendingValue] = useState("");

  function addValue() {
    const nextValue = pendingValue.trim();
    if (!nextValue || values.includes(nextValue)) {
      return;
    }
    onChange([...values, nextValue]);
    setPendingValue("");
  }

  function handlePendingKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addValue();
  }

  return (
    <Stack gap="xs">
      {values.length ? (
        values.map((value, index) => (
          <Group gap="xs" key={index} wrap="nowrap">
            <TextInput
              aria-label={itemLabel(index)}
              autoComplete="off"
              style={{ flex: 1 }}
              value={value}
              onChange={(event) => {
                const nextValues = [...values];
                nextValues[index] = event.currentTarget.value;
                onChange(nextValues);
              }}
            />
            <Tooltip label={removeLabel(value)}>
              <ActionIcon
                aria-label={removeLabel(value)}
                color="red"
                size="lg"
                onClick={() =>
                  onChange(values.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 aria-hidden="true" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))
      ) : (
        <Text c="dimmed" size="sm">
          {emptyText}
        </Text>
      )}
      <Group gap="xs" wrap="nowrap">
        <TextInput
          aria-label={inputLabel}
          autoComplete="off"
          placeholder={placeholder}
          style={{ flex: 1 }}
          value={pendingValue}
          onChange={(event) => setPendingValue(event.currentTarget.value)}
          onKeyDown={handlePendingKeyDown}
        />
        <Button
          disabled={
            !pendingValue.trim() || values.includes(pendingValue.trim())
          }
          variant="secondary"
          onClick={addValue}
        >
          <Plus aria-hidden="true" size={16} />
          {addLabel}
        </Button>
      </Group>
    </Stack>
  );
}

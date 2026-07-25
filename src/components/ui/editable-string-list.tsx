import { KeyboardEvent, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./button";
import { TextField } from "./text-field";

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
    <div className="editable-string-list">
      {values.length ? (
        <div className="editable-string-list-rows">
          {values.map((value, index) => (
            <div className="editable-string-list-row" key={index}>
              <TextField
                aria-label={itemLabel(index)}
                value={value}
                onChange={(event) => {
                  const nextValues = [...values];
                  nextValues[index] = event.target.value;
                  onChange(nextValues);
                }}
              />
              <Button
                aria-label={removeLabel(value)}
                className="icon-button"
                title={removeLabel(value)}
                variant="ghost"
                onClick={() =>
                  onChange(values.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 aria-hidden="true" size={15} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="editable-string-list-empty">{emptyText}</p>
      )}
      <div className="editable-string-list-add">
        <TextField
          aria-label={inputLabel}
          placeholder={placeholder}
          value={pendingValue}
          onChange={(event) => setPendingValue(event.target.value)}
          onKeyDown={handlePendingKeyDown}
        />
        <Button
          disabled={
            !pendingValue.trim() || values.includes(pendingValue.trim())
          }
          variant="secondary"
          onClick={addValue}
        >
          <Plus aria-hidden="true" size={15} />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

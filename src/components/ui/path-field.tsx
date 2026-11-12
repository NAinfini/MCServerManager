import { forwardRef, type InputHTMLAttributes } from "react";
import { Group, TextInput } from "@mantine/core";
import { Button } from "./button";

interface PathFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  browseLabel: string;
  onBrowse: () => void;
}

export const PathField = forwardRef<HTMLInputElement, PathFieldProps>(
  function PathField({ browseLabel, disabled, onBrowse, ...inputProps }, ref) {
    return (
      <Group gap="xs" wrap="nowrap">
        <TextInput
          autoComplete="off"
          disabled={disabled}
          ref={ref}
          style={{ flex: 1 }}
          styles={{
            input: { fontFamily: "var(--mantine-font-family-monospace)" },
          }}
          {...inputProps}
        />
        <Button disabled={disabled} variant="secondary" onClick={onBrowse}>
          {browseLabel}
        </Button>
      </Group>
    );
  },
);

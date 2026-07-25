import type { InputHTMLAttributes } from "react";
import { Button } from "./button";
import { TextField } from "./text-field";

interface PathFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  browseLabel: string;
  onBrowse: () => void;
}

export function PathField({
  browseLabel,
  disabled,
  onBrowse,
  ...inputProps
}: PathFieldProps) {
  return (
    <div className="path-field">
      <TextField disabled={disabled} {...inputProps} />
      <Button disabled={disabled} type="button" variant="secondary" onClick={onBrowse}>
        {browseLabel}
      </Button>
    </div>
  );
}

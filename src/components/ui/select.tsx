import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  iconAlt?: string;
  iconSrc?: string;
  iconText?: string;
  value: string;
  label: string;
}

interface SelectProps {
  disabled?: boolean;
  value: string;
  name?: string;
  options: readonly SelectOption[];
  ariaLabel: string;
  describedBy?: string;
  placeholder?: string;
  onValueChange: (value: string) => void;
}

export function Select({
  ariaLabel,
  describedBy,
  disabled = false,
  name,
  onValueChange,
  options,
  placeholder = "Select...",
  value,
}: SelectProps) {
  const selectedOption = options.find((option) => option.value === value);

  const renderOptionIcon = (
    option: SelectOption | undefined,
    className: string,
  ) => {
    if (!option) {
      return null;
    }

    if (option.iconSrc) {
      return (
        <img
          alt={option.iconAlt ?? ""}
          aria-hidden={option.iconAlt ? undefined : "true"}
          className={className}
          src={option.iconSrc}
        />
      );
    }

    if (option.iconText) {
      return (
        <span className={`${className} select-option-fallback`} aria-hidden>
          {option.iconText}
        </span>
      );
    }

    return null;
  };

  return (
    <SelectPrimitive.Root
      disabled={disabled}
      name={name}
      value={value}
      onValueChange={onValueChange}
    >
      <SelectPrimitive.Trigger
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        className="select-trigger motion-control motion-press"
      >
        <span className="select-trigger-value">
          {renderOptionIcon(selectedOption, "select-option-icon")}
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" size={15} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="select-content motion-popover"
          position="popper"
        >
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-item motion-option"
                key={option.value}
                value={option.value}
              >
                {renderOptionIcon(option, "select-option-icon")}
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-indicator">
                  <Check aria-hidden="true" size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

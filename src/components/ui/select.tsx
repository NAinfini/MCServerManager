import { Select as MantineSelect } from "@mantine/core";
import { useAppSettings } from "../../i18n";

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

function OptionIcon({ option }: { option: SelectOption | undefined }) {
  if (option?.iconSrc) {
    return (
      <img
        alt={option.iconAlt ?? ""}
        aria-hidden={option.iconAlt ? undefined : "true"}
        className="select-option-icon"
        height="18"
        src={option.iconSrc}
        width="18"
      />
    );
  }
  if (option?.iconText) {
    return (
      <span className="select-option-icon select-option-fallback" aria-hidden>
        {option.iconText}
      </span>
    );
  }
  return null;
}

export function Select({
  ariaLabel,
  describedBy,
  disabled = false,
  name,
  onValueChange,
  options,
  placeholder,
  value,
}: SelectProps) {
  const { t } = useAppSettings();
  const byValue = new Map(options.map((option) => [option.value, option]));
  const selected = byValue.get(value);
  const hasIcons = options.some((option) => option.iconSrc || option.iconText);

  return (
    <MantineSelect
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      comboboxProps={{ withinPortal: true }}
      data={options.map(({ label, value }) => ({ label, value }))}
      disabled={disabled}
      leftSection={hasIcons ? <OptionIcon option={selected} /> : undefined}
      name={name}
      placeholder={placeholder ?? t("common.select")}
      renderOption={
        hasIcons
          ? ({ option }) => (
              <span className="select-option-row">
                <OptionIcon option={byValue.get(option.value)} />
                {option.label}
              </span>
            )
          : undefined
      }
      value={value || null}
      onChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    />
  );
}

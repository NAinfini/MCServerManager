import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { useId, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export function Checkbox({ className, name, ...props }: CheckboxProps) {
  const generatedName = useId();
  return (
    <CheckboxPrimitive.Root
      className={cn("checkbox-root motion-check", className)}
      name={name ?? generatedName}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="checkbox-indicator">
        <Check aria-hidden="true" size={12} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

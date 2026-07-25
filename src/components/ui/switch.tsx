import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export function Switch({
  className,
  name,
  onBlur,
  onKeyDown,
  onPointerDown,
  ...props
}: SwitchProps) {
  const generatedName = useId();
  return (
    <SwitchPrimitive.Root
      className={cn("switch-root motion-toggle", className)}
      name={name ?? generatedName}
      onBlur={(event) => {
        delete event.currentTarget.dataset.pointerFocus;
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointerFocus;
        onKeyDown?.(event);
      }}
      onPointerDown={(event) => {
        event.currentTarget.dataset.pointerFocus = "true";
        onPointerDown?.(event);
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

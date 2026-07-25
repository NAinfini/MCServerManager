import type { InputHTMLAttributes } from "react";
import { forwardRef, useId } from "react";
import { cn } from "../../lib/cn";

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextField({ autoComplete = "off", className, id, ...props }, ref) {
  const generatedId = useId();
  return (
    <input
      autoComplete={autoComplete}
      className={cn("field-control", className)}
      id={id ?? generatedId}
      ref={ref}
      {...props}
    />
  );
});

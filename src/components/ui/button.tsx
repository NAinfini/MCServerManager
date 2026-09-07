import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/* Named after what the press does, not what it looks like: `success` brings
   something up, `warning` interrupts it recoverably, `danger` ends or destroys
   it. The colour follows from the name in app.css. */
type ButtonVariant =
  "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "button motion-control motion-press",
        `button-${variant}`,
        variant === "danger" ? "motion-danger" : undefined,
        className,
      )}
      type="button"
      {...props}
    />
  );
}

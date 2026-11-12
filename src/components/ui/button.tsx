import { Button as MantineButton } from "@mantine/core";
import type { ButtonHTMLAttributes } from "react";

/* Named after what the press does, not what it looks like: `success` brings
   something up, `warning` interrupts it recoverably, `danger` ends or destroys
   it. The look follows from the name. */
type ButtonVariant =
  "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const look: Record<ButtonVariant, { variant: string; color?: string }> = {
  primary: { variant: "filled" },
  success: { variant: "filled" },
  danger: { variant: "filled", color: "red.9" },
  secondary: { variant: "default" },
  warning: { variant: "default" },
  ghost: { variant: "subtle", color: "gray" },
};

export function Button({
  variant = "secondary",
  type = "button",
  color: _color,
  ...props
}: ButtonProps) {
  return <MantineButton {...look[variant]} type={type} {...props} />;
}

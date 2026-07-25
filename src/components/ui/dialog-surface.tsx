import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn";

interface DialogSurfaceProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  footerClassName?: string;
  className?: string;
  header?: (parts: { description: ReactNode; title: ReactNode }) => ReactNode;
  role?: "dialog" | "alertdialog";
  onOpenChange: (open: boolean) => void;
}

export function DialogSurface({
  open,
  title,
  description,
  children,
  footer,
  footerClassName,
  className,
  header,
  role = "dialog",
  onOpenChange,
}: DialogSurfaceProps) {
  const titleNode = <Dialog.Title>{title}</Dialog.Title>;
  const descriptionNode = <Dialog.Description>{description}</Dialog.Description>;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className={cn("inline-dialog", "modal-dialog", className)}
          role={role}
        >
          {header?.({ title: titleNode, description: descriptionNode }) ?? (
            <div>
              {titleNode}
              {descriptionNode}
            </div>
          )}
          {children}
          <div className={cn("dialog-actions", footerClassName)}>{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { useAppSettings } from "../../i18n";

interface ConfirmDangerDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isConfirming?: boolean;
  error?: string | null;
  consequences?: string[];
  requireTypedConfirmation?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDangerDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  isConfirming = false,
  error = null,
  consequences,
  requireTypedConfirmation,
  onCancel,
  onConfirm,
}: ConfirmDangerDialogProps) {
  const { t } = useAppSettings();
  const [typedValue, setTypedValue] = useState("");
  const isTypedMatch =
    !requireTypedConfirmation ||
    typedValue.trim() === requireTypedConfirmation;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setTypedValue("");
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="confirm-danger-dialog modal-dialog"
          aria-describedby="confirm-danger-description"
        >
          <div className="confirm-danger-header">
            <div className="confirm-danger-icon">
              <AlertTriangle aria-hidden="true" size={20} />
            </div>
            <div>
              <Dialog.Title className="confirm-danger-title">
                {title}
              </Dialog.Title>
              <Dialog.Description
                id="confirm-danger-description"
                className="confirm-danger-description"
              >
                {description}
              </Dialog.Description>
            </div>
          </div>

          {consequences && consequences.length > 0 ? (
            <ul className="confirm-danger-consequences">
              {consequences.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}

          {requireTypedConfirmation ? (
            <label className="confirm-danger-typed">
              <span>
                {t("common.typeToConfirm", { value: requireTypedConfirmation })}
              </span>
              <input
                className="field-control"
                type="text"
                value={typedValue}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTypedValue(e.target.value)}
              />
            </label>
          ) : null}

          {error ? (
            <div className="inline-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button disabled={isConfirming} variant="ghost">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              disabled={isConfirming || !isTypedMatch}
              variant="danger"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

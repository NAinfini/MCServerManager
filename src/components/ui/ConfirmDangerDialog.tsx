import { useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { DialogSurface } from "./dialog-surface";
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
  children?: ReactNode;
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
  children,
  onCancel,
  onConfirm,
}: ConfirmDangerDialogProps) {
  const { t } = useAppSettings();
  const [typedValue, setTypedValue] = useState("");
  const isTypedMatch =
    !requireTypedConfirmation || typedValue.trim() === requireTypedConfirmation;

  return (
    <DialogSurface
      open={isOpen}
      className="confirm-danger-dialog"
      description={description}
      footer={
        <>
          <Button disabled={isConfirming} variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isConfirming || !isTypedMatch}
            variant="danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
      role="alertdialog"
      title={title}
      onOpenChange={(open) => {
        if (!open) {
          setTypedValue("");
          onCancel();
        }
      }}
      header={({ description, title }) => (
        <div className="confirm-danger-header">
          <div className="confirm-danger-icon">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div>
            <div className="confirm-danger-title">{title}</div>
            <div className="confirm-danger-description">{description}</div>
          </div>
        </div>
      )}
    >
      {consequences && consequences.length > 0 ? (
        <ul className="confirm-danger-consequences">
          {consequences.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : null}

      {children}

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
    </DialogSurface>
  );
}

import { Check } from "lucide-react";
import { useAppSettings } from "../../i18n";

interface WizardStepIndicatorProps {
  steps: Array<{ label: string; description?: string }>;
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function WizardStepIndicator({
  steps,
  currentStep,
  onStepClick,
}: WizardStepIndicatorProps) {
  const { t } = useAppSettings();

  return (
    <nav className="wizard-progress" aria-label={t("wizard.progress")}>
      <ol className="wizard-steps">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const isClickable = Boolean(isCompleted && onStepClick);
          const content = (
            <>
              <div
                className={`wizard-step-circle${
                  isActive ? " wizard-step-circle-active" : ""
                }${isCompleted ? " wizard-step-circle-completed" : ""}`}
              >
                {isCompleted ? (
                  <Check aria-hidden="true" size={14} strokeWidth={3} />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <span
                className={`wizard-step-label${
                  isActive ? " wizard-step-label-active" : ""
                }${isCompleted ? " wizard-step-label-completed" : ""}`}
              >
                {step.label}
              </span>
            </>
          );

          return (
            <li key={step.label} className="wizard-step-item-wrapper">
              {index > 0 ? (
                <div
                  aria-hidden="true"
                  className={`wizard-step-connector${
                    index <= currentStep
                      ? " wizard-step-connector-active"
                      : ""
                  }`}
                />
              ) : null}
              {isClickable ? (
                <button
                  type="button"
                  className="wizard-step-item"
                  onClick={() => onStepClick?.(index)}
                >
                  {content}
                </button>
              ) : (
                <div
                  className="wizard-step-item"
                  aria-current={isActive ? "step" : undefined}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

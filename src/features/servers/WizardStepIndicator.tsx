import { Divider, Group, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
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
    <nav aria-label={t("wizard.progress")}>
      <Group component="ol" gap="xs" m={0} p={0} wrap="nowrap">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const isClickable = Boolean(isCompleted && onStepClick);
          const content = (
            <Group gap={6} wrap="nowrap">
              <ThemeIcon
                color={isActive || isCompleted ? "azure" : "gray"}
                radius="xl"
                size={20}
                variant={isActive ? "filled" : "light"}
              >
                {isCompleted ? (
                  <Check aria-hidden="true" size={12} strokeWidth={3} />
                ) : (
                  <Text fw={600} fz={11} inherit>
                    {index + 1}
                  </Text>
                )}
              </ThemeIcon>
              <Text
                c={isActive ? undefined : "dimmed"}
                fw={isActive ? 600 : 500}
                size="sm"
              >
                {step.label}
              </Text>
            </Group>
          );

          return (
            <Group
              aria-current={isActive ? "step" : undefined}
              component="li"
              gap="xs"
              key={step.label}
              style={{ listStyle: "none" }}
              wrap="nowrap"
            >
              {index > 0 ? (
                <Divider
                  aria-hidden="true"
                  color={index <= currentStep ? "azure" : undefined}
                  w={20}
                />
              ) : null}
              {isClickable ? (
                <UnstyledButton onClick={() => onStepClick?.(index)}>
                  {content}
                </UnstyledButton>
              ) : (
                content
              )}
            </Group>
          );
        })}
      </Group>
    </nav>
  );
}

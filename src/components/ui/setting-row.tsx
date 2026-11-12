import { Children, Fragment, type ReactNode } from "react";
import { Divider, Group, Paper, Stack, Text, Title } from "@mantine/core";

interface SettingSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Sits on the title line, right-aligned (a refresh button, a save state). */
  actions?: ReactNode;
  /** Heading level; 3 for sections nested under a page section's h2. */
  order?: 2 | 3;
  "aria-label"?: string;
  children?: ReactNode;
}

/* One titled surface of setting rows, a divider between each row. */
export function SettingSection({
  title,
  description,
  actions,
  order = 2,
  children,
  "aria-label": ariaLabel,
}: SettingSectionProps) {
  const rows = Children.toArray(children);
  return (
    <Paper component="section" p="md" aria-label={ariaLabel}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Title order={order} size={order === 2 ? "h3" : "h4"}>
          {title}
        </Title>
        {actions}
      </Group>
      {description ? (
        <Text size="sm" c="dimmed" mt={4}>
          {description}
        </Text>
      ) : null}
      {rows.length ? (
        <Stack gap={0} mt="xs">
          {rows.map((row, index) => (
            <Fragment key={index}>
              {index > 0 ? <Divider /> : null}
              {row}
            </Fragment>
          ))}
        </Stack>
      ) : null}
    </Paper>
  );
}

interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

/* Label and description on the left, the control on the right. */
export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <Group
      justify="space-between"
      align="center"
      gap="md"
      py="sm"
      wrap="nowrap"
    >
      <Stack gap={2} miw={0} style={{ flex: 1 }}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description ? (
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {children ? (
        <Group
          gap="xs"
          wrap="nowrap"
          justify="flex-end"
          style={{ flexShrink: 0 }}
        >
          {children}
        </Group>
      ) : null}
    </Group>
  );
}

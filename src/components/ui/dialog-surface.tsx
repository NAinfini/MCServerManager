import type { ReactNode } from "react";
import { Group, Modal, Text } from "@mantine/core";

interface DialogSurfaceProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  header?: (parts: { description: ReactNode; title: ReactNode }) => ReactNode;
  onOpenChange: (open: boolean) => void;
}

export function DialogSurface({
  open,
  title,
  description,
  children,
  footer,
  header,
  onOpenChange,
}: DialogSurfaceProps) {
  const titleNode = (
    <Modal.Title fw={650} fz="lg">
      {title}
    </Modal.Title>
  );
  const descriptionNode = (
    <Text c="dimmed" component="div" mt={4} size="sm">
      {description}
    </Text>
  );

  return (
    <Modal.Root opened={open} onClose={() => onOpenChange(false)}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Body p="lg">
          <div>
            {header?.({ title: titleNode, description: descriptionNode }) ?? (
              <div>
                {titleNode}
                {descriptionNode}
              </div>
            )}
          </div>
          {children}
          <Group
            gap="sm"
            justify="flex-end"
            mt="lg"
          >
            {footer}
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

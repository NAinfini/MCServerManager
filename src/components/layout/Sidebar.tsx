import {
  ChevronDown,
  Coffee,
  FolderOpen,
  FolderPlus,
  ScrollText,
  MoveUp,
  MoveDown,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Ungroup,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ActionIcon,
  Badge,
  Box,
  Button as MantineButton,
  Group,
  Image,
  Indicator,
  NavLink,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useAppSettings } from "../../i18n";
import { Button } from "../ui/button";
import { DialogSurface } from "../ui/dialog-surface";
import { ServerCover } from "../ui/server-cover";
import type { ServerProfile } from "../../domain/server";
import type { ManagedProcessStatus } from "../../features/process/api";
import { getLoaderBranding } from "../../features/loaders/loaderBranding";
import { type SidebarServerGroup, useSidebarStore } from "./sidebarStore";

export type PrimaryPage = "servers" | "java" | "logger" | "settings";

const SERVER_DRAG_TYPE = "application/x-mcsm-server-id";

/* Green, amber and red only ever mean server state. */
const statusColors: Record<string, string> = {
  running: "green",
  stopping: "yellow",
  crashed: "red",
  stopped: "gray",
};

const primaryItems = [
  { id: "java", labelKey: "nav.java", icon: Coffee },
  { id: "logger", labelKey: "nav.logger", icon: ScrollText },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
] satisfies Array<{ id: PrimaryPage; labelKey: string; icon: typeof Coffee }>;

const enabledPages = new Set<PrimaryPage>([
  "servers",
  "java",
  "logger",
  "settings",
]);

interface SidebarProps {
  notifications?: ReactNode;
  onCreateServer?: () => void;
  servers: ServerProfile[];
  activePage: PrimaryPage;
  selectedServerId?: string;
  serverStatuses?: Record<string, ManagedProcessStatus>;
  onSelectPage: (page: PrimaryPage) => void;
  onSelectServer?: (serverId: string) => void;
}

interface ServerDropZoneProps {
  testId: string;
  onDropServer: (serverId: string) => void;
}

function readDraggedServerId(event: DragEvent<HTMLElement>) {
  return (
    event.dataTransfer.getData(SERVER_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain")
  );
}

function ServerDropZone({ testId, onDropServer }: ServerDropZoneProps) {
  const [active, setActive] = useState(false);

  return (
    <Box
      aria-hidden="true"
      bg={active ? "azure.6" : undefined}
      data-testid={testId}
      h={4}
      mx="xs"
      style={{ borderRadius: 2 }}
      onDragEnter={(event) => {
        event.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setActive(false);
        const serverId = readDraggedServerId(event);
        if (serverId) {
          onDropServer(serverId);
        }
      }}
    />
  );
}

function ContextMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FolderOpen;
  label: string;
  onClick: () => void;
}) {
  return (
    <MantineButton
      color="gray"
      fullWidth
      fw={400}
      justify="flex-start"
      leftSection={<Icon aria-hidden="true" size={14} />}
      role="menuitem"
      size="xs"
      variant="subtle"
      onClick={onClick}
    >
      {label}
    </MantineButton>
  );
}

type ContextMenuState =
  | { type: "server"; id: string; x: number; y: number }
  | { type: "group"; id: string; x: number; y: number };

export function Sidebar({
  notifications,
  onCreateServer,
  servers,
  activePage,
  selectedServerId,
  serverStatuses = {},
  onSelectPage,
  onSelectServer,
}: SidebarProps) {
  const { t } = useAppSettings();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const groups = useSidebarStore((s) => s.groups);
  const rootItems = useSidebarStore((s) => s.rootItems);
  const addServerToGroup = useSidebarStore((s) => s.addServerToGroup);
  const createGroupFromServer = useSidebarStore((s) => s.createGroupFromServer);
  const createGroupWithServers = useSidebarStore(
    (s) => s.createGroupWithServers,
  );
  const disbandGroup = useSidebarStore((s) => s.disbandGroup);
  const moveServerAfter = useSidebarStore((s) => s.moveServerAfter);
  const moveServerBefore = useSidebarStore((s) => s.moveServerBefore);
  const moveServerToTop = useSidebarStore((s) => s.moveServerToTop);
  const moveServerByOffset = useSidebarStore((s) => s.moveServerByOffset);
  const renameGroup = useSidebarStore((s) => s.renameGroup);
  const syncServerLayout = useSidebarStore((s) => s.syncServerLayout);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const toggleGroup = useSidebarStore((s) => s.toggleGroup);
  const ungroupServer = useSidebarStore((s) => s.ungroupServer);
  const reduceMotion = useReducedMotion();
  const [draggingServerId, setDraggingServerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<SidebarServerGroup | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuTriggerRef = useRef<HTMLElement | null>(null);
  const contextMenuTargetRef = useRef<Omit<ContextMenuState, "x" | "y"> | null>(
    null,
  );
  const restoreContextMenuFocusRef = useRef(false);
  const serverIds = useMemo(
    () => servers.map((server) => server.id),
    [servers],
  );
  const serverIdKey = serverIds.join("|");
  const serverById = useMemo(
    () => new Map(servers.map((server) => [server.id, server])),
    [servers],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const groupedServerIds = useMemo(
    () => new Set(groups.flatMap((group) => group.serverIds)),
    [groups],
  );
  const statusByServerId = useMemo(
    () =>
      new Map(
        servers.map((server) => [
          server.id,
          serverStatuses[server.id] ?? "stopped",
        ]),
      ),
    [servers, serverStatuses],
  );
  const visibleRootItems = useMemo(
    () =>
      rootItems.filter((item) => {
        if (item.type === "group") return groupById.has(item.id);
        return serverById.has(item.id) && !groupedServerIds.has(item.id);
      }),
    [groupById, groupedServerIds, rootItems, serverById],
  );

  useEffect(() => {
    syncServerLayout(serverIds);
  }, [serverIdKey, serverIds, syncServerLayout]);

  const closeContextMenu = useCallback((restoreFocus = false) => {
    restoreContextMenuFocusRef.current = restoreFocus;
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    contextMenuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
    const closeMenu = () => closeContextMenu(false);

    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (contextMenu || !restoreContextMenuFocusRef.current) return;

    restoreContextMenuFocusRef.current = false;
    const target = contextMenuTargetRef.current;
    const targetKey = target ? `${target.type}:${target.id}` : null;
    const matchingTrigger = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLElement>(
        "[data-context-menu-trigger]",
      ) ?? [],
    ).find((element) => {
      if (element.dataset.contextMenuTrigger !== targetKey || !target) {
        return false;
      }
      if (target.type === "group") return groupById.has(target.id);
      return (
        serverById.has(target.id) &&
        Boolean(element.closest('[role="group"]')) ===
          groupedServerIds.has(target.id)
      );
    });
    const fallback =
      matchingTrigger ??
      sidebarRef.current?.querySelector<HTMLElement>("[data-sidebar-brand]");

    fallback?.focus();
  }, [contextMenu, groupById, groupedServerIds, serverById]);

  const showContextMenu = useCallback(
    (
      trigger: HTMLElement,
      menu: Omit<ContextMenuState, "x" | "y">,
      x: number,
      y: number,
    ) => {
      contextMenuTriggerRef.current = trigger;
      contextMenuTargetRef.current = menu;
      const menuWidth = 220;
      const menuHeight = 200;
      setContextMenu({
        ...menu,
        x: Math.max(0, Math.min(x, window.innerWidth - menuWidth)),
        y: Math.max(0, Math.min(y, window.innerHeight - menuHeight)),
      });
    },
    [],
  );

  const openContextMenu = useCallback(
    (
      event: MouseEvent<HTMLElement>,
      menu: Omit<ContextMenuState, "x" | "y">,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.currentTarget, menu, event.clientX, event.clientY);
    },
    [showContextMenu],
  );

  const openContextMenuFromKeyboard = useCallback(
    (
      event: ReactKeyboardEvent<HTMLElement>,
      menu: Omit<ContextMenuState, "x" | "y">,
    ) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      showContextMenu(
        event.currentTarget,
        menu,
        bounds.left + 8,
        bounds.bottom,
      );
    },
    [showContextMenu],
  );

  const handleContextMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not(:disabled)',
        ),
      );
      if (items.length === 0) return;

      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown") {
        nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu(true);
        return;
      } else if (event.key === "Tab") {
        closeContextMenu(false);
        return;
      }

      if (nextIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        items[nextIndex]?.focus();
      }
    },
    [closeContextMenu],
  );

  const beginServerDrag = useCallback(
    (event: DragEvent<HTMLElement>, serverId: string) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(SERVER_DRAG_TYPE, serverId);
      event.dataTransfer.setData("text/plain", serverId);
      setDraggingServerId(serverId);
    },
    [],
  );

  const dropOnServer = useCallback(
    (event: DragEvent<HTMLElement>, targetServerId: string) => {
      event.preventDefault();
      const sourceServerId = readDraggedServerId(event);
      setDraggingServerId(null);
      if (sourceServerId && sourceServerId !== targetServerId) {
        createGroupWithServers(sourceServerId, targetServerId);
      }
    },
    [createGroupWithServers],
  );

  const dropIntoGroup = useCallback(
    (event: DragEvent<HTMLElement>, groupId: string) => {
      event.preventDefault();
      const serverId = readDraggedServerId(event);
      setDraggingServerId(null);
      if (serverId) {
        addServerToGroup(serverId, groupId);
      }
    },
    [addServerToGroup],
  );

  const openRenameGroup = useCallback(
    (group: SidebarServerGroup) => {
      setRenameTarget(group);
      setRenameValue(group.name || t("nav.serverGroup.default"));
    },
    [t],
  );

  const renderServerRow = useCallback(
    (server: ServerProfile, options: { grouped?: boolean } = {}) => {
      const isActive = selectedServerId === server.id;
      const status = statusByServerId.get(server.id) ?? "stopped";
      const dotStatus = status === "externalRunning" ? "running" : status;
      const isDragging = draggingServerId === server.id;
      return (
        <motion.div
          key={server.id}
          data-testid={`server-nav-row-${server.id}`}
          layout
          animate={
            isDragging && !reduceMotion
              ? { rotate: [0, -1.4, 1.4, -1.1, 0], scale: 1.025 }
              : { rotate: 0, scale: 1 }
          }
          transition={{
            layout: { duration: reduceMotion ? 0 : 0.18 },
            rotate:
              isDragging && !reduceMotion
                ? { duration: 0.38, repeat: Infinity }
                : { duration: 0.16 },
            scale: { duration: 0.16 },
          }}
        >
          <Tooltip disabled={!collapsed} label={server.name} position="right">
            <NavLink
              active={isActive}
              aria-label={server.name}
              aria-current={isActive ? "page" : undefined}
              aria-expanded={
                contextMenu?.type === "server" && contextMenu.id === server.id
              }
              aria-haspopup="menu"
              component="button"
              data-context-menu-trigger={`server:${server.id}`}
              description={
                collapsed ? undefined : (
                  <>
                    <Text
                      c="dimmed"
                      component="span"
                      display="block"
                      size="xs"
                      truncate
                    >
                      {getLoaderBranding(server.loaderType).label}{" "}
                      {server.minecraftVersion ?? ""}
                    </Text>
                    <Text
                      c={
                        dotStatus === "stopped"
                          ? "dimmed"
                          : `${statusColors[dotStatus]}.5`
                      }
                      component="span"
                      data-tone={dotStatus}
                      display="block"
                      fw={dotStatus === "crashed" ? 600 : undefined}
                      size="xs"
                    >
                      {t(`server.statusLine.${status}`)}
                    </Text>
                  </>
                )
              }
              draggable
              noWrap
              label={collapsed ? undefined : server.name}
              leftSection={
                <Indicator
                  color={statusColors[dotStatus]}
                  data-status={dotStatus}
                  offset={3}
                  position="bottom-end"
                  size={10}
                  withBorder
                >
                  <ServerCover
                    loaderType={server.loaderType}
                    size={collapsed ? 32 : 36}
                  />
                </Indicator>
              }
              ml={options.grouped && !collapsed ? "sm" : undefined}
              opacity={isDragging ? 0.7 : 1}
              px={collapsed ? 6 : "xs"}
              py={6}
              styles={{
                label: { fontWeight: 600 },
                section: collapsed ? { marginInlineEnd: 0 } : undefined,
                body: collapsed ? { display: "none" } : undefined,
              }}
              type="button"
              onClick={() => onSelectServer?.(server.id)}
              onContextMenu={(event) =>
                openContextMenu(event, { type: "server", id: server.id })
              }
              onKeyDown={(event) =>
                openContextMenuFromKeyboard(event, {
                  type: "server",
                  id: server.id,
                })
              }
              onDragEnd={() => setDraggingServerId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => beginServerDrag(event, server.id)}
              onDrop={(event) => dropOnServer(event, server.id)}
            />
          </Tooltip>
        </motion.div>
      );
    },
    [
      beginServerDrag,
      collapsed,
      contextMenu,
      draggingServerId,
      dropOnServer,
      onSelectServer,
      openContextMenu,
      openContextMenuFromKeyboard,
      reduceMotion,
      selectedServerId,
      statusByServerId,
      t,
    ],
  );

  const renderServerEntry = useCallback(
    (server: ServerProfile, options: { grouped?: boolean } = {}) => (
      <motion.div key={`entry-${server.id}`} layout>
        <ServerDropZone
          testId={`drop-before-${server.id}`}
          onDropServer={(serverId) => moveServerBefore(serverId, server.id)}
        />
        {renderServerRow(server, options)}
        <ServerDropZone
          testId={`drop-after-${server.id}`}
          onDropServer={(serverId) => moveServerAfter(serverId, server.id)}
        />
      </motion.div>
    ),
    [moveServerAfter, moveServerBefore, renderServerRow, t],
  );

  const renderGroup = useCallback(
    (group: SidebarServerGroup) => {
      const groupName = group.name || t("nav.serverGroup.default");
      const groupServers = group.serverIds
        .map((serverId) => serverById.get(serverId))
        .filter((server): server is ServerProfile => Boolean(server));
      if (groupServers.length === 0) {
        return null;
      }

      return (
        <motion.div key={group.id} aria-label={groupName} layout role="group">
          <Tooltip disabled={!collapsed} label={groupName} position="right">
            <NavLink
              aria-label={groupName}
              aria-expanded={!group.collapsed}
              aria-haspopup="menu"
              component="button"
              data-context-menu-trigger={`group:${group.id}`}
              label={collapsed ? undefined : groupName}
              leftSection={
                <Group gap={4} wrap="nowrap">
                  <ChevronDown
                    aria-hidden="true"
                    size={14}
                    style={{
                      transform: group.collapsed ? "rotate(-90deg)" : undefined,
                      transition: "transform 120ms ease",
                    }}
                  />
                  <FolderOpen aria-hidden="true" size={16} />
                </Group>
              }
              noWrap
              px={collapsed ? 6 : "xs"}
              rightSection={
                collapsed ? undefined : (
                  <Badge color="gray" size="sm" variant="light">
                    {t("nav.serverGroup.count", { count: groupServers.length })}
                  </Badge>
                )
              }
              styles={{
                label: { fontWeight: 600 },
                section: collapsed ? { marginInlineEnd: 0 } : undefined,
                body: collapsed ? { display: "none" } : undefined,
              }}
              type="button"
              onClick={() => toggleGroup(group.id)}
              onContextMenu={(event) =>
                openContextMenu(event, { type: "group", id: group.id })
              }
              onKeyDown={(event) =>
                openContextMenuFromKeyboard(event, {
                  type: "group",
                  id: group.id,
                })
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropIntoGroup(event, group.id)}
            />
          </Tooltip>
          <AnimatePresence initial={false}>
            {!group.collapsed && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                {groupServers.map((server) =>
                  renderServerEntry(server, { grouped: true }),
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      );
    },
    [
      collapsed,
      contextMenu,
      dropIntoGroup,
      openContextMenu,
      openContextMenuFromKeyboard,
      reduceMotion,
      renderServerEntry,
      serverById,
      t,
      toggleGroup,
    ],
  );

  const menuServer =
    contextMenu?.type === "server" ? serverById.get(contextMenu.id) : undefined;
  const menuGroup =
    contextMenu?.type === "group" ? groupById.get(contextMenu.id) : undefined;
  const menuGroupName = menuGroup?.name || t("nav.serverGroup.default");
  const menuServerGrouped =
    contextMenu?.type === "server" && groupedServerIds.has(contextMenu.id);

  const toggleLabel = collapsed
    ? t("nav.expandSidebar")
    : t("nav.collapseSidebar");
  const contextMenuStyle = contextMenu
    ? { left: contextMenu.x, top: contextMenu.y, zIndex: 300 }
    : undefined;

  return (
    <Stack ref={sidebarRef} className="sidebar" component="aside" gap={0}>
      <Group
        gap={4}
        justify={collapsed ? "center" : "space-between"}
        px="sm"
        py="sm"
        wrap={collapsed ? "wrap" : "nowrap"}
      >
        <UnstyledButton
          aria-label={t("nav.servers")}
          data-sidebar-brand
          p={4}
          style={{ borderRadius: "var(--mantine-radius-md)", minWidth: 0 }}
          onClick={() => onSelectPage("servers")}
        >
          <Group gap="sm" wrap="nowrap">
            <Image
              alt=""
              aria-hidden="true"
              h={28}
              radius="sm"
              src="./app-icon.png"
              w={28}
            />
            {!collapsed && (
              <div style={{ minWidth: 0 }}>
                <Text fw={650} size="sm" truncate>
                  MC Server Manager
                </Text>
                <Text c="dimmed" size="xs" truncate>
                  {t("nav.localRuntime")}
                </Text>
              </div>
            )}
          </Group>
        </UnstyledButton>
        <Tooltip label={toggleLabel} position="right">
          <ActionIcon aria-label={toggleLabel} onClick={toggleCollapsed}>
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" size={16} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={16} />
            )}
          </ActionIcon>
        </Tooltip>
      </Group>

      <Stack
        aria-label={t("nav.serverProfiles")}
        component="section"
        gap={4}
        mih={0}
        style={{ flex: 1 }}
      >
        {!collapsed && (
          <Text c="dimmed" fw={500} px="md" size="xs">
            {t("nav.servers")}
          </Text>
        )}
        <ScrollArea scrollbarSize={6} style={{ flex: 1 }} type="hover">
          <Box px={collapsed ? 6 : "xs"}>
            <AnimatePresence initial={false}>
              {visibleRootItems.map((item) => {
                if (item.type === "group") {
                  return renderGroup(groupById.get(item.id)!);
                }
                const server = serverById.get(item.id);
                return server ? renderServerEntry(server) : null;
              })}
            </AnimatePresence>
          </Box>
        </ScrollArea>
      </Stack>

      {!collapsed && onCreateServer ? (
        <UnstyledButton
          c="dimmed"
          fz="xs"
          mx="sm"
          my="xs"
          p="sm"
          style={{
            border: "1px dashed var(--mantine-color-default-border)",
            borderRadius: "var(--mantine-radius-md)",
          }}
          ta="center"
          onClick={onCreateServer}
        >
          {t("nav.dropHint")}
        </UnstyledButton>
      ) : null}

      <Stack aria-label={t("nav.primary")} component="nav" gap={2} p="xs">
        {primaryItems.map((item) => (
          <Tooltip
            key={item.id}
            disabled={!collapsed}
            position="right"
            label={t(item.labelKey)}
          >
            <NavLink
              active={activePage === item.id}
              aria-label={t(item.labelKey)}
              component="button"
              disabled={!enabledPages.has(item.id)}
              label={collapsed ? undefined : t(item.labelKey)}
              leftSection={<item.icon aria-hidden="true" size={16} />}
              styles={{
                section: collapsed ? { marginInlineEnd: 0 } : undefined,
                body: collapsed ? { display: "none" } : undefined,
                root: collapsed ? { justifyContent: "center" } : undefined,
              }}
              type="button"
              onClick={() => onSelectPage(item.id)}
            />
          </Tooltip>
        ))}
        {notifications ? (
          <Group justify={collapsed ? "center" : "flex-start"} px={4}>
            {notifications}
          </Group>
        ) : null}
      </Stack>

      {contextMenu && menuServer && (
        <Paper
          ref={contextMenuRef}
          aria-label={t("nav.serverContext.menu", { server: menuServer.name })}
          miw={200}
          p={4}
          pos="fixed"
          role="menu"
          shadow="md"
          style={contextMenuStyle}
          withBorder
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleContextMenuKeyDown}
        >
          <ContextMenuItem
            icon={FolderOpen}
            label={t("nav.serverContext.open")}
            onClick={() => {
              onSelectServer?.(menuServer.id);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={FolderPlus}
            label={t("nav.serverContext.createGroup")}
            onClick={() => {
              createGroupFromServer(menuServer.id);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={MoveUp}
            label={t("nav.serverContext.moveTop")}
            onClick={() => {
              moveServerToTop(menuServer.id);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={MoveUp}
            label={t("nav.serverContext.moveUp")}
            onClick={() => {
              moveServerByOffset(menuServer.id, -1);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={MoveDown}
            label={t("nav.serverContext.moveDown")}
            onClick={() => {
              moveServerByOffset(menuServer.id, 1);
              closeContextMenu(true);
            }}
          />
          {groups
            .filter((group) => !group.serverIds.includes(menuServer.id))
            .map((group) => (
              <ContextMenuItem
                key={group.id}
                icon={FolderPlus}
                label={t("nav.serverContext.moveToGroup", {
                  group: group.name || t("nav.serverGroup.default"),
                })}
                onClick={() => {
                  addServerToGroup(menuServer.id, group.id);
                  closeContextMenu(true);
                }}
              />
            ))}
          {menuServerGrouped && (
            <ContextMenuItem
              icon={Ungroup}
              label={t("nav.serverContext.ungroup")}
              onClick={() => {
                ungroupServer(menuServer.id);
                closeContextMenu(true);
              }}
            />
          )}
        </Paper>
      )}

      {contextMenu && menuGroup && (
        <Paper
          ref={contextMenuRef}
          aria-label={t("nav.serverGroup.menu", { group: menuGroupName })}
          miw={200}
          p={4}
          pos="fixed"
          role="menu"
          shadow="md"
          style={contextMenuStyle}
          withBorder
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleContextMenuKeyDown}
        >
          <ContextMenuItem
            icon={ChevronDown}
            label={
              menuGroup.collapsed
                ? t("nav.serverGroup.expand")
                : t("nav.serverGroup.collapse")
            }
            onClick={() => {
              toggleGroup(menuGroup.id);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={FolderOpen}
            label={t("nav.serverGroup.rename")}
            onClick={() => {
              openRenameGroup(menuGroup);
              closeContextMenu(true);
            }}
          />
          <ContextMenuItem
            icon={Ungroup}
            label={t("nav.serverGroup.disband")}
            onClick={() => {
              disbandGroup(menuGroup.id);
              closeContextMenu(true);
            }}
          />
        </Paper>
      )}
      <DialogSurface
        open={Boolean(renameTarget)}
        title={t("nav.serverGroup.rename")}
        description={t("nav.serverGroup.renamePrompt")}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                if (!renameTarget || !renameValue.trim()) return;
                renameGroup(renameTarget.id, renameValue.trim());
                setRenameTarget(null);
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <TextInput
          aria-label={t("nav.serverGroup.renamePrompt")}
          autoComplete="off"
          data-autofocus
          mt="md"
          value={renameValue}
          onChange={(event) => setRenameValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !renameTarget || !renameValue.trim())
              return;
            renameGroup(renameTarget.id, renameValue.trim());
            setRenameTarget(null);
          }}
        />
      </DialogSurface>
    </Stack>
  );
}

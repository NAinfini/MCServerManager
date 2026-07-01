import {
  ChevronDown,
  Coffee,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  ScrollText,
  MoveUp,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Ungroup,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueries } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useAppSettings } from "../../i18n";
import { StatusBadge } from "../ui/status-badge";
import type { ServerProfile } from "../../features/servers/types";
import { getServerProcessStatus } from "../../features/process/api";
import { LoaderPill } from "../../features/loaders/LoaderIdentity";
import {
  type SidebarServerGroup,
  useSidebarStore,
} from "./sidebarStore";

export type PrimaryPage = "servers" | "java" | "logger" | "settings";

const SERVER_DRAG_TYPE = "application/x-mcsm-server-id";

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

function NavTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip-content" sideOffset={6}>
            {label}
            <Tooltip.Arrow className="tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

interface SidebarProps {
  servers: ServerProfile[];
  activePage: PrimaryPage;
  selectedServerId?: string;
  onSelectPage: (page: PrimaryPage) => void;
  onSelectServer?: (serverId: string) => void;
}

interface ServerDropZoneProps {
  label: string;
  onDropServer: (serverId: string) => void;
}

function readDraggedServerId(event: DragEvent<HTMLElement>) {
  return (
    event.dataTransfer.getData(SERVER_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain")
  );
}

function ServerDropZone({ label, onDropServer }: ServerDropZoneProps) {
  const [active, setActive] = useState(false);

  return (
    <div
      aria-label={label}
      aria-orientation="horizontal"
      className={active ? "server-drop-zone server-drop-zone-active" : "server-drop-zone"}
      role="separator"
      tabIndex={-1}
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

type ContextMenuState =
  | { type: "server"; id: string; x: number; y: number }
  | { type: "group"; id: string; x: number; y: number };

export function Sidebar({
  servers,
  activePage,
  selectedServerId,
  onSelectPage,
  onSelectServer,
}: SidebarProps) {
  const { t } = useAppSettings();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const groups = useSidebarStore((s) => s.groups);
  const rootItems = useSidebarStore((s) => s.rootItems);
  const addServerToGroup = useSidebarStore((s) => s.addServerToGroup);
  const createGroupFromServer = useSidebarStore((s) => s.createGroupFromServer);
  const createGroupWithServers = useSidebarStore((s) => s.createGroupWithServers);
  const disbandGroup = useSidebarStore((s) => s.disbandGroup);
  const moveServerAfter = useSidebarStore((s) => s.moveServerAfter);
  const moveServerBefore = useSidebarStore((s) => s.moveServerBefore);
  const moveServerToTop = useSidebarStore((s) => s.moveServerToTop);
  const renameGroup = useSidebarStore((s) => s.renameGroup);
  const syncServerLayout = useSidebarStore((s) => s.syncServerLayout);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const toggleGroup = useSidebarStore((s) => s.toggleGroup);
  const ungroupServer = useSidebarStore((s) => s.ungroupServer);
  const reduceMotion = useReducedMotion();
  const [draggingServerId, setDraggingServerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const statusQueries = useQueries({
    queries: servers.map((server) => ({
      queryKey: ["serverProcessStatus", server.id],
      queryFn: () => getServerProcessStatus(server.id),
      refetchInterval: 1500,
    })),
  });
  const statusSnapshot = statusQueries.map(
    (query) => query.data?.status ?? "stopped",
  );
  const statusSnapshotKey = statusSnapshot.join("|");
  const serverIds = useMemo(() => servers.map((server) => server.id), [servers]);
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
        servers.map((server, index) => [
          server.id,
          statusSnapshot[index] ?? "stopped",
        ]),
      ),
    [servers, statusSnapshotKey],
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

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, menu: Omit<ContextMenuState, "x" | "y">) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        ...menu,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
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

  const promptRenameGroup = useCallback(
    (group: SidebarServerGroup) => {
      const name = window.prompt(
        t("nav.serverGroup.renamePrompt"),
        group.name || t("nav.serverGroup.default"),
      );
      const trimmedName = name?.trim();
      if (trimmedName) {
        renameGroup(group.id, trimmedName);
      }
    },
    [renameGroup, t],
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
          className="server-nav-row"
          data-testid={`server-nav-row-${server.id}`}
          layout
          animate={
            isDragging && !reduceMotion
              ? { rotate: [0, -1.4, 1.4, -1.1, 0], scale: 1.025 }
              : { rotate: 0, scale: 1 }
          }
          transition={{
            layout: { duration: reduceMotion ? 0 : 0.18 },
            rotate: isDragging && !reduceMotion
              ? { duration: 0.38, repeat: Infinity }
              : { duration: 0.16 },
            scale: { duration: 0.16 },
          }}
        >
          <NavTooltip enabled={collapsed} label={server.name}>
            <button
              aria-current={isActive ? "page" : undefined}
              className={[
                "server-nav-item",
                isActive ? "server-nav-item-active" : "",
                isDragging ? "server-nav-item-dragging" : "",
                options.grouped ? "server-nav-item-grouped" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              title={collapsed ? undefined : server.name}
              type="button"
              onClick={() => onSelectServer?.(server.id)}
              onContextMenu={(event) =>
                openContextMenu(event, { type: "server", id: server.id })
              }
              onDragEnd={() => setDraggingServerId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => beginServerDrag(event, server.id)}
              onDrop={(event) => dropOnServer(event, server.id)}
            >
              <span
                className={`status-dot status-dot-${dotStatus}`}
                aria-hidden="true"
              />
              {!collapsed && (
                <span className="server-nav-copy">
                  <span className="server-nav-name">{server.name}</span>
                  <span className="server-nav-meta">
                    <LoaderPill
                      loaderType={server.loaderType}
                      minecraftVersion={server.minecraftVersion}
                    />
                    <span>
                      {t("nav.port", {
                        port: server.serverPort ?? t("nav.portUnset"),
                      })}
                    </span>
                  </span>
                </span>
              )}
              {!collapsed && <StatusBadge compact status={status} />}
            </button>
          </NavTooltip>
        </motion.div>
      );
    },
    [
      beginServerDrag,
      collapsed,
      draggingServerId,
      dropOnServer,
      onSelectServer,
      openContextMenu,
      reduceMotion,
      selectedServerId,
      statusByServerId,
      t,
    ],
  );

  const renderServerEntry = useCallback(
    (server: ServerProfile, options: { grouped?: boolean } = {}) => (
      <motion.div key={`entry-${server.id}`} className="server-nav-entry" layout>
        <ServerDropZone
          label={t("nav.drop.before", { server: server.name })}
          onDropServer={(serverId) => moveServerBefore(serverId, server.id)}
        />
        {renderServerRow(server, options)}
        <ServerDropZone
          label={t("nav.drop.after", { server: server.name })}
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
        <motion.div
          key={group.id}
          aria-label={groupName}
          className="server-nav-group"
          layout
          role="group"
        >
          <button
            className="server-nav-group-header"
            type="button"
            onClick={() => toggleGroup(group.id)}
            onContextMenu={(event) =>
              openContextMenu(event, { type: "group", id: group.id })
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropIntoGroup(event, group.id)}
          >
            <ChevronDown
              aria-hidden="true"
              className={group.collapsed ? "server-nav-group-chevron collapsed" : "server-nav-group-chevron"}
              size={15}
            />
            <FolderOpen aria-hidden="true" size={16} />
            {!collapsed && (
              <>
                <span className="server-nav-group-name">{groupName}</span>
                <span className="server-nav-group-count">
                  {t("nav.serverGroup.count", { count: groupServers.length })}
                </span>
              </>
            )}
          </button>
          <AnimatePresence initial={false}>
            {!group.collapsed && (
              <motion.div
                className="server-nav-group-list"
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
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
      dropIntoGroup,
      openContextMenu,
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

  return (
    <aside className={collapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
      <div className="sidebar-header">
        <button
          className="sidebar-brand"
          type="button"
          aria-label={t("nav.servers")}
          onClick={() => onSelectPage("servers")}
        >
          <span className="app-mark">
            <img alt="" aria-hidden="true" src="/app-icon.png" />
          </span>
          {!collapsed && (
            <div className="sidebar-brand-copy">
              <p className="sidebar-title">MC Server Manager</p>
              <p className="sidebar-subtitle">
                <Sparkles aria-hidden="true" size={11} />
                <span>{t("nav.localRuntime")}</span>
              </p>
            </div>
          )}
        </button>
        <button
          aria-label={
            collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")
          }
          className="sidebar-toggle-button"
          title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          type="button"
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" size={17} strokeWidth={2} />
          ) : (
            <PanelLeftClose aria-hidden="true" size={17} strokeWidth={2} />
          )}
        </button>
      </div>

      <nav className="sidebar-top-nav">
        <NavTooltip enabled={collapsed} label={t("nav.dashboard")}>
          <button
            className={
              activePage === "servers" && !selectedServerId
                ? "nav-item nav-item-active"
                : "nav-item"
            }
            type="button"
            onClick={() => onSelectPage("servers")}
          >
            <LayoutDashboard aria-hidden="true" size={18} strokeWidth={2} />
            {!collapsed && <span>{t("nav.dashboard")}</span>}
          </button>
        </NavTooltip>
      </nav>

      <section className="server-nav-section" aria-label={t("nav.serverProfiles")}>
        {!collapsed && (
          <div className="sidebar-section-label">{t("nav.servers")}</div>
        )}
        <div className="server-nav-list">
          <AnimatePresence initial={false}>
            {visibleRootItems.map((item) => {
              if (item.type === "group") {
                return renderGroup(groupById.get(item.id)!);
              }
              const server = serverById.get(item.id);
              return server ? renderServerEntry(server) : null;
            })}
          </AnimatePresence>
        </div>
      </section>

      <nav aria-label={t("nav.primary")} className="primary-nav sidebar-footer-nav">
        {primaryItems.map((item) => (
          <NavTooltip
            key={item.id}
            enabled={collapsed}
            label={t(item.labelKey)}
          >
            <button
              className={
                activePage === item.id ? "nav-item nav-item-active" : "nav-item"
              }
              disabled={!enabledPages.has(item.id)}
              type="button"
              onClick={() => onSelectPage(item.id)}
            >
              <item.icon aria-hidden="true" size={18} strokeWidth={2} />
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </button>
          </NavTooltip>
        ))}
      </nav>

      {contextMenu && menuServer && (
        <div
          aria-label={t("nav.serverContext.menu", { server: menuServer.name })}
          className="sidebar-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onSelectServer?.(menuServer.id);
              setContextMenu(null);
            }}
          >
            <FolderOpen aria-hidden="true" size={15} />
            <span>{t("nav.serverContext.open")}</span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              createGroupFromServer(menuServer.id);
              setContextMenu(null);
            }}
          >
            <FolderPlus aria-hidden="true" size={15} />
            <span>{t("nav.serverContext.createGroup")}</span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              moveServerToTop(menuServer.id);
              setContextMenu(null);
            }}
          >
            <MoveUp aria-hidden="true" size={15} />
            <span>{t("nav.serverContext.moveTop")}</span>
          </button>
          {menuServerGrouped && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                ungroupServer(menuServer.id);
                setContextMenu(null);
              }}
            >
              <Ungroup aria-hidden="true" size={15} />
              <span>{t("nav.serverContext.ungroup")}</span>
            </button>
          )}
        </div>
      )}

      {contextMenu && menuGroup && (
        <div
          aria-label={t("nav.serverGroup.menu", { group: menuGroupName })}
          className="sidebar-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              toggleGroup(menuGroup.id);
              setContextMenu(null);
            }}
          >
            <ChevronDown aria-hidden="true" size={15} />
            <span>
              {menuGroup.collapsed
                ? t("nav.serverGroup.expand")
                : t("nav.serverGroup.collapse")}
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              promptRenameGroup(menuGroup);
              setContextMenu(null);
            }}
          >
            <FolderOpen aria-hidden="true" size={15} />
            <span>{t("nav.serverGroup.rename")}</span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              disbandGroup(menuGroup.id);
              setContextMenu(null);
            }}
          >
            <Ungroup aria-hidden="true" size={15} />
            <span>{t("nav.serverGroup.disband")}</span>
          </button>
        </div>
      )}
    </aside>
  );
}

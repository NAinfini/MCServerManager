import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SidebarServerGroup {
  id: string;
  name: string;
  serverIds: string[];
  collapsed: boolean;
}

export type SidebarRootItem =
  | { type: "server"; id: string }
  | { type: "group"; id: string };

interface SidebarState {
  collapsed: boolean;
  groups: SidebarServerGroup[];
  nextGroupNumber: number;
  rootItems: SidebarRootItem[];
  addServerToGroup: (serverId: string, groupId: string) => void;
  createGroupFromServer: (serverId: string) => void;
  createGroupWithServers: (sourceServerId: string, targetServerId: string) => void;
  disbandGroup: (groupId: string) => void;
  moveServerAfter: (serverId: string, targetServerId: string) => void;
  moveServerBefore: (serverId: string, targetServerId: string) => void;
  moveServerToTop: (serverId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  resetServerLayout: () => void;
  syncServerLayout: (serverIds: string[]) => void;
  toggleCollapsed: () => void;
  toggleGroup: (groupId: string) => void;
  ungroupServer: (serverId: string) => void;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function sameRootItems(left: SidebarRootItem[], right: SidebarRootItem[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return item.type === other?.type && item.id === other.id;
    })
  );
}

function removeServerFromLayout(state: SidebarState, serverId: string) {
  return {
    groups: state.groups.map((group) => ({
      ...group,
      serverIds: group.serverIds.filter((id) => id !== serverId),
    })),
    rootItems: state.rootItems.filter(
      (item) => item.type !== "server" || item.id !== serverId,
    ),
  };
}

function findServerRootIndex(rootItems: SidebarRootItem[], serverId: string) {
  return rootItems.findIndex(
    (item) => item.type === "server" && item.id === serverId,
  );
}

function insertRootItem(
  rootItems: SidebarRootItem[],
  item: SidebarRootItem,
  index: number,
) {
  const next = rootItems.slice();
  next.splice(Math.max(0, index), 0, item);
  return next;
}

function nextGroup(state: SidebarState, serverIds: string[]) {
  return {
    collapsed: false,
    id: `server-group-${state.nextGroupNumber}`,
    name: "",
    serverIds: unique(serverIds),
  };
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      groups: [],
      nextGroupNumber: 1,
      rootItems: [],
      addServerToGroup: (serverId, groupId) =>
        set((state) => {
          const cleaned = removeServerFromLayout(state, serverId);
          return {
            groups: cleaned.groups.map((group) =>
              group.id === groupId
                ? { ...group, serverIds: unique([...group.serverIds, serverId]) }
                : group,
            ),
            rootItems: cleaned.rootItems,
          };
        }),
      createGroupFromServer: (serverId) =>
        set((state) => {
          const sourceIndex = findServerRootIndex(state.rootItems, serverId);
          const cleaned = removeServerFromLayout(state, serverId);
          const group = nextGroup(state, [serverId]);
          return {
            groups: [...cleaned.groups, group],
            nextGroupNumber: state.nextGroupNumber + 1,
            rootItems: insertRootItem(
              cleaned.rootItems,
              { type: "group", id: group.id },
              sourceIndex === -1 ? cleaned.rootItems.length : sourceIndex,
            ),
          };
        }),
      createGroupWithServers: (sourceServerId, targetServerId) =>
        set((state) => {
          if (sourceServerId === targetServerId) {
            return state;
          }

          const existingTargetGroup = state.groups.find((group) =>
            group.serverIds.includes(targetServerId),
          );
          if (existingTargetGroup) {
            const cleaned = removeServerFromLayout(state, sourceServerId);
            return {
              groups: cleaned.groups.map((group) =>
                group.id === existingTargetGroup.id
                  ? {
                      ...group,
                      serverIds: unique([...group.serverIds, sourceServerId]),
                    }
                  : group,
              ),
              rootItems: cleaned.rootItems,
            };
          }

          const targetIndex = findServerRootIndex(state.rootItems, targetServerId);
          const cleanedOnce = removeServerFromLayout(state, sourceServerId);
          const cleaned = removeServerFromLayout(
            { ...state, ...cleanedOnce },
            targetServerId,
          );
          const group = nextGroup(state, [targetServerId, sourceServerId]);
          return {
            groups: [...cleaned.groups, group],
            nextGroupNumber: state.nextGroupNumber + 1,
            rootItems: insertRootItem(
              cleaned.rootItems,
              { type: "group", id: group.id },
              targetIndex === -1 ? cleaned.rootItems.length : targetIndex,
            ),
          };
        }),
      disbandGroup: (groupId) =>
        set((state) => {
          const group = state.groups.find((candidate) => candidate.id === groupId);
          if (!group) {
            return state;
          }
          const groupIndex = state.rootItems.findIndex(
            (item) => item.type === "group" && item.id === groupId,
          );
          const rootItems = state.rootItems.filter(
            (item) => item.type !== "group" || item.id !== groupId,
          );
          return {
            groups: state.groups.filter((candidate) => candidate.id !== groupId),
            rootItems: insertRootItem(
              rootItems,
              { type: "server", id: group.serverIds[0] },
              groupIndex === -1 ? rootItems.length : groupIndex,
            ).flatMap((item) =>
              item.type === "server" && item.id === group.serverIds[0]
                ? group.serverIds.map((serverId) => ({
                    type: "server" as const,
                    id: serverId,
                  }))
                : [item],
            ),
          };
        }),
      moveServerAfter: (serverId, targetServerId) =>
        set((state) => {
          if (serverId === targetServerId) {
            return state;
          }
          const cleaned = removeServerFromLayout(state, serverId);
          const targetGroup = cleaned.groups.find((group) =>
            group.serverIds.includes(targetServerId),
          );
          if (targetGroup) {
            return {
              groups: cleaned.groups.map((group) => {
                if (group.id !== targetGroup.id) return group;
                const targetIndex = group.serverIds.indexOf(targetServerId);
                const serverIds = group.serverIds.slice();
                serverIds.splice(targetIndex + 1, 0, serverId);
                return { ...group, serverIds };
              }),
              rootItems: cleaned.rootItems,
            };
          }
          const targetIndex = findServerRootIndex(cleaned.rootItems, targetServerId);
          return {
            groups: cleaned.groups,
            rootItems: insertRootItem(
              cleaned.rootItems,
              { type: "server", id: serverId },
              targetIndex === -1 ? cleaned.rootItems.length : targetIndex + 1,
            ),
          };
        }),
      moveServerBefore: (serverId, targetServerId) =>
        set((state) => {
          if (serverId === targetServerId) {
            return state;
          }
          const cleaned = removeServerFromLayout(state, serverId);
          const targetGroup = cleaned.groups.find((group) =>
            group.serverIds.includes(targetServerId),
          );
          if (targetGroup) {
            return {
              groups: cleaned.groups.map((group) => {
                if (group.id !== targetGroup.id) return group;
                const targetIndex = group.serverIds.indexOf(targetServerId);
                const serverIds = group.serverIds.slice();
                serverIds.splice(targetIndex, 0, serverId);
                return { ...group, serverIds };
              }),
              rootItems: cleaned.rootItems,
            };
          }
          const targetIndex = findServerRootIndex(cleaned.rootItems, targetServerId);
          return {
            groups: cleaned.groups,
            rootItems: insertRootItem(
              cleaned.rootItems,
              { type: "server", id: serverId },
              targetIndex === -1 ? 0 : targetIndex,
            ),
          };
        }),
      moveServerToTop: (serverId) =>
        set((state) => {
          const cleaned = removeServerFromLayout(state, serverId);
          return {
            groups: cleaned.groups,
            rootItems: [{ type: "server", id: serverId }, ...cleaned.rootItems],
          };
        }),
      renameGroup: (groupId, name) =>
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId ? { ...group, name } : group,
          ),
        })),
      resetServerLayout: () =>
        set({
          groups: [],
          nextGroupNumber: 1,
          rootItems: [],
        }),
      syncServerLayout: (serverIds) =>
        set((state) => {
          const validServerIds = new Set(serverIds);
          const groups = state.groups
            .map((group) => ({
              ...group,
              serverIds: unique(
                group.serverIds.filter((serverId) =>
                  validServerIds.has(serverId),
                ),
              ),
            }))
            .filter((group) => group.serverIds.length > 0);
          const groupIds = new Set(groups.map((group) => group.id));
          const groupedServerIds = new Set(
            groups.flatMap((group) => group.serverIds),
          );
          const rootItems = state.rootItems.filter((item) => {
            if (item.type === "group") return groupIds.has(item.id);
            return (
              validServerIds.has(item.id) && !groupedServerIds.has(item.id)
            );
          });
          const visibleServerIds = new Set(
            rootItems
              .filter((item) => item.type === "server")
              .map((item) => item.id),
          );
          for (const serverId of serverIds) {
            if (!groupedServerIds.has(serverId) && !visibleServerIds.has(serverId)) {
              rootItems.push({ type: "server", id: serverId });
            }
          }

          if (
            groups.length === state.groups.length &&
            sameRootItems(rootItems, state.rootItems) &&
            groups.every((group, index) => {
              const previous = state.groups[index];
              return (
                group.id === previous?.id &&
                group.name === previous.name &&
                group.collapsed === previous.collapsed &&
                group.serverIds.join("|") === previous.serverIds.join("|")
              );
            })
          ) {
            return state;
          }

          return { groups, rootItems };
        }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      toggleGroup: (groupId) =>
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId
              ? { ...group, collapsed: !group.collapsed }
              : group,
          ),
        })),
      ungroupServer: (serverId) =>
        set((state) => {
          const containingGroup = state.groups.find((group) =>
            group.serverIds.includes(serverId),
          );
          if (!containingGroup) {
            return state;
          }
          const groups = state.groups
            .map((group) =>
              group.id === containingGroup.id
                ? {
                    ...group,
                    serverIds: group.serverIds.filter((id) => id !== serverId),
                  }
                : group,
            )
            .filter((group) => group.serverIds.length > 0);
          const groupIndex = state.rootItems.findIndex(
            (item) => item.type === "group" && item.id === containingGroup.id,
          );
          const rootItems = state.rootItems.filter(
            (item) => item.type !== "server" || item.id !== serverId,
          );
          return {
            groups,
            rootItems: insertRootItem(
              rootItems,
              { type: "server", id: serverId },
              groupIndex === -1 ? rootItems.length : groupIndex + 1,
            ),
          };
        }),
    }),
    {
      name: "mcsm.sidebar-layout",
      partialize: (state) => ({
        collapsed: state.collapsed,
        groups: state.groups,
        nextGroupNumber: state.nextGroupNumber,
        rootItems: state.rootItems,
      }),
    },
  ),
);

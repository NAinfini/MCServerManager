import { useSyncExternalStore } from "react";

export const serverWorkspaceSections = [
  "overview",
  "console",
  "players",
  "content",
  "data",
  "monitor",
  "automation",
  "settings",
] as const;

export type ServerWorkspaceSection = (typeof serverWorkspaceSections)[number];

export type AppRoute =
  | { name: "dashboard" }
  | {
      name: "create-server";
      sourcePath?: string;
      step?: number;
      jobId?: string;
    }
  | { name: "java" }
  | { name: "activity" }
  | { name: "settings"; section: string }
  | {
      name: "server";
      serverId: string;
      section: ServerWorkspaceSection;
      view?: string;
      path?: string;
    };

const workspaceSectionSet = new Set<string>(serverWorkspaceSections);

function decodePart(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseAppHash(hash: string): AppRoute {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathname = "", query = ""] = raw.split("?");
  const parts = pathname.split("/").filter(Boolean).map(decodePart);
  const search = new URLSearchParams(query);

  if (parts.length === 0 || parts[0] === "dashboard") {
    return { name: "dashboard" };
  }
  if (parts[0] === "java") {
    return { name: "java" };
  }
  if (parts[0] === "activity") {
    return { name: "activity" };
  }
  if (parts[0] === "settings") {
    return { name: "settings", section: parts[1] || "general" };
  }
  if (parts[0] !== "servers") {
    return { name: "dashboard" };
  }
  if (parts[1] === "new") {
    const sourcePath = search.get("source") || undefined;
    const rawStep = search.get("step");
    const parsedStep = rawStep === null ? Number.NaN : Number(rawStep);
    const step =
      Number.isInteger(parsedStep) && parsedStep >= 0 && parsedStep <= 5
        ? parsedStep
        : undefined;
    const jobId = search.get("job") || undefined;
    return {
      name: "create-server",
      ...(sourcePath ? { sourcePath } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(jobId ? { jobId } : {}),
    };
  }

  const serverId = parts[1];
  const section = workspaceSectionSet.has(parts[2] ?? "")
    ? (parts[2] as ServerWorkspaceSection)
    : "overview";
  if (!serverId) {
    return { name: "dashboard" };
  }

  const pathView =
    section === "settings"
      ? parts[3] || "general"
      : section === "content" && parts[3] === "browse"
        ? "browse"
        : undefined;
  const view = pathView || search.get("view") || undefined;
  const filePath = search.get("path") || undefined;
  return {
    name: "server",
    serverId,
    section,
    ...(view ? { view } : {}),
    ...(filePath ? { path: filePath } : {}),
  };
}

export function toAppHash(route: AppRoute): string {
  switch (route.name) {
    case "dashboard":
      return "#/dashboard";
    case "create-server": {
      const search = new URLSearchParams();
      if (route.sourcePath) search.set("source", route.sourcePath);
      if (route.step !== undefined) search.set("step", String(route.step));
      if (route.jobId) search.set("job", route.jobId);
      const query = search.toString();
      return `#/servers/new${query ? `?${query}` : ""}`;
    }
    case "java":
      return "#/java";
    case "activity":
      return "#/activity";
    case "settings":
      return `#/settings/${encodeURIComponent(route.section || "general")}`;
    case "server": {
      const base = `#/servers/${encodeURIComponent(route.serverId)}/${route.section}`;
      if (route.section === "settings") {
        return `${base}/${encodeURIComponent(route.view || "general")}`;
      }
      if (route.section === "content" && route.view === "browse") {
        return `${base}/browse`;
      }
      const search = new URLSearchParams();
      if (route.view) search.set("view", route.view);
      if (route.path) search.set("path", route.path);
      const query = search.toString();
      return `${base}${query ? `?${query}` : ""}`;
    }
  }
}

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function currentHash() {
  return window.location.hash || "#/dashboard";
}

export function useAppRoute() {
  const hash = useSyncExternalStore(
    subscribeHash,
    currentHash,
    () => "#/dashboard",
  );
  return parseAppHash(hash);
}

export function navigateTo(route: AppRoute, replace = false) {
  const hash = toAppHash(route);
  if (replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = hash.slice(1);
}

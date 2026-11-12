import { useSyncExternalStore } from "react";

export const serverWorkspaceSections = [
  "console",
  "players",
  "content",
  "backups",
  "files",
  "automation",
  "settings",
] as const;

export type ServerWorkspaceSection = (typeof serverWorkspaceSections)[number];

export type AppRoute =
  | { name: "dashboard" }
  | {
      name: "create-server";
      sourcePath?: string;
      /* "import" opens the folder picker straight away, so the Import Server
         entry point does something different from Create Server. */
      intent?: "import";
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

/**
 * Sections that were retired when Operations was folded into Overview and
 * Console, and when version upgrade and content update policy left the settings
 * rail. Links minted before that still exist in notifications, in the remembered
 * last location, and in anything a user bookmarked, so they are mapped onto
 * their successor instead of quietly resolving to Overview.
 */
const retiredWorkspaceRoutes: Record<
  string,
  { section: ServerWorkspaceSection; view?: string }
> = {
  overview: { section: "console", view: "health" },
  monitor: { section: "console", view: "health" },
  "monitor/performance": { section: "console", view: "health" },
  "monitor/events": { section: "console", view: "health" },
  "monitor/diagnostics": { section: "console", view: "health" },
  data: { section: "backups" },
  "data/backups": { section: "backups" },
  "data/files": { section: "files" },
  "monitor/logs": { section: "console", view: "logs" },
  "settings/updates": { section: "settings", view: "general" },
  "settings/contentPolicy": { section: "content", view: "updates" },
};

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
      Number.isInteger(parsedStep) && parsedStep >= 0 && parsedStep <= 2
        ? parsedStep
        : undefined;
    const jobId = search.get("job") || undefined;
    const intent = search.get("intent") === "import" ? "import" : undefined;
    return {
      name: "create-server",
      ...(sourcePath ? { sourcePath } : {}),
      ...(intent ? { intent } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(jobId ? { jobId } : {}),
    };
  }

  const serverId = parts[1];
  if (!serverId) {
    return { name: "dashboard" };
  }

  const requestedSection = parts[2] ?? "";
  const requestedView = parts[3] || search.get("view") || "";
  const retired =
    retiredWorkspaceRoutes[
      requestedView ? `${requestedSection}/${requestedView}` : requestedSection
    ];
  const section = retired
    ? retired.section
    : workspaceSectionSet.has(requestedSection)
      ? (requestedSection as ServerWorkspaceSection)
      : "console";
  const view = retired
    ? retired.view
    : section === "settings"
      ? requestedView || "general"
      : requestedView || undefined;
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
      if (route.intent) search.set("intent", route.intent);
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

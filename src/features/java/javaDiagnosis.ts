import type { ServerJavaCompatibility } from "./javaApi";

/* The old copy answered a question nobody asked. It restated the requirement
   ("requires Java 8 or newer") next to a server already running Java 11 — true
   of the version floor, silent about the thing that was actually wrong, and
   "or newer" was the crash. Each sentence here names the current state, the
   conflict, and the version that resolves it.

   It lives on its own so the Java page and the checklist inside a server say
   the same sentence about the same server. */
export function javaDiagnosis(
  item: ServerJavaCompatibility,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (item.status === "compatible") {
    /* The major reaches here only when the runtime was actually inspected.
       Printing "Java ?" when it was not says less than saying nothing. */
    return typeof item.configuredMajorVersion === "number"
      ? t("java.servers.ok", { version: item.configuredMajorVersion })
      : t("java.servers.okUnknown");
  }
  if (item.reason === "architecture") {
    return t("java.reason.architecture", {
      version: item.configuredMajorVersion ?? "?",
    });
  }
  if (item.reason === "tooNew") {
    return t("java.reason.tooNew", {
      current: item.configuredMajorVersion ?? "?",
      minecraft: item.minecraftVersion ?? "?",
      required: item.requiredMajorVersion ?? "?",
    });
  }
  if (item.reason === "tooOld") {
    return t("java.reason.tooOld", {
      current: item.configuredMajorVersion ?? "?",
      required: item.requiredMajorVersion ?? "?",
    });
  }
  /* No required major means the backend could not establish one — which happens
     when the server has no Minecraft version recorded, not when it is fine. */
  const required = item.requiredMajorVersion;
  if (typeof required !== "number") {
    return t("java.reason.noVersion");
  }
  return item.configuredJavaPath
    ? t("java.reason.missing", { version: required })
    : t("java.reason.unset", { version: required });
}

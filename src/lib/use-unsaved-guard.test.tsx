import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedGuard } from "./use-unsaved-guard";

describe("useUnsavedGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks a browser unload while a form is dirty", () => {
    renderHook(() => useUnsavedGuard({ isDirty: true }));
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("restores the current hash when navigation is declined", () => {
    window.location.hash = "#/servers/one/settings";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHook(() => useUnsavedGuard({ isDirty: true }));

    window.location.hash = "#/servers/one/console";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(window.location.hash).toBe("#/servers/one/settings");
  });
});

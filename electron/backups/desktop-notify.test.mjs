import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { showDesktopNotification } = require("./desktop-notify.cjs");

function fakeNotification(supported = true) {
  const shown = [];
  class Fake {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      this.options = options;
      shown.push(this);
    }
    on() {}
    show = vi.fn();
  }
  return { Fake, shown };
}
const failure = {
  kind: "notification",
  payload: {
    title: "Backup failed",
    message: "Survival: disk full",
    severity: "error",
    desktop: true,
  },
};

describe("desktop notification for backend events", () => {
  it("raises a critical system notification for a failed backup", () => {
    const { Fake, shown } = fakeNotification();
    expect(showDesktopNotification(Fake, failure)).toBe(true);
    expect(shown[0].options).toMatchObject({
      title: "Backup failed",
      body: "Survival: disk full",
      urgency: "critical",
    });
    expect(shown[0].show).toHaveBeenCalled();
  });

  it("stays quiet when the user turned desktop alerts off or it is not a notification", () => {
    const { Fake, shown } = fakeNotification();
    expect(
      showDesktopNotification(Fake, {
        ...failure,
        payload: { ...failure.payload, desktop: false },
      }),
    ).toBe(false);
    expect(showDesktopNotification(Fake, { kind: "console", payload: {} })).toBe(
      false,
    );
    expect(shown).toEqual([]);
  });

  it("does nothing where the platform has no notifications", () => {
    const { Fake, shown } = fakeNotification(false);
    expect(showDesktopNotification(Fake, failure)).toBe(false);
    expect(shown).toEqual([]);
  });
});

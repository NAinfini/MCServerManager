import { describe, expect, it } from "vitest";
import { parseAppHash, toAppHash } from "./router";

describe("app hash router", () => {
  it("defaults unknown and empty locations to the dashboard", () => {
    expect(parseAppHash("")).toEqual({ name: "dashboard" });
    expect(parseAppHash("#/not-a-page")).toEqual({ name: "dashboard" });
  });

  it("parses global application routes", () => {
    expect(parseAppHash("#/java")).toEqual({ name: "java" });
    expect(parseAppHash("#/activity")).toEqual({ name: "activity" });
    expect(parseAppHash("#/settings/appearance")).toEqual({
      name: "settings",
      section: "appearance",
    });
    expect(parseAppHash("#/servers/new?source=C%3A%5Cserver.zip")).toEqual({
      name: "create-server",
      sourcePath: "C:\\server.zip",
    });
    expect(parseAppHash("#/servers/new?step=2&job=job-1")).toEqual({
      name: "create-server",
      step: 2,
      jobId: "job-1",
    });
    // Import Server and Create Server used to be the same link.
    expect(parseAppHash("#/servers/new?intent=import")).toEqual({
      name: "create-server",
      intent: "import",
    });
    expect(parseAppHash("#/servers/new?intent=nonsense")).toEqual({
      name: "create-server",
    });
  });

  it("parses server sections, child views, and settings paths", () => {
    expect(parseAppHash("#/servers/server-1/players?view=whitelist")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "players",
      view: "whitelist",
    });
    expect(parseAppHash("#/servers/server-1/settings/network")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "settings",
      view: "network",
    });
    expect(parseAppHash("#/servers/server-1/content/browse")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "content",
      view: "browse",
    });
    expect(
      parseAppHash(
        "#/servers/server-1/data?view=files&path=config%2Fserver.properties",
      ),
    ).toEqual({
      name: "server",
      serverId: "server-1",
      section: "data",
      view: "files",
      path: "config/server.properties",
    });
  });

  it("maps retired workspace routes onto their successor", () => {
    expect(parseAppHash("#/servers/server-1/monitor?view=logs")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "console",
      view: "logs",
    });
    expect(parseAppHash("#/servers/server-1/monitor?view=diagnostics")).toEqual(
      {
        name: "server",
        serverId: "server-1",
        section: "overview",
      },
    );
    expect(parseAppHash("#/servers/server-1/monitor")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "overview",
    });
    expect(parseAppHash("#/servers/server-1/settings/updates")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "settings",
      view: "general",
    });
    expect(parseAppHash("#/servers/server-1/settings/contentPolicy")).toEqual({
      name: "server",
      serverId: "server-1",
      section: "content",
      view: "updates",
    });
  });

  it("serializes canonical deep links", () => {
    expect(toAppHash({ name: "dashboard" })).toBe("#/dashboard");
    expect(
      toAppHash({
        name: "create-server",
        sourcePath: "C:\\server.zip",
        step: 2,
        jobId: "job-1",
      }),
    ).toBe("#/servers/new?source=C%3A%5Cserver.zip&step=2&job=job-1");
    expect(toAppHash({ name: "create-server", intent: "import" })).toBe(
      "#/servers/new?intent=import",
    );
    expect(
      toAppHash({
        name: "server",
        serverId: "server 1",
        section: "console",
        view: "logs",
      }),
    ).toBe("#/servers/server%201/console?view=logs");
    expect(
      toAppHash({
        name: "server",
        serverId: "server-1",
        section: "settings",
        view: "properties",
      }),
    ).toBe("#/servers/server-1/settings/properties");
    expect(
      toAppHash({
        name: "server",
        serverId: "server-1",
        section: "data",
        view: "files",
        path: "config/server.properties",
      }),
    ).toBe(
      "#/servers/server-1/data?view=files&path=config%2Fserver.properties",
    );
  });
});

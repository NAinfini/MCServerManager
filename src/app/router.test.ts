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
    expect(parseAppHash("#/servers/new?step=5&job=job-1")).toEqual({
      name: "create-server",
      step: 5,
      jobId: "job-1",
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

  it("serializes canonical deep links", () => {
    expect(toAppHash({ name: "dashboard" })).toBe("#/dashboard");
    expect(
      toAppHash({
        name: "create-server",
        sourcePath: "C:\\server.zip",
        step: 5,
        jobId: "job-1",
      }),
    ).toBe("#/servers/new?source=C%3A%5Cserver.zip&step=5&job=job-1");
    expect(
      toAppHash({
        name: "server",
        serverId: "server 1",
        section: "monitor",
        view: "diagnostics",
      }),
    ).toBe("#/servers/server%201/monitor?view=diagnostics");
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

import { describe, expect, it } from "vitest";
import { mergeProperties } from "./properties.cjs";

describe("server.properties line-preserving merge", () => {
  it("updates only explicitly supplied keys", () => {
    const input = "# pack config\nmotd=Pack=MOTD\ncustom-key=keep\n";

    expect(mergeProperties(input, { "server-port": "25570" }).raw).toBe(
      "# pack config\nmotd=Pack=MOTD\ncustom-key=keep\nserver-port=25570\n",
    );
  });

  it("preserves CRLF and blank lines", () => {
    const input = "# heading\r\nmotd=Old\r\n\r\ncustom=value\r\n";

    expect(mergeProperties(input, { motd: "New" }).raw).toBe(
      "# heading\r\nmotd=New\r\n\r\ncustom=value\r\n",
    );
  });

  it("updates the final duplicate and reports it", () => {
    const result = mergeProperties("motd=first\nmotd=second\n", {
      motd: "final",
    });

    expect(result.raw).toBe("motd=first\nmotd=final\n");
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "DUPLICATE_PROPERTY", key: "motd" }),
    ]);
  });

  it("accepts entry arrays used by the Electron bridge", () => {
    const result = mergeProperties("pvp=true\nunknown=keep\n", [
      { key: "pvp", value: "false", known: true },
    ]);

    expect(result.raw).toBe("pvp=false\nunknown=keep\n");
    expect(result.entries).toEqual([
      { key: "pvp", value: "false" },
      { key: "unknown", value: "keep" },
    ]);
  });

  it.each(["bad key", "bad=key", "bad\nkey", "bad\rkey", ""])(
    "rejects invalid property key %j",
    (key) => {
      expect(() => mergeProperties("", { [key]: "value" })).toThrowError(
        expect.objectContaining({ code: "INVALID_PROPERTY_KEY" }),
      );
    },
  );
});

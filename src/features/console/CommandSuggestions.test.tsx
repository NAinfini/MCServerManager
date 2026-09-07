import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  hasCommandSuggestions,
  parseCommandInput,
} from "./CommandSuggestions";
import { completeArgument, findMcCommand } from "./mcCommands";

describe("console command completion", () => {
  it("completes the command name while the first token is being typed", () => {
    expect(parseCommandInput("/gamemo").argumentIndex).toBe(-1);
    expect(hasCommandSuggestions("/gamemo")).toBe(true);
    expect(applyCompletion("/gamemo", "gamemode")).toBe("/gamemode");
  });

  it("completes the argument once the command name is settled", () => {
    // The reported defect: typing "/gamemode crea" offered nothing, because
    // matching stopped at the first space.
    const parsed = parseCommandInput("/gamemode crea");
    expect(parsed.commandName).toBe("gamemode");
    expect(parsed.argumentIndex).toBe(0);
    expect(parsed.prefix).toBe("crea");

    const command = findMcCommand("gamemode");
    expect(command).toBeDefined();
    expect(completeArgument(command!, 0, "crea")).toEqual(["creative"]);
    expect(applyCompletion("/gamemode crea", "creative")).toBe(
      "/gamemode creative",
    );
  });

  it("reads the alternatives the usage line already spells out", () => {
    const whitelist = findMcCommand("whitelist");
    expect(completeArgument(whitelist!, 0, "")).toEqual([
      "on",
      "off",
      "list",
      "add",
      "remove",
      "reload",
    ]);
    expect(completeArgument(whitelist!, 0, "re")).toEqual(["remove", "reload"]);
  });

  it("keeps the accepted part of the line when a later argument is filled", () => {
    expect(applyCompletion("time set nig", "night")).toBe("time set night");
  });

  it("offers nothing for a value it cannot know", () => {
    // A player name, a coordinate or an item id is not ours to guess, and a
    // wrong guess in a console that runs commands is worse than no guess.
    expect(hasCommandSuggestions("/give Steve ")).toBe(false);
    expect(hasCommandSuggestions("/notacommand ")).toBe(false);
  });
});

"use strict";

function createCommandRegistry(handlers) {
  const entries = Object.freeze({ ...handlers });
  const names = Object.freeze(Object.keys(entries).sort());

  return Object.freeze({
    names,
    has(command) {
      return Object.hasOwn(entries, command);
    },
    execute(command, args) {
      if (!Object.hasOwn(entries, command)) {
        throw new Error(`Unsupported Electron backend command: ${command}.`);
      }
      return entries[command](args);
    },
  });
}

module.exports = { createCommandRegistry };

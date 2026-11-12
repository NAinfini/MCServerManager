"use strict";
/*
 * In-memory player activity per server, fed from console lines. Scheduled
 * backups use it to skip a server nobody has played on since its last backup.
 * Nothing is persisted: after an app restart the answer is "unknown".
 */
const PLAYER_EVENT = /^(\.?[A-Za-z0-9_]{1,16}) (joined|left) the game$/;

function createActivityTracker({
  parseLine,
  isPlayerControlled,
  now = Date.now,
}) {
  const servers = new Map();
  const startedAtMs = now();

  function entry(serverId) {
    let state = servers.get(serverId);
    if (!state) {
      state = { online: new Set(), lastActivityMs: null };
      servers.set(serverId, state);
    }
    return state;
  }

  function observe(serverId, line) {
    const { message } = parseLine(line);
    if (isPlayerControlled(message)) return;
    const match = PLAYER_EVENT.exec(message.trim());
    if (!match) return;
    const state = entry(serverId);
    if (match[2] === "joined") state.online.add(match[1]);
    else state.online.delete(match[1]);
    state.lastActivityMs = now();
  }

  /* Players cannot leave a process that is gone; whoever was on counts as
     having been active right up to the exit. */
  function serverStopped(serverId) {
    const state = servers.get(serverId);
    if (!state) return;
    if (state.online.size) state.lastActivityMs = now();
    state.online.clear();
  }

  function snapshot(serverId) {
    const state = servers.get(serverId);
    return {
      online: Boolean(state?.online.size),
      lastActivityMs: state?.lastActivityMs ?? null,
      trackingSinceMs: startedAtMs,
    };
  }

  return { observe, serverStopped, snapshot };
}

module.exports = { createActivityTracker };

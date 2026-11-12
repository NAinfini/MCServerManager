"use strict";
/*
 * Detects a server whose JVM is alive but frozen. Minecraft's own watchdog
 * only kills a hung server when max-tick-time is a sane value, and modpacks
 * often set it to -1, so nothing else ever notices.
 *
 * After `silenceMs` without any output line it writes `list` to stdin. Any
 * output line within `answerMs` counts as alive. `maxMisses` unanswered probes
 * in a row call onHung. Pure of processes: the caller supplies the writes.
 */
const SILENCE_MS = 60_000;
const ANSWER_MS = 30_000;
const MAX_MISSES = 5;
// A watchdog at its default (60s) would have fired long before the probe.
const MIN_TICK_TIME_MS = 180_000;

/* Vanilla "There are 0 of a max of 20 players online:", older and Paper
   "There are 0 out of maximum 20 players online." */
const LIST_REPLY =
  /^There are \d+ (?:of a max(?:imum)? of|out of maximum) \d+ players online/;

/* True when the watchdog cannot be relied on to stop a hung server. */
function probeWanted(properties) {
  const raw = properties?.["max-tick-time"];
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return false;
  const value = Number(String(raw).trim());
  return Number.isInteger(value) && (value === -1 || value >= MIN_TICK_TIME_MS);
}

function createHangProbe({
  sendList,
  parseLine = (line) => ({ message: line }),
  onHung,
  silenceMs = SILENCE_MS,
  answerMs = ANSWER_MS,
  maxMisses = MAX_MISSES,
  now = () => Date.now(),
}) {
  let running = false;
  const pauses = new Set();
  let timer = null;
  let lastOutputAt = now();
  let probing = false;
  let misses = 0;
  // A probe's reply is hidden even if another line beat it to the pipe, but
  // only for a while: a player's own `list` later must still show.
  let replyUntil = 0;

  function clear() {
    clearTimeout(timer);
    timer = null;
  }

  function arm(ms) {
    clear();
    timer = setTimeout(tick, ms);
    timer.unref?.();
  }

  function waitForSilence() {
    probing = false;
    arm(Math.max(0, lastOutputAt + silenceMs - now()));
  }

  function probe() {
    probing = true;
    replyUntil = now() + answerMs * 2;
    try {
      sendList();
    } catch {
      // A dead pipe is an unanswered probe like any other.
    }
    arm(answerMs);
  }

  function tick() {
    timer = null;
    if (!running || pauses.size) return;
    if (!probing) {
      const quietFor = now() - lastOutputAt;
      if (quietFor < silenceMs) return arm(silenceMs - quietFor);
      return probe();
    }
    misses += 1;
    if (misses >= maxMisses) {
      running = false;
      return onHung(misses);
    }
    probe();
  }

  function begin() {
    lastOutputAt = now();
    misses = 0;
    replyUntil = 0;
    waitForSilence();
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (!pauses.size) begin();
    },
    stop() {
      running = false;
      clear();
    },
    pause(reason) {
      pauses.add(reason);
      clear();
      probing = false;
      misses = 0;
    },
    resume(reason) {
      if (!pauses.delete(reason) || pauses.size || !running) return;
      begin();
    },
    /* Call for every output line. Returns true when the line is the reply to
       our own probe and must not reach the console or event log. */
    onLine(line) {
      lastOutputAt = now();
      if (probing) {
        misses = 0;
        if (running && !pauses.size) waitForSilence();
      }
      if (now() <= replyUntil && LIST_REPLY.test(parseLine(line).message)) {
        replyUntil = 0;
        return true;
      }
      return false;
    },
  };
}

module.exports = {
  ANSWER_MS,
  MAX_MISSES,
  MIN_TICK_TIME_MS,
  SILENCE_MS,
  createHangProbe,
  probeWanted,
};

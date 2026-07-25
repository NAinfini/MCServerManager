type EventTranslator = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => string;

const exactMessages: Record<string, string> = {
  "Server process started.": "processEvents.started",
  "Stop requested.": "processEvents.stopRequested",
  "Auto restart skipped because restart policy is disabled.":
    "processEvents.autoRestartDisabled",
  "Restart aborted because the previous server process did not exit.":
    "processEvents.restartAborted",
};

export function formatProcessEventMessage(message: string, t: EventTranslator) {
  const exactKey = exactMessages[message];
  if (exactKey) return t(exactKey);

  const exited = message.match(/^Server process exited with code (.+)\.$/);
  if (exited) {
    return t("processEvents.exited", { code: exited[1] });
  }

  const exhausted = message.match(
    /^Auto restart exhausted after (\d+) attempt\(s\)\.$/,
  );
  if (exhausted) {
    return t("processEvents.autoRestartExhausted", {
      attempts: exhausted[1],
    });
  }

  const countdown = message.match(/^Restart countdown scheduled for (.+)\.$/);
  if (countdown) {
    return t("processEvents.restartScheduled", { time: countdown[1] });
  }

  const playerAccess = message.match(/^Player access updated: (\S+) (.+)\.$/);
  if (playerAccess) {
    return t("processEvents.playerAccessUpdated", {
      action: playerAccess[1],
      player: playerAccess[2],
    });
  }

  return message;
}

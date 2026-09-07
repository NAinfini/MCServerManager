const { codedError } = require("../provisioning/contracts.cjs");

function schedule(input) {
  const scheduleKind = input.scheduleKind || "interval";
  if (scheduleKind === "interval") {
    const intervalMinutes = Number(input.intervalMinutes);
    if (
      !Number.isFinite(intervalMinutes) ||
      intervalMinutes <= 0 ||
      intervalMinutes > 525600
    )
      throw codedError(
        "TASK_INTERVAL_NOT_POSITIVE",
        "task interval must be positive and at most one year",
      );
    return { scheduleKind, intervalMinutes, timeOfDay: null, weekdays: [] };
  }
  const weekdays = [...new Set(input.weekdays || [])];
  if (
    scheduleKind !== "weekly" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.timeOfDay || "") ||
    !weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw codedError(
      "TASK_SCHEDULE_INVALID",
      "select a valid local time and one or more weekdays",
    );
  return {
    scheduleKind,
    intervalMinutes: 0,
    timeOfDay: input.timeOfDay,
    weekdays: weekdays.sort(),
  };
}

function nextRun(schedule, now = new Date()) {
  if (schedule.scheduleKind === "interval")
    return new Date(
      now.getTime() + schedule.intervalMinutes * 60000,
    ).toISOString();
  const [hours, minutes] = schedule.timeOfDay.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate > now && schedule.weekdays.includes(candidate.getDay()))
      return candidate.toISOString();
  }
  throw codedError("TASK_SCHEDULE_INVALID", "no future task time is available");
}

function fromRow(row) {
  return {
    scheduleKind: row.schedule_kind,
    intervalMinutes: row.interval_minutes,
    timeOfDay: row.time_of_day,
    weekdays: JSON.parse(row.weekdays_json),
  };
}

module.exports = { schedule, nextRun, fromRow };

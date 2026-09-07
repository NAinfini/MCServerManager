type Translate = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => string;

/**
 * Storage figures arrive from the backend in megabytes, which is fine until a
 * half-empty drive reads "102400 MB" and the reader has to divide. Memory is
 * deliberately not run through this: the min/max heap fields are entered in
 * megabytes, so showing the same number in gigabytes elsewhere would break the
 * link back to the setting that produced it.
 */
export function formatMegabytes(megabytes: number) {
  if (megabytes < 1024) {
    return `${Math.round(megabytes)} MB`;
  }
  const gigabytes = megabytes / 1024;
  return `${Number.isInteger(gigabytes) ? gigabytes : gigabytes.toFixed(1)} GB`;
}

const DURATION_UNITS = [
  { key: "common.duration.days", seconds: 86_400 },
  { key: "common.duration.hours", seconds: 3_600 },
  { key: "common.duration.minutes", seconds: 60 },
  { key: "common.duration.seconds", seconds: 1 },
] as const;

/**
 * Two units at most: "1 h 30 min" is read at a glance, "1 h 30 min 12 s" is
 * read twice. A remainder of zero drops the second unit entirely.
 */
export function formatDuration(totalSeconds: number, t: Translate) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds === 0) return t("common.duration.seconds", { count: 0 });

  const parts: string[] = [];
  let remaining = seconds;
  for (const unit of DURATION_UNITS) {
    const count = Math.floor(remaining / unit.seconds);
    if (count > 0) {
      parts.push(t(unit.key, { count }));
      remaining -= count * unit.seconds;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** Schedules are stored in minutes; a nightly job should not read "1440 min". */
export function formatMinutes(totalMinutes: number, t: Translate) {
  return formatDuration(totalMinutes * 60, t);
}
